import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen } from "electron";
import { join, resolve } from "node:path";
import { openPublication } from "../../../packages/publication/src";
import type { LibrarySort, ReaderSettings, ReadingLocator } from "../../../packages/shared/src/types";
import { LibraryService, type LibraryPaths } from "./library-service";
import { hardenWindow, lockDownSession, senderIsTrusted } from "./security";
import { ReadingStateStore } from "./state-store";
import { resolveLibraryPaths, resolveRuntimeRoot } from "./runtime-paths";
import { RotatingLogger } from "./rotating-logger";

app.setName("E-Reader");
app.setAppUserModelId("com.local.ereader");
const enforceSingleInstance = app.isPackaged && (!process.env.EREADER_DATA_ROOT || process.env.EREADER_ENFORCE_SINGLE_INSTANCE === "1");
const instanceLockAcquired = !enforceSingleInstance || app.requestSingleInstanceLock();
if (!instanceLockAcquired) app.quit();
const repoRoot = resolve(__dirname, "../..");
const runtimeRoot = resolveRuntimeRoot(app.isPackaged, process.resourcesPath, repoRoot);
if (app.isPackaged) process.env.EREADER_PACKAGED = "1";
const rendererFile = resolve(__dirname, "../renderer/index.html");
const smokeTest = process.argv.includes("--smoke-test");
const defaultFullscreen = process.env.EREADER_DEFAULT_FULLSCREEN === "1" || (!smokeTest && !process.env.EREADER_DATA_ROOT);
let mainWindow: BrowserWindow | undefined;
let legacyStateStore: ReadingStateStore;
let library: LibraryService;
let paths: LibraryPaths;
let logger: RotatingLogger | undefined;

if (instanceLockAcquired) {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });
}

function dataPaths(): LibraryPaths {
  return resolveLibraryPaths(process.env.EREADER_DATA_ROOT, process.env.LOCALAPPDATA, app.getPath("userData"));
}

function log(line: string): void {
  if (!logger) logger = new RotatingLogger(paths?.logs ?? join(app.getPath("userData"), "logs"));
  logger.write(line);
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!senderIsTrusted(event.sender, rendererFile)) throw new Error("Untrusted IPC sender.");
}

function assertBookId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw new Error("Invalid book id.");
}

async function openLegacyPath(filePath: string) {
  try {
    const opened = await openPublication(filePath, runtimeRoot);
    opened.restoredLocator = await legacyStateStore.load(opened.publication.bookId);
    return opened;
  } catch (error) {
    log(`[publication:open-failed] path=${filePath} error=${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    throw error;
  }
}

function setReadingMode(reading: boolean): void {
  if (!mainWindow || smokeTest) return;
  if (reading) mainWindow.setFullScreen(true);
  else if (!defaultFullscreen) mainWindow.setFullScreen(false);
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
}

function createWindow(): void {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1280, workArea.width);
  const height = Math.min(900, workArea.height);
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(700, width),
    minHeight: Math.min(540, height),
    fullscreen: defaultFullscreen,
    show: false,
    backgroundColor: "#f4f0e7",
    autoHideMenuBar: true,
    icon: app.isPackaged ? join(process.resourcesPath, "icon.png") : join(runtimeRoot, "packaging", "assets", "icon.png"),
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
  hardenWindow(mainWindow, rendererFile, app.isPackaged);
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    log(`[renderer:load-failed] code=${code} description=${description} url=${url} expected=${rendererFile}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log(`[renderer:gone] reason=${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.key !== "F11") return;
    event.preventDefault();
    mainWindow?.setFullScreen(!mainWindow.isFullScreen());
  });
  mainWindow.on("unresponsive", () => log("[renderer:unresponsive]"));
  void mainWindow.loadFile(rendererFile).catch((error) => log(`[renderer:load-promise] ${String(error)}`));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = undefined; });
}

app.whenReady().then(async () => {
  if (!instanceLockAcquired) return;
  paths = dataPaths();
  logger = new RotatingLogger(paths.logs);
  lockDownSession(rendererFile);
  legacyStateStore = new ReadingStateStore(join(paths.database, "..", "legacy-reading-state"), log);
  library = new LibraryService(paths, runtimeRoot, log, async (sourcePath, targetPath) => {
    const source = nativeImage.createFromPath(sourcePath);
    if (source.isEmpty()) throw new Error("Unsupported or damaged cover image.");
    const size = source.getSize();
    const scale = Math.min(1, 320 / Math.max(1, size.width), 480 / Math.max(1, size.height));
    const thumbnail = scale < 1
      ? source.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: "best" })
      : source;
    await import("node:fs/promises").then((module) => module.writeFile(targetPath, thumbnail.toPNG()));
  });
  await library.initialize();
  registerIpc();
  createWindow();
}).catch((error) => {
  log(`[app:init-failed] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  library?.close();
});
