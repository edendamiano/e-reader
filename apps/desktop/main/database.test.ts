import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryDatabase } from "./database";

let root = "";
const BOOK = {
  id: "a".repeat(64),
  sha256: "a".repeat(64),
  format: "epub" as const,
  title: "A Book",
  author: "An Author",
  sourceFilename: "a.epub",
  libraryPath: "C:\\library\\a\\source.epub",
  normalizedPath: undefined,
  coverPath: "C:\\library\\a\\cover.svg",
  addedAt: "2026-08-10T00:00:00.000Z",
  lastOpenedAt: undefined,
  languageHint: "en",
};

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "ereader-database-test-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("LibraryDatabase migrations and transactions", () => {
  it("initializes a new database and reopens without repeating migrations", () => {
    const path = join(root, "reader.sqlite3");
    const first = new LibraryDatabase(path);
    expect(first.getSchemaVersion()).toBe(2);
    first.insertBook(BOOK);
    first.close();

    const reopened = new LibraryDatabase(path);
    expect(reopened.getSchemaVersion()).toBe(2);
    expect(reopened.getBook(BOOK.id)?.title).toBe("A Book");
    reopened.close();
  });

  it("upgrades an existing version-one database", () => {
    const path = join(root, "reader.sqlite3");
    const versionOne = new LibraryDatabase(path, 1);
    expect(versionOne.getSchemaVersion()).toBe(1);
    versionOne.close();

    const upgraded = new LibraryDatabase(path);
    expect(upgraded.getSchemaVersion()).toBe(2);
    upgraded.insertBook(BOOK);
    expect(upgraded.listBooks("", "title")).toHaveLength(1);
    upgraded.close();
  });

  it("rolls back a failed transaction", () => {
    const database = new LibraryDatabase(join(root, "reader.sqlite3"));
    expect(() => database.transaction(() => {
      database.insertBook(BOOK);
      throw new Error("stop");
    })).toThrow("stop");
    expect(database.getBook(BOOK.id)).toBeUndefined();
    database.close();
  });
});
