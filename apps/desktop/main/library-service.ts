import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { basename, extname, join, parse, resolve } from "node:path";
import { cleanZipHref, openEpub, readEpubResource, sha256File } from "../../../packages/publication/src/epub";
import { normalizeAzw3ToEpub, ProtectedPublicationError } from "../../../packages/publication/src/azw3";
import type {
  ImportResult,
  LibraryBook,
  LibrarySort,
  OpenPublicationResult,
  PublicationDto,
  PublicationResourceResult,
  ReaderSettings,
  ReadingLocator,
} from "../../../packages/shared/src/types";
import { LibraryDatabase, type BookRecord } from "./database";

const BOOK_ID_PATTERN = /^[a-f0-9]{64}$/i;

export interface LibraryPaths {
  root: string;
  library: string;
  database: string;
  ttsCache: string;
  models: string;
  logs: string;
}

interface CachedPublication {
  path: string;
  publication: PublicationDto;
}

function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

function safeTitle(opened: OpenPublicationResult, sourcePath: string): string {
  const title = opened.publication.title.trim();
  return title && title !== "Untitled" ? title : parse(sourcePath).name;
}

function safeAuthor(opened: OpenPublicationResult): string {
  const author = opened.publication.author.trim();
  return author && author !== "Unknown author" ? author : "未知作者";
}

function userMessage(error: unknown): string {
  if (error instanceof ProtectedPublicationError || (error instanceof Error && error.message.includes("此文件受保护"))) {
    return "此文件受保护，无法读取。";
  }
  return "无法导入此书，文件可能已损坏或格式不受支持。";
}

export class LibraryService {
  private readonly database: LibraryDatabase;
  private readonly publicationCache = new Map<string, CachedPublication>();

  public constructor(
    private readonly paths: LibraryPaths,
    private readonly repoRoot: string,
    private readonly logger: (line: string) => void = () => undefined,
  ) {
    this.database = new LibraryDatabase(paths.database);
  }

  public async initialize(): Promise<void> {
    await Promise.all([
      fs.mkdir(this.paths.library, { recursive: true }),
      fs.mkdir(this.paths.ttsCache, { recursive: true }),
      fs.mkdir(this.paths.models, { recursive: true }),
      fs.mkdir(this.paths.logs, { recursive: true }),
    ]);
    const entries = await fs.readdir(this.paths.library, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(this.paths.library, entry.name);
      if (entry.name.startsWith(".import-") || entry.name.startsWith(".delete-")) {
        await fs.rm(path, { recursive: true, force: true });
      } else if (BOOK_ID_PATTERN.test(entry.name) && !this.database.getBook(entry.name)) {
        this.logger(`[library:orphan-cleanup] path=${path}`);
        await fs.rm(path, { recursive: true, force: true });
      }
    }
  }

  private async coverDataUrl(path: string): Promise<string> {
    try {
      const bytes = await fs.readFile(path);
      return `data:image/svg+xml;base64,${bytes.toString("base64")}`;
    } catch {
      return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='480' height='720'%3E%3Crect width='100%25' height='100%25' fill='%23ded7c8'/%3E%3C/svg%3E";
    }
  }

  private async toLibraryBook(record: BookRecord): Promise<LibraryBook> {
    return {
      id: record.id,
      sha256: record.sha256,
      format: record.format,
      title: record.title,
      author: record.author,
      sourceFilename: record.sourceFilename,
      addedAt: record.addedAt,
      lastOpenedAt: record.lastOpenedAt,
      languageHint: record.languageHint,
      progress: record.progress,
      coverDataUrl: await this.coverDataUrl(record.coverPath),
    };
  }

  public async listBooks(query = "", sort: LibrarySort = "recent"): Promise<LibraryBook[]> {
    return Promise.all(this.database.listBooks(query.trim(), sort).map((record) => this.toLibraryBook(record)));
  }

