import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { extname, posix } from "node:path";
import { XMLParser } from "fast-xml-parser";
import yauzl, { type Entry } from "yauzl";
import type { OpenPublicationResult, PublicationCoverDto, PublicationDto, PublicationLinkDto } from "../../shared/src/types";

const MAX_EPUB_BYTES = 1_000_000_000;
const MAX_DOCUMENT_BYTES = 16_000_000;
const MAX_IMAGE_BYTES = 16_000_000;
const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_ARCHIVE_EXPANDED_BYTES = 2_000_000_000;
const MAX_ENTRY_EXPANDED_BYTES = 256_000_000;
const MAX_SUSPICIOUS_COMPRESSION_RATIO = 1_000;

export function assertSafeZipEntryName(fileName: string): void {
  const candidates = [fileName];
  let decoded = fileName;
  for (let pass = 0; pass < 8; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      candidates.push(next);
      decoded = next;
    } catch {
      break;
    }
  }
  for (const candidate of candidates) {
    const segments = candidate.split("/");
    if (candidate.replace(/^\/+/, "").toLowerCase() === "meta-inf/license.lcpl") {
      throw new Error("此文件受保护，无法读取。");
    }
    if (
      candidate.includes("\\")
      || /[\u0000-\u001f\u007f]/.test(candidate)
      || candidate.startsWith("/")
      || /^[a-z]:/i.test(candidate)
      || segments.some((segment) => segment === "..")
    ) {
      throw new Error("EPUB contains an unsafe archive entry name.");
    }
  }
}

function validateArchiveEntry(entry: Entry, counters: { entries: number; expandedBytes: number }): void {
  assertSafeZipEntryName(entry.fileName);
  counters.entries += 1;
  counters.expandedBytes += entry.uncompressedSize;
  if (counters.entries > MAX_ARCHIVE_ENTRIES) {
    throw new Error("EPUB contains too many archive entries.");
  }
  if (!Number.isSafeInteger(counters.expandedBytes) || counters.expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
    throw new Error("EPUB expanded size exceeds the safety limit.");
  }
  if (entry.uncompressedSize > MAX_ENTRY_EXPANDED_BYTES) {
    throw new Error("EPUB contains an oversized archive entry.");
  }
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw new Error("Encrypted EPUB archive entries are not supported.");
  }
  if (!entry.fileName.endsWith("/") && entry.uncompressedSize > MAX_DOCUMENT_BYTES) {
    const ratio = entry.compressedSize === 0 ? Number.POSITIVE_INFINITY : entry.uncompressedSize / entry.compressedSize;
    if (ratio > MAX_SUSPICIOUS_COMPRESSION_RATIO) {
      throw new Error("EPUB contains a suspiciously compressed archive entry.");
    }
  }
}

export function preflightEpubArchive(filePath: string): Promise<void> {
  return new Promise((resolvePreflight, rejectPreflight) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) {
        rejectPreflight(openError ?? new Error("Unable to open EPUB archive."));
        return;
      }
      const counters = { entries: 0, expandedBytes: 0 };
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        zip.close();
        rejectPreflight(error);
      };
      zip.on("error", fail);
      zip.on("entry", (entry) => {
        try {
          validateArchiveEntry(entry, counters);
          zip.readEntry();
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
      zip.on("end", () => {
        if (settled) return;
        settled = true;
        resolvePreflight();
      });
      zip.readEntry();
    });
  });
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export function cleanZipHref(href: string): string {
  const withoutFragment = href.split("#", 1)[0]?.split("?", 1)[0] ?? href;
  return decodeURIComponent(withoutFragment.replace(/^\/+/, "")).replace(/\\/g, "/");
}

