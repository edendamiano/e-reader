import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { openPublication } from "../../../packages/publication/src";
import type { LibrarySort, ReaderSettings, ReadingLocator } from "../../../packages/shared/src/types";
import { LibraryService, type LibraryPaths } from "./library-service";
import { hardenWindow, lockDownSession, senderIsTrusted } from "./security";
import { ReadingStateStore } from "./state-store";
import { TtsSidecar } from "./tts-sidecar";

app.setName("EReader");
const repoRoot = resolve(__dirname, "../..");
const rendererFile = resolve(__dirname, "../renderer/index.html");
const smokeTest = process.argv.includes("--smoke-test");
let mainWindow: BrowserWindow | undefined;
let legacyStateStore: ReadingStateStore;
let library: LibraryService;
let tts: TtsSidecar;
let paths: LibraryPaths;

function dataPaths(): LibraryPaths {
  const configured = process.env.EREADER_DATA_ROOT;
  const localRoot = configured
    ? resolve(configured)
    : process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "EReader")
      : app.getPath("userData");
  return {
    root: localRoot,
    library: join(localRoot, "library"),
    database: join(localRoot, "database", "reader.sqlite3"),
    ttsCache: join(localRoot, "tts-cache"),
    models: join(localRoot, "models"),
    logs: join(localRoot, "logs"),
  };
}

function log(line: string): void {
  const logRoot = paths?.logs ?? join(app.getPath("userData"), "logs");
  mkdirSync(logRoot, { recursive: true });
  appendFileSync(join(logRoot, "reader.log"), `${new Date().toISOString()} ${line}\n`, "utf8");
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!senderIsTrusted(event.sender, rendererFile)) throw new Error("Untrusted IPC sender.");
}

function assertBookId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw new Error("Invalid book id.");
}