  private async writePlaceholderCover(path: string, title: string, author: string): Promise<void> {
    const titleLines = title.length > 24 ? [title.slice(0, 24), title.slice(24, 48)] : [title];
    const titleMarkup = titleLines.map((line, index) => `<text x="50%" y="${46 + index * 8}%" text-anchor="middle" font-family="Georgia,serif" font-size="30" fill="#292824">${xmlEscape(line)}</text>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720" viewBox="0 0 480 720"><rect width="480" height="720" fill="#e7e0d2"/><path d="M72 92h336M72 628h336" stroke="#9b8f79" stroke-width="2"/>${titleMarkup}<text x="50%" y="68%" text-anchor="middle" font-family="Georgia,serif" font-size="18" fill="#70695d">${xmlEscape(author.slice(0, 48))}</text></svg>`;
    await fs.writeFile(path, svg, "utf8");
  }

  public async importPaths(sourcePaths: string[]): Promise<ImportResult[]> {
    const unique = Array.from(new Set(sourcePaths.map((path) => resolve(path)))).slice(0, 100);
    const results: ImportResult[] = [];
    for (const sourcePath of unique) {
      try {
        results.push(await this.importOne(sourcePath));
      } catch (error) {
        this.logger(`[library:import-failed] path=${sourcePath} error=${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        results.push({ sourcePath, status: "failed", message: userMessage(error) });
      }
    }
    return results;
  }

  private async importOne(sourcePath: string): Promise<ImportResult> {
    const extension = extname(sourcePath).toLowerCase();
    if (extension !== ".epub" && extension !== ".azw3") throw new Error("Unsupported extension.");
    const sourceStat = await fs.stat(sourcePath);
    if (!sourceStat.isFile()) throw new Error("Import source is not a file.");
    const sha256 = await sha256File(sourcePath);
    const duplicate = this.database.findBySha256(sha256);
    if (duplicate) {
      return { sourcePath, status: "duplicate", message: "此书已在书架中", book: await this.toLibraryBook(duplicate) };
    }

    const staging = join(this.paths.library, `.import-${randomUUID()}`);
    const sourceName = `source${extension}`;
    const stagedSource = join(staging, sourceName);
    const stagedNormalized = extension === ".azw3" ? join(staging, "publication.epub") : undefined;
    await fs.mkdir(staging, { recursive: false });
    let finalRoot = "";
    try {
      await fs.copyFile(sourcePath, stagedSource, constants.COPYFILE_EXCL);
      let publicationPath = stagedSource;
      if (extension === ".azw3") {
        const normalized = await normalizeAzw3ToEpub(
          stagedSource,
          resolve(this.repoRoot, "native/azw3/bin/mobitool.exe"),
          stagedNormalized!,
        );
        if (normalized.bookId !== sha256) throw new Error("AZW3 identity changed during import.");
        publicationPath = normalized.normalizedPath;
      }
      const opened = await openEpub(publicationPath);
      const title = safeTitle(opened, sourcePath);
      const author = safeAuthor(opened);
      const coverPath = join(staging, "cover.svg");
      await this.writePlaceholderCover(coverPath, title, author);

      finalRoot = join(this.paths.library, sha256);
      if (await fs.stat(finalRoot).then(() => true).catch(() => false)) {
        await fs.rm(finalRoot, { recursive: true, force: true });
      }
      await fs.rename(staging, finalRoot);
      const addedAt = new Date().toISOString();
      const record: Omit<BookRecord, "progress"> = {
        id: sha256,
        sha256,
        format: extension === ".azw3" ? "azw3" : "epub",
        title,
        author,
        sourceFilename: basename(sourcePath),
        libraryPath: join(finalRoot, sourceName),
        normalizedPath: stagedNormalized ? join(finalRoot, "publication.epub") : undefined,
        coverPath: join(finalRoot, "cover.svg"),
        addedAt,
        languageHint: opened.publication.languages[0],
      };
      try {
        this.database.transaction(() => this.database.insertBook(record));
      } catch (error) {
        await fs.rm(finalRoot, { recursive: true, force: true });
        throw error;
      }
      const book = await this.toLibraryBook({ ...record, progress: 0 });
      return { sourcePath, status: "imported", book };
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      if (finalRoot) await fs.rm(finalRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private publicationPath(record: BookRecord): string {
    return record.normalizedPath ?? record.libraryPath;
  }

  public async openBook(bookId: string): Promise<OpenPublicationResult> {
    if (!BOOK_ID_PATTERN.test(bookId)) throw new Error("Invalid book id.");
    const record = this.database.getBook(bookId);
    if (!record) throw new Error("Book is not in the library.");
    const locator = this.database.loadReadingState(bookId);
    const path = this.publicationPath(record);
    const opened = await openEpub(path, locator?.href);
    opened.publication.bookId = bookId;
    opened.publication.sourcePath = record.libraryPath;
    opened.restoredLocator = locator;
    this.publicationCache.set(bookId, { path, publication: opened.publication });
    this.database.touchBook(bookId);
    return opened;
  }

  public async loadResource(bookId: string, href: string): Promise<PublicationResourceResult> {
    if (!BOOK_ID_PATTERN.test(bookId) || typeof href !== "string" || href.length > 4_096) throw new Error("Invalid publication resource request.");
    let cached = this.publicationCache.get(bookId);
    if (!cached) {
      const record = this.database.getBook(bookId);
      if (!record) throw new Error("Book is not in the library.");
      const path = this.publicationPath(record);
      const opened = await openEpub(path);
      opened.publication.bookId = bookId;
      cached = { path, publication: opened.publication };
      this.publicationCache.set(bookId, cached);
    }
    const wanted = cleanZipHref(href);
    const link = cached.publication.readingOrder.find((candidate) => cleanZipHref(candidate.href) === wanted);
    if (!link) throw new Error("Publication resource is outside the reading order.");
    return { href: link.href, rawHtml: await readEpubResource(cached.path, link.href) };
  }

  public saveLocator(locator: ReadingLocator): void {
    if (!BOOK_ID_PATTERN.test(locator.bookId) || !this.database.getBook(locator.bookId)) throw new Error("Invalid locator book id.");
    this.database.transaction(() => {
      this.database.saveReadingState(locator);
      this.database.touchBook(locator.bookId);
    });
  }

  public loadLocator(bookId: string): ReadingLocator | undefined {
    return this.database.loadReadingState(bookId);
  }

  public containsBook(bookId: string): boolean {
    return Boolean(BOOK_ID_PATTERN.test(bookId) && this.database.getBook(bookId));
  }

  public async resumeLastBook(): Promise<OpenPublicationResult | undefined> {
    const candidate = this.database.getResumeBook();
    if (!candidate) return undefined;
    try {
      return await this.openBook(candidate.id);
    } catch (error) {
      this.logger(`[library:resume-failed] bookId=${candidate.id} error=${String(error)}`);
      return undefined;
    }
  }

  private async removeBookTtsCache(bookId: string): Promise<void> {
    const engines = await fs.readdir(this.paths.ttsCache, { withFileTypes: true }).catch(() => []);
    await Promise.all(engines.filter((entry) => entry.isDirectory()).map((entry) => fs.rm(join(this.paths.ttsCache, entry.name, bookId), { recursive: true, force: true })));
  }

  public async deleteBook(bookId: string): Promise<void> {
    if (!BOOK_ID_PATTERN.test(bookId)) throw new Error("Invalid book id.");
    const record = this.database.getBook(bookId);
    if (!record) return;
    const bookRoot = join(this.paths.library, bookId);
    const trash = join(this.paths.library, `.delete-${randomUUID()}`);
    await fs.rename(bookRoot, trash);
    try {
      this.database.transaction(() => this.database.deleteBook(bookId));
    } catch (error) {
      await fs.rename(trash, bookRoot).catch(() => undefined);
      throw error;
    }
    this.publicationCache.delete(bookId);
    await Promise.all([
      fs.rm(trash, { recursive: true, force: true }),
      this.removeBookTtsCache(bookId),
    ]);
  }

  public getSettings(): ReaderSettings {
    return this.database.getSettings();
  }

  public saveSettings(settings: ReaderSettings): ReaderSettings {
    return this.database.saveSettings(settings);
  }

  public close(): void {
    this.database.close();
  }
}
