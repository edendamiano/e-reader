import { createWriteStream, promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { ZipFile } from "yazl";

const FIXTURE_TIME = new Date("2020-01-01T00:00:00Z");

function addText(zip: ZipFile, name: string, text: string, compress = true): void {
  zip.addBuffer(Buffer.from(text, "utf8"), name, { compress, mtime: FIXTURE_TIME, mode: 0o100644 });
}

async function writeEpub(outputPath: string, malicious = false): Promise<void> {
  await fs.mkdir(dirname(outputPath), { recursive: true });
  const zip = new ZipFile();
  const output = createWriteStream(outputPath);
  zip.outputStream.pipe(output);

  addText(zip, "mimetype", "application/epub+zip", false);
  zip.addBuffer(await fs.readFile(resolve(process.cwd(), "packaging/assets/icon.png")), "OEBPS/reader-image.png", { compress: true, mtime: FIXTURE_TIME, mode: 0o100644 });
  addText(zip, "META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  addText(zip, "OEBPS/package.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:ereader-phase0</dc:identifier>
    <dc:title>E-Reader Phase 0 Fixture</dc:title>
    <dc:creator>Codex synthetic fixture</dc:creator>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="reader-image" href="reader-image.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`);
  addText(zip, "OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
<head><title>目录</title></head><body><nav epub:type="toc"><ol>
<li><a href="chapter1.xhtml">第一章</a></li><li><a href="chapter2.xhtml">第二章</a></li>
</ol></nav></body></html>`);

  const paragraphs = Array.from({ length: 34 }, (_, index) => `<p>这是第 ${index + 1} 段混合排版测试文字。我们使用 Transformer architecture 检查中英混排，并包含数字 2026、缩写 AI 与百分数 37%。The same paragraph also contains an English sentence for stable pagination and typography.</p>`).join("\n");
  const attack = malicious
    ? `<script>window.top.__EPUB_SCRIPT_EXECUTED__ = true</script><img src="https://example.invalid/tracker.png" onerror="window.top.__EPUB_HANDLER_EXECUTED__=true"/><iframe src="https://example.invalid/"></iframe>`
    : "";
  addText(zip, "OEBPS/chapter1.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN"><head><title>第一章</title></head>
<body><h1>第一章 安静的页面</h1><p>一句中文。</p><p>One English sentence.</p><img src="reader-image.png" alt="Color image grayscale test"/>${paragraphs}${attack}</body></html>`);
  addText(zip, "OEBPS/chapter2.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>Chapter Two</title></head>
<body><h1>Chapter Two</h1><p>The locator should survive a font-size change near this sentence.</p></body></html>`);

  zip.end();
  await finished(output);
}

async function main(): Promise<void> {
  const root = resolve(process.cwd(), "fixtures/generated");
  await writeEpub(resolve(root, "phase0.epub"));
  await writeEpub(resolve(root, "malicious.epub"), true);
  await fs.writeFile(resolve(root, "malformed.epub"), Buffer.from("not a zip", "utf8"));
  process.stdout.write(`${root}\n`);
}

void main();
