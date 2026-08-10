import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BookFormat, LibrarySort, ReaderSettings, ReadingLocator } from "../../../packages/shared/src/types";

export interface BookRecord {
  id: string;
  sha256: string;
  format: BookFormat;
  title: string;
  author: string;
  sourceFilename: string;
  libraryPath: string;
  normalizedPath?: string;
  coverPath: string;
  originalCoverPath?: string;
  coverMime?: string;
  addedAt: string;
  lastOpenedAt?: string;
  languageHint?: string;
  progress: number;
}

interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial-library",
    sql: `
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL UNIQUE,
        format TEXT NOT NULL CHECK(format IN ('epub', 'azw3')),
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        source_filename TEXT NOT NULL,
        library_path TEXT NOT NULL,
        normalized_path TEXT,
        cover_path TEXT NOT NULL,
        added_at TEXT NOT NULL,
        last_opened_at TEXT,
        language_hint TEXT
      );
      CREATE TABLE reading_state (
        book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        locator_json TEXT NOT NULL,
        total_progression REAL NOT NULL DEFAULT 0 CHECK(total_progression >= 0 AND total_progression <= 1),
        tts_locator_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "library-sort-indexes",
    sql: `
      ALTER TABLE books ADD COLUMN sort_title TEXT NOT NULL DEFAULT '';
      UPDATE books SET sort_title = lower(title);
      CREATE INDEX books_recent_idx ON books(last_opened_at DESC, added_at DESC);
      CREATE INDEX books_title_idx ON books(sort_title, title);
    `,
  },
  {
    version: 3,
    name: "original-cover-assets",
    sql: `
      ALTER TABLE books ADD COLUMN original_cover_path TEXT;
      ALTER TABLE books ADD COLUMN cover_mime TEXT;
    `,
  },
  {
    version: 4,
    name: "remove-tts-state",
    sql: `ALTER TABLE reading_state DROP COLUMN tts_locator_json;`,
  },
] as const;

const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 21,
  lineHeight: 1.72,
  pageMargin: 8,
  theme: "day",
  showProgress: true,
};

function now(): string {
  return new Date().toISOString();
}

function rowToBook(row: Record<string, unknown>): BookRecord {
  return {
    id: String(row.id),
    sha256: String(row.sha256),
    format: row.format as BookFormat,
    title: String(row.title),
    author: String(row.author),
    sourceFilename: String(row.source_filename),
    libraryPath: String(row.library_path),
    normalizedPath: row.normalized_path ? String(row.normalized_path) : undefined,
    coverPath: String(row.cover_path),
    originalCoverPath: row.original_cover_path ? String(row.original_cover_path) : undefined,
    coverMime: row.cover_mime ? String(row.cover_mime) : undefined,
    addedAt: String(row.added_at),
    lastOpenedAt: row.last_opened_at ? String(row.last_opened_at) : undefined,
    languageHint: row.language_hint ? String(row.language_hint) : undefined,
    progress: typeof row.total_progression === "number" ? row.total_progression : 0,
  };
}

export function validateSettings(candidate: Partial<ReaderSettings> | undefined): ReaderSettings {
  const source = candidate ?? {};
  return {
    fontSize: typeof source.fontSize === "number" && source.fontSize >= 14 && source.fontSize <= 36 ? source.fontSize : DEFAULT_SETTINGS.fontSize,
    lineHeight: typeof source.lineHeight === "number" && source.lineHeight >= 1.3 && source.lineHeight <= 2.2 ? source.lineHeight : DEFAULT_SETTINGS.lineHeight,
    pageMargin: typeof source.pageMargin === "number" && source.pageMargin >= 4 && source.pageMargin <= 16 ? source.pageMargin : DEFAULT_SETTINGS.pageMargin,
    theme: source.theme === "night" ? "night" : "day",
    showProgress: typeof source.showProgress === "boolean" ? source.showProgress : DEFAULT_SETTINGS.showProgress,
  };
}

export class LibraryDatabase {
  private readonly database: DatabaseSync;

  public constructor(databasePath: string, targetVersion = MIGRATIONS.at(-1)?.version ?? 0) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    this.migrate(targetVersion);
  }

  private migrate(targetVersion: number): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const current = this.getSchemaVersion();
    for (const migration of MIGRATIONS) {
      if (migration.version <= current || migration.version > targetVersion) continue;
      this.transaction(() => {
        this.database.exec(migration.sql);
        this.database.prepare("INSERT INTO schema_version(version, name, applied_at) VALUES (?, ?, ?)")
          .run(migration.version, migration.name, now());
      });
    }
  }

  public getSchemaVersion(): number {
    const row = this.database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_version").get() as { version?: number } | undefined;
    return Number(row?.version ?? 0);
  }

  public transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.database.exec("COMMIT");
      return value;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public insertBook(book: Omit<BookRecord, "progress">): void {
    this.database.prepare(`
      INSERT INTO books(
        id, sha256, format, title, author, source_filename, library_path,
        normalized_path, cover_path, original_cover_path, cover_mime,
        added_at, last_opened_at, language_hint, sort_title
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      book.id,
      book.sha256,
      book.format,
      book.title,
      book.author,
      book.sourceFilename,
      book.libraryPath,
      book.normalizedPath ?? null,
      book.coverPath,
      book.originalCoverPath ?? null,
      book.coverMime ?? null,
      book.addedAt,
      book.lastOpenedAt ?? null,
      book.languageHint ?? null,
      book.title.toLocaleLowerCase(),
    );
  }

  public getBook(bookId: string): BookRecord | undefined {
    const row = this.database.prepare(`
      SELECT b.*, COALESCE(r.total_progression, 0) AS total_progression
      FROM books b LEFT JOIN reading_state r ON r.book_id = b.id
      WHERE b.id = ?
    `).get(bookId) as Record<string, unknown> | undefined;
    return row ? rowToBook(row) : undefined;
  }

  public findBySha256(sha256: string): BookRecord | undefined {
    const row = this.database.prepare(`
      SELECT b.*, COALESCE(r.total_progression, 0) AS total_progression
      FROM books b LEFT JOIN reading_state r ON r.book_id = b.id
      WHERE b.sha256 = ?
    `).get(sha256) as Record<string, unknown> | undefined;
    return row ? rowToBook(row) : undefined;
  }

  public listBooks(query = "", sort: LibrarySort = "recent"): BookRecord[] {
    const order = sort === "title"
      ? "b.sort_title COLLATE NOCASE ASC, b.title COLLATE NOCASE ASC"
      : "COALESCE(b.last_opened_at, b.added_at) DESC, b.title COLLATE NOCASE ASC";
    const rows = this.database.prepare(`
      SELECT b.*, COALESCE(r.total_progression, 0) AS total_progression
      FROM books b LEFT JOIN reading_state r ON r.book_id = b.id
      WHERE (? = '' OR b.title LIKE ? ESCAPE '\\')
      ORDER BY ${order}
    `).all(query, `%${query.replace(/[\\%_]/g, "\\$&")}%`) as Record<string, unknown>[];
    return rows.map(rowToBook);
  }

  public deleteBook(bookId: string): void {
    this.database.prepare("DELETE FROM books WHERE id = ?").run(bookId);
  }

  public touchBook(bookId: string, openedAt = now()): void {
    this.database.prepare("UPDATE books SET last_opened_at = ? WHERE id = ?").run(openedAt, bookId);
  }

  public saveReadingState(locator: ReadingLocator): void {
    const total = Math.max(0, Math.min(1, locator.locations.totalProgression ?? locator.locations.progression ?? 0));
    this.database.prepare(`
      INSERT INTO reading_state(book_id, locator_json, total_progression, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(book_id) DO UPDATE SET
        locator_json = excluded.locator_json,
        total_progression = excluded.total_progression,
        updated_at = excluded.updated_at
    `).run(locator.bookId, JSON.stringify(locator), total, now());
  }

  public loadReadingState(bookId: string): ReadingLocator | undefined {
    const row = this.database.prepare("SELECT locator_json FROM reading_state WHERE book_id = ?").get(bookId) as { locator_json?: string } | undefined;
    if (!row?.locator_json) return undefined;
    try {
      const locator = JSON.parse(row.locator_json) as ReadingLocator;
      if (locator.bookId !== bookId || typeof locator.href !== "string" || !locator.locations) return undefined;
      return locator;
    } catch {
      return undefined;
    }
  }

  public getResumeBook(): BookRecord | undefined {
    const row = this.database.prepare(`
      SELECT b.*, r.total_progression
      FROM books b INNER JOIN reading_state r ON r.book_id = b.id
      WHERE b.last_opened_at IS NOT NULL
      ORDER BY b.last_opened_at DESC LIMIT 1
    `).get() as Record<string, unknown> | undefined;
    return row ? rowToBook(row) : undefined;
  }

  public getSettings(): ReaderSettings {
    const row = this.database.prepare("SELECT value_json FROM settings WHERE key = 'reader'").get() as { value_json?: string } | undefined;
    if (!row?.value_json) return { ...DEFAULT_SETTINGS };
    try {
      return validateSettings(JSON.parse(row.value_json) as Partial<ReaderSettings>);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  public saveSettings(settings: ReaderSettings): ReaderSettings {
    const clean = validateSettings(settings);
    this.database.prepare(`
      INSERT INTO settings(key, value_json, updated_at) VALUES ('reader', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(JSON.stringify(clean), now());
    return clean;
  }

  public close(): void {
    this.database.close();
  }
}
