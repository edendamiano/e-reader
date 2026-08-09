import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { extname } from "node:path";
import { disableTypes } from "image-size";
import { PublicationParsePromise } from "r2-shared-js/dist/es8-es2017/src/parser/publication-parser";
import type { Link } from "r2-shared-js/dist/es8-es2017/src/models/publication-link";
import type { Publication } from "r2-shared-js/dist/es8-es2017/src/models/publication";
import yauzl, { type Entry } from "yauzl";
import type { OpenPublicationResult, PublicationDto, PublicationLinkDto } from "../../shared/src/types";

const MAX_EPUB_BYTES = 1_000_000_000;
const MAX_DOCUMENT_BYTES = 16_000_000;
const MAX_INITIAL_SPINE_SCAN = 16;
const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_ARCHIVE_EXPANDED_BYTES = 2_000_000_000;
const MAX_ENTRY_EXPANDED_BYTES = 256_000_000;
const MAX_SUSPICIOUS_COMPRESSION_RATIO = 1_000;

// image-size <= 2.0.2 has no patched release for infinite-loop bugs in these
// non-core EPUB formats. Readium only needs ordinary EPUB raster dimensions,
// so remove the vulnerable detectors before any publication is parsed.
disableTypes(["heif", "icns", "jxl", "jxl-stream"]);

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

function localizedString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const entries = Object.values(value as Record<string, unknown>);
    const first = entries.find((entry): entry is string => typeof entry === "string");
    return first ?? "";
  }
  return "";
}

function linkToDto(link: Link): PublicationLinkDto {
  return {
    href: link.HrefDecoded ?? link.Href,
    type: link.TypeLink || undefined,
    title: link.Title || undefined,
    children: link.Children?.map(linkToDto),
  };
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function cleanZipHref(href: string): string {
  const withoutFragment = href.split("#", 1)[0]?.split("?", 1)[0] ?? href;
  return decodeURIComponent(withoutFragment.replace(/^\/+/, "")).replace(/\\/g, "/");
}

export function readZipText(filePath: string, href: string): Promise<string> {
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
        if (entry.uncompressedSize > MAX_DOCUMENT_BYTES) {
          fail(new Error(`EPUB document exceeds ${MAX_DOCUMENT_BYTES} bytes.`));
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
            if (size > MAX_DOCUMENT_BYTES) {
              stream.destroy(new Error("EPUB document expanded beyond the safe limit."));
              return;
            }
            chunks.push(chunk);
          });
          stream.on("error", fail);
          stream.on("end", () => {
            if (!settled) {
              settled = true;
              resolve(Buffer.concat(chunks).toString("utf8"));
              zip.close();
            }
          });
        });
      });
      zip.readEntry();
    });
  });
}

function publicationToDto(publication: Publication, sourcePath: string, bookId: string): PublicationDto {
  const title = localizedString(publication.Metadata?.Title) || "Untitled";
  const author = publication.Metadata?.Author?.map((person) => localizedString(person.Name)).filter(Boolean).join(", ") || "Unknown author";
  return {
    bookId,
    sourcePath,
    title,
    author,
    languages: publication.Metadata?.Language ?? [],
    readingOrder: publication.Spine?.map(linkToDto) ?? [],
    toc: publication.TOC?.map(linkToDto) ?? [],
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

export async function openEpub(filePath: string): Promise<OpenPublicationResult> {
  if (extname(filePath).toLowerCase() !== ".epub") {
    throw new Error("Phase 0 EPUB adapter only accepts .epub files.");
  }
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_EPUB_BYTES) {
    throw new Error("EPUB size is invalid or exceeds the safety limit.");
  }

  await preflightEpubArchive(filePath);
  const [bookId, parsed] = await Promise.all([sha256File(filePath), PublicationParsePromise(filePath)]);
  try {
    const publication = publicationToDto(parsed, filePath, bookId);
    const first = publication.readingOrder[0];
    if (!first) {
      throw new Error("EPUB has no linear reading order.");
    }

    let selected = first;
    let rawHtml = await readZipText(filePath, first.href);
    if (!hasReadableText(rawHtml)) {
      for (const candidate of publication.readingOrder.slice(1, MAX_INITIAL_SPINE_SCAN)) {
        const candidateHtml = await readZipText(filePath, candidate.href);
        if (hasReadableText(candidateHtml)) {
          selected = candidate;
          rawHtml = candidateHtml;
          break;
        }
      }
    }
    return { publication, href: selected.href, rawHtml };
  } finally {
    parsed.freeDestroy();
  }
}
