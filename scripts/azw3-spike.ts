import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { inspectAzw3Header, openAzw3, ProtectedPublicationError } from "../packages/publication/src/azw3";

async function main(): Promise<void> {
  const source = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const protectedFixture = process.argv[3] ? resolve(process.argv[3]) : undefined;
  if (!source || !protectedFixture) {
    throw new Error("Usage: tsx scripts/azw3-spike.ts <no-drm.azw3> <protected-fixture.azw3>");
  }
  const converter = resolve("native/azw3/bin/mobitool.exe");

  const sourceHeader = await inspectAzw3Header(source);
  assert.equal(sourceHeader.encryptionType, 0);
  assert.ok(sourceHeader.fileVersion >= 8);
  const opened = await openAzw3(source, converter);
  assert.equal(opened.publication.title, "Alice's Adventures in Wonderland");
  assert.equal(opened.publication.author, "Lewis Carroll");
  assert.ok(opened.publication.readingOrder.length >= 12);
  assert.ok(opened.publication.toc.length >= 12);

  const protectedHeader = await inspectAzw3Header(protectedFixture);
  assert.notEqual(protectedHeader.encryptionType, 0);
  let protectedRejected = false;
  try {
    await openAzw3(protectedFixture, converter);
  } catch (error) {
    protectedRejected = error instanceof ProtectedPublicationError && error.message === "此文件受保护，无法读取。";
  }
  assert.equal(protectedRejected, true, "Protected AZW3 fixture was not rejected with the required message.");

  process.stdout.write(JSON.stringify({
    source,
    sourceHeader,
    title: opened.publication.title,
    author: opened.publication.author,
    bookId: opened.publication.bookId,
    readingOrderCount: opened.publication.readingOrder.length,
    tocCount: opened.publication.toc.length,
    firstHref: opened.href,
    protectedFixture,
    protectedHeader,
    protectedRejected,
  }, null, 2));
}

void main();