export function readZipBuffer(filePath: string, href: string, maxBytes = MAX_DOCUMENT_BYTES): Promise<Buffer> {
  const wanted = cleanZipHref(href);
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(openError ?? new Error("Unable to open EPUB archive."));
        return;
      }

      let settled = false;
      const fail = (error: Error) => {
        if (!settled) {
          settled = true;
          zip.close();
          reject(error);
        }
      };

      zip.on("error", fail);
      zip.on("end", () => {
        if (!settled) {
          fail(new Error(`EPUB resource not found: ${wanted}`));
        }
      });
      zip.on("entry", (entry) => {
        const candidate = cleanZipHref(entry.fileName);
        if (candidate !== wanted) {
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > maxBytes) {
          fail(new Error(`EPUB resource exceeds ${maxBytes} bytes.`));
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(streamError ?? new Error("Unable to read EPUB resource."));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              stream.destroy(new Error("EPUB document expanded beyond the safe limit."));
              return;
            }
            chunks.push(chunk);
          });
          stream.on("error", fail);
          stream.on("end", () => {
            if (!settled) {
              settled = true;
              resolve(Buffer.concat(chunks));
              zip.close();
            }
          });
        });
      });
      zip.readEntry();
    });
  });
}

export async function readZipText(filePath: string, href: string): Promise<string> {
  return (await readZipBuffer(filePath, href)).toString("utf8");
}

const IMAGE_MIME = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);
const COVER_MIME = new Set<PublicationCoverDto["type"]>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function coverMime(value: unknown): PublicationCoverDto["type"] | undefined {
  const normalized = String(value ?? "").toLowerCase().replace("image/jpg", "image/jpeg");
  return COVER_MIME.has(normalized as PublicationCoverDto["type"])
    ? normalized as PublicationCoverDto["type"]
    : undefined;
}

function sniffImageMime(bytes: Buffer): PublicationCoverDto["type"] | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

export async function readEpubCover(filePath: string, cover: PublicationCoverDto): Promise<Buffer> {
  const bytes = await readZipBuffer(filePath, cover.href, MAX_IMAGE_BYTES);
  const actual = sniffImageMime(bytes);
  if (!actual || actual !== cover.type) throw new Error("EPUB cover bytes do not match a supported raster image type.");
  return bytes;
}

function resolvePublicationAsset(documentHref: string, source: string): string | undefined {
  const withoutFragment = source.split("#", 1)[0]?.split("?", 1)[0]?.trim() ?? "";
  if (!withoutFragment || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(withoutFragment)) return undefined;
  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    return undefined;
  }
  const rootRelative = decoded.startsWith("/");
  const resolved = posix.normalize(rootRelative
    ? decoded.replace(/^\/+/, "")
    : posix.join(posix.dirname(cleanZipHref(documentHref)), decoded));
  try {
    assertSafeZipEntryName(resolved);
  } catch {
    return undefined;
  }
  return resolved;
}

export async function readEpubResource(filePath: string, href: string): Promise<string> {
  let html = await readZipText(filePath, href);
  const sources = new Set<string>();
  const sourcePattern = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi;
  for (const match of html.matchAll(sourcePattern)) {
    if (match[2]) sources.add(match[2]);
  }
  const replacements = new Map<string, string>();
  for (const source of sources) {
    const asset = resolvePublicationAsset(href, source);
    const mime = asset ? IMAGE_MIME.get(extname(asset).toLowerCase()) : undefined;
    if (!asset || !mime) {
      replacements.set(source, "");
      continue;
    }
    try {
      const bytes = await readZipBuffer(filePath, asset, MAX_IMAGE_BYTES);
      replacements.set(source, `data:${mime};base64,${bytes.toString("base64")}`);
    } catch {
      replacements.set(source, "");
    }
  }
  html = html.replace(sourcePattern, (full, quote: string, source: string) => {
    const replacement = replacements.get(source);
    return replacement === undefined ? full : full.replace(`${quote}${source}${quote}`, `${quote}${replacement}${quote}`);
  });
  return html;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  const object = record(value);
  if (object["#text"] !== undefined) return textValue(object["#text"]);
  return Object.entries(object)
    .filter(([key]) => !["href", "src", "id", "type", "properties", "media-type", "idref", "linear", "class"].includes(key))
    .map(([, entry]) => textValue(entry))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function publicationHref(basePath: string, href: string): string | undefined {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return undefined;
  const [pathPart, fragment] = href.split("#", 2);
  const normalized = posix.normalize(pathPart?.startsWith("/")
    ? pathPart.replace(/^\/+/, "")
    : posix.join(posix.dirname(basePath), pathPart ?? ""));
  try {
    assertSafeZipEntryName(normalized);
  } catch {
    return undefined;
  }
  return fragment ? `${normalized}#${fragment}` : normalized;
}

function navList(olValue: unknown, navPath: string): PublicationLinkDto[] {
  const ol = record(olValue);
  return asArray(ol.li).flatMap((entry): PublicationLinkDto[] => {
    const li = record(entry);
    const anchors = asArray(li.a);
    const anchor = record(anchors[0]);
    const href = typeof anchor.href === "string" ? publicationHref(navPath, anchor.href) : undefined;
    const children = asArray(li.ol).flatMap((nested) => navList(nested, navPath));
    if (!href) return children;
    return [{ href, title: textValue(anchor) || textValue(li.span) || undefined, children: children.length ? children : undefined }];
  });
}

function collectNamed(value: unknown, name: string, output: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectNamed(entry, name, output));
    return output;
  }
  const object = record(value);
  for (const [key, entry] of Object.entries(object)) {
    if (key === name) asArray(entry).forEach((candidate) => output.push(record(candidate)));
    collectNamed(entry, name, output);
  }
  return output;
}

