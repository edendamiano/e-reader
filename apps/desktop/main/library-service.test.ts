import { createWriteStream, existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import type { LibraryPaths } from "./library-service";
import { LibraryService } from "./library-service";

const FIXTURE_TIME = new Date("2020-01-01T00:00:00Z");
let root = "";
let paths: LibraryPaths;
let service: LibraryService;

function addText(zip: ZipFile, name: string, text: string, compress = true): void {
  zip.addBuffer(Buffer.from(text, "utf8"), name, { compress, mtime: FIXTURE_TIME, mode: 0o100644 });
}

async function writeEpub(outputPath: string, title: string, author = "Fixture Author"): Promise<void> {
  await fs.mkdir(dirname(outputPath), { recursive: true });
  const zip = new ZipFile();
  const output = createWriteStream(outputPath);
  zip.outputStream.pipe(output);
  addText(zip, "mimetype", "application/epub+zip", false);
  addText(zip, "META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  addText(zip, "OEBPS/package.opf", `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">fixture-${title}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`);
  addText(zip, "OEBPS/nav.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml">Part One</a><ol><li><a href="two.xhtml">Part Two</a></li></ol></li></ol></nav></body></html>`);
  addText(zip, "OEBPS/one.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>${title}</h1><p>A durable library-owned sentence.</p></body></html>`);
  addText(zip, "OEBPS/two.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Second chapter</h1><p>Spine navigation remains available after the source disappears.</p></body></html>`);
  zip.end();
  await finished(output);
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "ereader-library-test-"));
  paths = {
    root,
    library: join(root, "library"),
    database: join(root, "database", "reader.sqlite3"),
    ttsCache: join(root, "tts-cache"),
    models: join(root, "models"),
    logs: join(root, "logs"),
  };
  service = new LibraryService(paths, resolve(__dirname, "../../.."));
  await service.initialize();
});

afterEach(async () => {
  service.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe("LibraryService import ownership", () => {
  it("copies an EPUB, generates a cover, and remains readable after the source is deleted", async () => {
    const source = join(root, "incoming", "daily.epub");
    await writeEpub(source, "Daily Reader");
    const [result] = await service.importPaths([source]);
    expect(result?.status).toBe("imported");
    expect(result?.book?.coverDataUrl).toMatch(/^data:image\/svg\+xml/);
    await fs.rm(source);

    const opened = await service.openBook(result!.book!.id);
    expect(opened.publication.title).toBe("Daily Reader");
    expect(opened.publication.readingOrder).toHaveLength(2);
    const second = await service.loadResource(result!.book!.id, opened.publication.readingOrder[1]!.href);
    expect(second.rawHtml).toContain("source disappears");
  });

  it("imports multiple files, rejects duplicate SHA, searches, sorts, and deletes app-owned copies", async () => {
    const alpha = join(root, "incoming", "alpha.epub");
    const beta = join(root, "incoming", "beta.epub");
    await writeEpub(alpha, "Alpha");
    await writeEpub(beta, "Beta");
    const imported = await service.importPaths([beta, alpha]);
    expect(imported.map((entry) => entry.status)).toEqual(["imported", "imported"]);
    const duplicate = await service.importPaths([alpha]);
    expect(duplicate[0]).toMatchObject({ status: "duplicate", message: "此书已在书架中" });
    expect((await service.listBooks("Alpha", "recent")).map((book) => book.title)).toEqual(["Alpha"]);
    expect((await service.listBooks("", "title")).map((book) => book.title)).toEqual(["Alpha", "Beta"]);

    const alphaBook = imported.find((entry) => entry.book?.title === "Alpha")!.book!;
    await service.deleteBook(alphaBook.id);
    expect(await service.listBooks("", "title")).toHaveLength(1);
    await expect(fs.stat(join(paths.library, alphaBook.id))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(alpha)).resolves.toBeDefined();
  });

  it("rolls back a damaged EPUB without leaving a partial book", async () => {
    const damaged = join(root, "incoming", "damaged.epub");
    await fs.mkdir(dirname(damaged), { recursive: true });
    await fs.writeFile(damaged, "not a zip", "utf8");
    const [result] = await service.importPaths([damaged]);
    expect(result?.status).toBe("failed");
    expect(await service.listBooks()).toEqual([]);
    expect(await fs.readdir(paths.library)).toEqual([]);
  });

  it("falls back to the filename and a generated cover when metadata is incomplete", async () => {
    const source = join(root, "incoming", "fallback-title.epub");
    await writeEpub(source, "", "");
    const [result] = await service.importPaths([source]);
    expect(result?.status).toBe("imported");
    expect(result?.book).toMatchObject({ title: "fallback-title", author: "未知作者" });
    expect(result?.book?.coverDataUrl).toMatch(/^data:image\/svg\+xml/);
  });

  const realAzw3 = resolve(__dirname, "../../../../..", "data-input", "pg11-images-kf8.azw3");
  it.skipIf(!existsSync(realAzw3))("persists a real no-DRM KF8 normalization and rejects a protected header", async () => {
    const incoming = join(root, "incoming");
    await fs.mkdir(incoming, { recursive: true });
    const source = join(incoming, "alice.azw3");
    await fs.copyFile(realAzw3, source);
    const [imported] = await service.importPaths([source]);
    expect(imported?.status).toBe("imported");
    await fs.rm(source);
    const opened = await service.openBook(imported!.book!.id);
    expect(opened.publication.title).toContain("Alice");
    expect(opened.publication.readingOrder).toHaveLength(19);

    const protectedPath = join(incoming, "protected.azw3");
    const protectedBytes = await fs.readFile(realAzw3);
    const firstRecordOffset = protectedBytes.readUInt32BE(78);
    protectedBytes.writeUInt16BE(2, firstRecordOffset + 12);
    await fs.writeFile(protectedPath, protectedBytes);
    const [rejected] = await service.importPaths([protectedPath]);
    expect(rejected).toMatchObject({ status: "failed", message: "此文件受保护，无法读取。" });
    expect(await service.listBooks()).toHaveLength(1);
  });
});
