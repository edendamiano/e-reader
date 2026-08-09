import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { openEpub } from "../packages/publication/src/epub";

async function main(): Promise<void> {
  const requestedPath = process.argv[2];
  const fixture = requestedPath ? resolve(process.cwd(), requestedPath) : resolve(process.cwd(), "fixtures/generated/phase0.epub");
  const opened = await openEpub(fixture);
  assert.ok(opened.publication.title.length > 0);
  assert.ok(opened.publication.readingOrder.length > 0);
  if (!requestedPath) {
    assert.equal(opened.publication.title, "E-Reader Phase 0 Fixture");
    assert.equal(opened.publication.readingOrder.length, 2);
    assert.ok(opened.publication.toc.length >= 2);
    assert.ok(opened.rawHtml.includes("Transformer architecture"));
  }
  process.stdout.write(JSON.stringify({
    title: opened.publication.title,
    author: opened.publication.author,
    bookId: opened.publication.bookId,
    readingOrder: opened.publication.readingOrder.map((link) => link.href),
    toc: opened.publication.toc.map((link) => link.title),
    firstHref: opened.href,
  }, null, 2));
}

void main();