async function parseNav(filePath: string, navPath: string): Promise<PublicationLinkDto[]> {
  const parsed = xmlParser.parse(await readZipText(filePath, navPath)) as unknown;
  const nav = collectNamed(parsed, "nav").find((candidate) => String(candidate.type ?? "").split(/\s+/).includes("toc"))
    ?? collectNamed(parsed, "nav")[0];
  if (!nav) return [];
  return asArray(nav.ol).flatMap((ol) => navList(ol, navPath));
}

function ncxPoints(value: unknown, ncxPath: string): PublicationLinkDto[] {
  return asArray(value).flatMap((entry): PublicationLinkDto[] => {
    const point = record(entry);
    const content = record(point.content);
    const href = typeof content.src === "string" ? publicationHref(ncxPath, content.src) : undefined;
    const children = ncxPoints(point.navPoint, ncxPath);
    if (!href) return children;
    return [{
      href,
      title: textValue(record(point.navLabel).text) || undefined,
      children: children.length ? children : undefined,
    }];
  });
}

async function parseNcx(filePath: string, ncxPath: string): Promise<PublicationLinkDto[]> {
  const parsed = record(xmlParser.parse(await readZipText(filePath, ncxPath)));
  const ncx = record(parsed.ncx);
  return ncxPoints(record(ncx.navMap).navPoint, ncxPath);
}

