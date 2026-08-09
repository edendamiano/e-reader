import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { openAzw3 } from "../packages/publication/src/azw3";
import { openEpub, readZipText, sha256File } from "../packages/publication/src/epub";
import type { PublicationLinkDto } from "../packages/shared/src/types";

const repoRoot = resolve(__dirname, "..");
const versionRoot = resolve(repoRoot, "../..");

function tocDepth(links: PublicationLinkDto[], depth = 1): number {
  return links.reduce((maximum, link) => Math.max(maximum, link.children?.length ? tocDepth(link.children, depth + 1) : depth), 0);
}

function visibleText(html: string): string {
  return html
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&[a-z0-9#]+;/gi, "x")
    .replace(/\s+/g, " ")
    .trim();
}

async function validateEpub(name: string, path: string) {
  const opened = await openEpub(path);
  let textCharacters = 0;
  let cjkCharacters = 0;
  let latinCharacters = 0;
  for (const link of opened.publication.readingOrder) {
    const text = visibleText(await readZipText(path, link.href));
    textCharacters += text.length;
    cjkCharacters += text.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
    latinCharacters += text.match(/[A-Za-z]/gu)?.length ?? 0;
  }
  return {
    name,
    path,
    sha256: await sha256File(path),
    title: opened.publication.title,
    author: opened.publication.author,
    languages: opened.publication.languages,
    readingOrderCount: opened.publication.readingOrder.length,
    tocCount: opened.publication.toc.length,
    tocDepth: tocDepth(opened.publication.toc),
    textCharacters,
    cjkCharacters,
    latinCharacters,
  };
}

async function main(): Promise<void> {
  const english = await validateEpub("long-english", resolve(versionRoot, "data-input/pg11-alice-epub3.epub"));
  const chinese = await validateEpub("long-chinese", resolve(versionRoot, "data-input/pg23839-analects-zh-epub3.epub"));
  const multiLevel = await validateEpub("multi-level-toc", resolve(versionRoot, "data-input/se-don-quixote.epub"));
  const azw3Path = resolve(versionRoot, "data-input/pg11-images-kf8.azw3");
  const azw3 = await openAzw3(azw3Path, resolve(repoRoot, "native/azw3/bin/mobitool.exe"));
  const kf8 = {
    name: "real-kf8",
    path: azw3Path,
    sha256: await sha256File(azw3Path),
    title: azw3.publication.title,
    author: azw3.publication.author,
    languages: azw3.publication.languages,
    readingOrderCount: azw3.publication.readingOrder.length,
    tocCount: azw3.publication.toc.length,
    tocDepth: tocDepth(azw3.publication.toc),
  };
  if (english.readingOrderCount < 5 || english.latinCharacters < 10_000) throw new Error("English real-book fixture is not long enough.");
  if (chinese.readingOrderCount < 2 || chinese.cjkCharacters < 5_000) throw new Error("Chinese real-book fixture is not long enough.");
  if (multiLevel.tocDepth < 2) throw new Error("The real multi-level fixture has a flat TOC.");
  if (kf8.readingOrderCount < 5) throw new Error("KF8 real-book validation failed.");
  const report = {
    validatedAt: new Date().toISOString(),
    status: "passed",
    books: [english, chinese, multiLevel, kf8],
  };
  const output = resolve(versionRoot, "data-output/real-book-validation.json");
  await fs.mkdir(resolve(output, ".."), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main();
