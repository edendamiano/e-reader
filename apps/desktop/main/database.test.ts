import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  originalCoverPath: undefined,
  coverMime: undefined,
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
    expect(first.getSchemaVersion()).toBe(4);
    first.insertBook(BOOK);
    first.close();

    const reopened = new LibraryDatabase(path);
    expect(reopened.getSchemaVersion()).toBe(4);
    expect(reopened.getBook(BOOK.id)?.title).toBe("A Book");
    reopened.close();
  });

  it("upgrades an existing version-one database", () => {
    const path = join(root, "reader.sqlite3");
    const versionOne = new LibraryDatabase(path, 1);
    expect(versionOne.getSchemaVersion()).toBe(1);
    versionOne.close();

    const upgraded = new LibraryDatabase(path);
    expect(upgraded.getSchemaVersion()).toBe(4);
    upgraded.insertBook(BOOK);
    expect(upgraded.listBooks("", "title")).toHaveLength(1);
    upgraded.close();
  });

  it("upgrades a version-two library without changing existing cover records", () => {
    const path = join(root, "reader.sqlite3");
    const versionTwo = new LibraryDatabase(path, 2);
    versionTwo.close();
    const oldDatabase = new DatabaseSync(path);
    oldDatabase.prepare(`INSERT INTO books(
      id, sha256, format, title, author, source_filename, library_path, normalized_path,
      cover_path, added_at, last_opened_at, language_hint, sort_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      BOOK.id, BOOK.sha256, BOOK.format, BOOK.title, BOOK.author, BOOK.sourceFilename,
      BOOK.libraryPath, null, BOOK.coverPath, BOOK.addedAt, null, BOOK.languageHint, "a book",
    );
    oldDatabase.close();

    const upgraded = new LibraryDatabase(path);
    expect(upgraded.getSchemaVersion()).toBe(4);
    expect(upgraded.getBook(BOOK.id)).toMatchObject({ coverPath: BOOK.coverPath });
    expect(upgraded.getBook(BOOK.id)?.originalCoverPath).toBeUndefined();
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