async function openLegacyPath(filePath: string) {
  try {
    const opened = await openPublication(filePath, repoRoot);
    opened.restoredLocator = await legacyStateStore.load(opened.publication.bookId);
    return opened;
  } catch (error) {
    log(`[publication:open-failed] path=${filePath} error=${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    throw error;
  }
}

function setReadingMode(reading: boolean): void {
  if (!mainWindow || smokeTest) return;
  mainWindow.setFullScreen(reading);
}

function registerIpc(): void {
  ipcMain.handle("app:startup", async (event) => {
    assertTrustedSender(event);
    const settings = library.getSettings();
    if (smokeTest && process.env.EREADER_STARTUP_MODE === "fixture") {
      const configured = process.env.EREADER_DEFAULT_BOOK;
      const resume = await openLegacyPath(configured ? resolve(configured) : resolve(repoRoot, "fixtures/generated/phase0.epub"));
      return { books: [], settings, resume };
    }
    return {
      books: await library.listBooks(),
      settings,
      resume: await library.resumeLastBook(),
    };
  });
  ipcMain.handle("library:list", async (event, query: unknown, sort: unknown) => {
    assertTrustedSender(event);
    if (typeof query !== "string" || query.length > 200 || (sort !== "recent" && sort !== "title")) throw new Error("Invalid library query.");
    return library.listBooks(query, sort as LibrarySort);
  });
  ipcMain.handle("library:choose-import", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "E-books", extensions: ["epub", "azw3"] }],
    });
    return result.canceled ? [] : library.importPaths(result.filePaths);
  });
  ipcMain.handle("library:import-paths", async (event, candidates: unknown) => {
    assertTrustedSender(event);
    if (!Array.isArray(candidates) || candidates.length > 100 || candidates.some((path) => typeof path !== "string" || path.length > 32_768)) {
      throw new Error("Invalid import paths.");
    }
    return library.importPaths(candidates as string[]);
  });
  ipcMain.handle("library:import-test-paths", async (event, candidates: unknown) => {
    assertTrustedSender(event);
    if (!smokeTest || !Array.isArray(candidates) || candidates.some((path) => typeof path !== "string")) throw new Error("Test import API is disabled.");
    return library.importPaths(candidates as string[]);
  });
  ipcMain.handle("library:open", async (event, bookId: unknown) => {
    assertTrustedSender(event);
    assertBookId(bookId);
    const opened = await library.openBook(bookId);
    setReadingMode(true);
    return opened;
  });
  ipcMain.handle("library:delete", async (event, bookId: unknown) => {
    assertTrustedSender(event);
    assertBookId(bookId);
    await library.deleteBook(bookId);
  });
  ipcMain.handle("publication:resource", async (event, bookId: unknown, href: unknown) => {
    assertTrustedSender(event);
    assertBookId(bookId);
    if (typeof href !== "string") throw new Error("Invalid publication href.");
    return library.loadResource(bookId, href);
  });
  ipcMain.handle("settings:get", (event) => {
    assertTrustedSender(event);
    return library.getSettings();
  });
  ipcMain.handle("settings:save", (event, settings: unknown) => {
    assertTrustedSender(event);
    if (!settings || typeof settings !== "object") throw new Error("Invalid settings.");
    return library.saveSettings(settings as ReaderSettings);
  });
  ipcMain.handle("window:reading-mode", (event, reading: unknown) => {
    assertTrustedSender(event);
    if (typeof reading !== "boolean") throw new Error("Invalid reading mode.");
    setReadingMode(reading);
  });
  ipcMain.handle("publication:open-default", async (event) => {
    assertTrustedSender(event);
    if (!smokeTest) throw new Error("Development fixture API is disabled.");
    const configured = process.env.EREADER_DEFAULT_BOOK;
    return openLegacyPath(configured ? resolve(configured) : resolve(repoRoot, "fixtures/generated/phase0.epub"));
  });
  ipcMain.handle("locator:load", async (event, bookId: unknown) => {
    assertTrustedSender(event);
    assertBookId(bookId);
    return library.containsBook(bookId) ? library.loadLocator(bookId) : legacyStateStore.load(bookId);
  });
  ipcMain.handle("locator:save", async (event, locator: unknown) => {
    assertTrustedSender(event);
    if (!locator || typeof locator !== "object") throw new Error("Invalid locator.");
    const value = locator as ReadingLocator;
    if (library.containsBook(value.bookId)) library.saveLocator(value);
    else if (smokeTest) await legacyStateStore.save(value);
    else throw new Error("Locator does not belong to a library book.");
  });
  ipcMain.handle("tts:health", async (event) => {
    assertTrustedSender(event);
    return tts.health();
  });
  ipcMain.handle("tts:synthesize", async (event, payload: unknown) => {
    assertTrustedSender(event);
    if (!payload || typeof payload !== "object") throw new Error("Invalid TTS request.");
    const { text, speed, context } = payload as { text?: unknown; speed?: unknown; context?: unknown };
    if (typeof text !== "string" || text.length === 0 || text.length > 2_000 || typeof speed !== "number" || speed < 0.5 || speed > 2) {
      throw new Error("Invalid TTS request.");
    }
    return tts.synthesize(text, speed, context && typeof context === "object" ? context as Record<string, unknown> : {});
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 700,
    minHeight: 540,
    show: false,
    backgroundColor: "#f4f0e7",
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolve(__dirname, "../preload/index.cjs"),
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  hardenWindow(mainWindow, rendererFile);
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    log(`[renderer:load-failed] code=${code} description=${description} url=${url} expected=${rendererFile}`);
  });
  void mainWindow.loadFile(rendererFile).catch((error) => log(`[renderer:load-promise] ${String(error)}`));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = undefined; });
}

app.whenReady().then(async () => {
  paths = dataPaths();
  lockDownSession(rendererFile);
  legacyStateStore = new ReadingStateStore(join(paths.database, "..", "legacy-reading-state"), log);
  library = new LibraryService(paths, repoRoot, log);
  await library.initialize();
  tts = new TtsSidecar(repoRoot, paths.ttsCache, log);
  registerIpc();
  createWindow();
  void tts.start().catch((error) => log(`[tts:init] ${String(error)}`));
}).catch((error) => {
  log(`[app:init-failed] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  tts?.shutdown();
  library?.close();
});
