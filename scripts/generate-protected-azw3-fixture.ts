import { strict as assert } from "node:assert";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

async function main(): Promise<void> {
  const source = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const target = process.argv[3] ? resolve(process.argv[3]) : resolve("fixtures/generated/protected-header.azw3");
  if (!source) {
    throw new Error("Usage: tsx scripts/generate-protected-azw3-fixture.ts <source.azw3> [target.azw3]");
  }

  const data = await readFile(source);
  assert.ok(data.length >= 86, "Source is too short to be a Palm Database container.");
  assert.equal(data.toString("ascii", 60, 68), "BOOKMOBI", "Source is not a Kindle/MOBI container.");
  const firstRecordOffset = data.readUInt32BE(78);
  assert.ok(firstRecordOffset >= 86 && firstRecordOffset + 40 <= data.length, "Invalid first record offset.");
  assert.equal(data.toString("ascii", firstRecordOffset + 16, firstRecordOffset + 20), "MOBI", "MOBI header is missing.");
  assert.equal(data.readUInt16BE(firstRecordOffset + 12), 0, "Source is already marked as encrypted.");

  data.writeUInt16BE(2, firstRecordOffset + 12);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
  process.stdout.write(JSON.stringify({ source, target, encryptionType: 2, synthetic: true }, null, 2));
}

void main();