async function parsePublication(filePath: string, bookId: string): Promise<PublicationDto> {
  const container = record(xmlParser.parse(await readZipText(filePath, "META-INF/container.xml")));
  const rootfiles = record(record(container.container).rootfiles);
  const rootfile = record(asArray(rootfiles.rootfile)[0]);
  const opfPath = typeof rootfile["full-path"] === "string" ? cleanZipHref(rootfile["full-path"]) : "";
  if (!opfPath) throw new Error("EPUB container does not name a package document.");
  const parsedPackage = record(xmlParser.parse(await readZipText(filePath, opfPath)));
  const packageDocument = record(parsedPackage.package);
  const metadata = record(packageDocument.metadata);
  const manifest = asArray(record(packageDocument.manifest).item).map(record);
  const manifestById = new Map(manifest.flatMap((item) => typeof item.id === "string" ? [[item.id, item] as const] : []));
  const spine = record(packageDocument.spine);
  const readingOrder = asArray(spine.itemref).flatMap((entry): PublicationLinkDto[] => {
    const itemref = record(entry);
    if (String(itemref.linear ?? "yes").toLowerCase() === "no") return [];
    const item = typeof itemref.idref === "string" ? manifestById.get(itemref.idref) : undefined;
    const href = item && typeof item.href === "string" ? publicationHref(opfPath, item.href) : undefined;
    return href ? [{ href, type: typeof item?.["media-type"] === "string" ? item["media-type"] : undefined }] : [];
  });
  const navItem = manifest.find((item) => String(item.properties ?? "").split(/\s+/).includes("nav"));
  const ncxItem = (typeof spine.toc === "string" ? manifestById.get(spine.toc) : undefined)
    ?? manifest.find((item) => item["media-type"] === "application/x-dtbncx+xml");
  let toc: PublicationLinkDto[] = [];
  if (navItem && typeof navItem.href === "string") {
    const navPath = publicationHref(opfPath, navItem.href);
    if (navPath) toc = await parseNav(filePath, cleanZipHref(navPath));
  } else if (ncxItem && typeof ncxItem.href === "string") {
    const ncxPath = publicationHref(opfPath, ncxItem.href);
    if (ncxPath) toc = await parseNcx(filePath, cleanZipHref(ncxPath));
  }
  const toCover = (item: Record<string, unknown> | undefined): PublicationCoverDto | undefined => {
    const type = coverMime(item?.["media-type"]);
    const href = item && typeof item.href === "string" ? publicationHref(opfPath, item.href) : undefined;
    return type && href ? { href: cleanZipHref(href), type } : undefined;
  };
  const epub3Cover = manifest.find((item) => String(item.properties ?? "").split(/\s+/).includes("cover-image"));
  const epub2CoverId = asArray(metadata.meta).map(record)
    .find((item) => String(item.name ?? "").toLowerCase() === "cover" && typeof item.content === "string")?.content;
  const epub2Cover = typeof epub2CoverId === "string" ? manifestById.get(epub2CoverId) : undefined;
  const guideReference = asArray(record(packageDocument.guide).reference).map(record)
    .find((item) => String(item.type ?? "").toLowerCase().split(/\s+/).includes("cover"));
  let guideCover: PublicationCoverDto | undefined;
  if (guideReference && typeof guideReference.href === "string") {
    const guideHref = publicationHref(opfPath, guideReference.href);
    const direct = guideHref ? manifest.find((item) => {
      const href = typeof item.href === "string" ? publicationHref(opfPath, item.href) : undefined;
      return href && cleanZipHref(href) === cleanZipHref(guideHref);
    }) : undefined;
    guideCover = toCover(direct);
    if (!guideCover && guideHref) {
      try {
        const guidePath = cleanZipHref(guideHref);
        const html = await readZipText(filePath, guidePath);
        const source = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i.exec(html)?.[2];
        const asset = source ? resolvePublicationAsset(guidePath, source) : undefined;
        const type = asset ? coverMime(IMAGE_MIME.get(extname(asset).toLowerCase())) : undefined;
        if (asset && type) guideCover = { href: asset, type };
      } catch {
        // A broken guide cover must never prevent the publication from opening.
      }
    }
  }
  const fallbackCover = manifest.find((item) => {
    if (!coverMime(item["media-type"])) return false;
    return /(?:^|[-_.\/])cover(?:[-_.\/]|$)/i.test(`${String(item.id ?? "")} ${String(item.href ?? "")}`);
  });
  const cover = toCover(epub3Cover) ?? toCover(epub2Cover) ?? guideCover ?? toCover(fallbackCover);
  return {
    bookId,
    sourcePath: filePath,
    title: textValue(metadata.title) || "Untitled",
    author: asArray(metadata.creator).map(textValue).filter(Boolean).join(", ") || "Unknown author",
    languages: asArray(metadata.language).map(textValue).filter(Boolean),
    readingOrder,
    toc,
    cover,
  };
}

function hasReadableText(html: string): boolean {
  const text = html
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&[a-z0-9#]+;/gi, "x")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 20;
}

export async function openEpub(filePath: string, preferredHref?: string): Promise<OpenPublicationResult> {
  if (extname(filePath).toLowerCase() !== ".epub") {
    throw new Error("EPUB adapter only accepts .epub files.");
  }
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_EPUB_BYTES) {
    throw new Error("EPUB size is invalid or exceeds the safety limit.");
  }

  await preflightEpubArchive(filePath);
  const bookId = await sha256File(filePath);
  const publication = await parsePublication(filePath, bookId);
  const first = publication.readingOrder[0];
  if (!first) {
    throw new Error("EPUB has no linear reading order.");
  }

  const preferredBase = preferredHref ? cleanZipHref(preferredHref) : "";
  let selected = publication.readingOrder.find((candidate) => cleanZipHref(candidate.href) === preferredBase) ?? first;
  let rawHtml = await readEpubResource(filePath, selected.href);
  if (!preferredBase && !hasReadableText(rawHtml)) {
    for (const candidate of publication.readingOrder.slice(1)) {
      const candidateHtml = await readEpubResource(filePath, candidate.href);
      if (hasReadableText(candidateHtml)) {
        selected = candidate;
        rawHtml = candidateHtml;
        break;
      }
    }
  }
  return { publication, href: selected.href, rawHtml };
}
