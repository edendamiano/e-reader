import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { openPublication } from "../../../packages/publication/src";
import type { ReadingLocator } from "../../../packages/shared/src/types";
import { hardenWindow, lockDownSession, senderIsTrusted } from "./security";
import { ReadingStateStore } from "./state-store";
import { TtsSidecar } from "./tts-sidecar";

const repoRoot = resolve(__dirname, "../..");
const rendererFile = resolve(__dirname, "../renderer/index.html");
let mainWindow: BrowserWindow | undefined;
let stateStore: ReadingStateStore;
let tts: TtsSidecar;

function log(line: string): void {
  const logRoot = join(app.getPath("userData"), "logs");
  mkdirSync(logRoot, { recursive: true });
  appendFileSync(join(logRoot, "reader.log"), `${new Date().toISOString()} ${line}\n`, "utf8");
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!senderIsTrusted(event.sender, rendererFile)) {
    throw new Error("Untrusted IPC sender.");
  }
}

async function openPath(filePath: string) {
  try {
    const opened = await openPublication(filePath, repoRoot);
    opened.restoredLocator = await stateStore.load(opened.publication.bookId);
    return opened;
  } catch (error) {
    log(`[publication:open-failed] path=${filePath} error=${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    throw error;
  }
}

function registerIpc(): void {
  ipcMain.handle("publication:open-default", async (event) => {
    assertTrustedSender(event);
    const configuredFixture = process.env.EREADER_DEFAULT_BOOK;
    return openPath(configuredFixture ? resolve(configuredFixture) : resolve(repoRoot, "fixtures/generated/phase0.epub"));
  });
  ipcMain.handle("publication:choose", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile"],
      filters: [{ name: "E-books", extensions: ["epub", "azw3"] }],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return openPath(result.filePaths[0]);
  });
  ipcMain.handle("locator:load", async (event, bookId: unknown) => {
    assertTrustedSender(event);
    if (typeof bookId !== "string") {
      throw new Error("Invalid book id.");
    }
    return stateStore.load(bookId);
  });
  ipcMain.handle("locator:save", async (event, locator: unknown) => {
    assertTrustedSender(event);
    if (!locator || typeof locator !== "object") {
      throw new Error("Invalid locator.");
    }
    await stateStore.save(locator as ReadingLocator);
  });
  ipcMain.handle("tts:health", async (event) => {
    assertTrustedSender(event);
    return tts.health();
  });
  ipcMain.handle("tts:synthesize", async (event, payload: unknown) => {
    assertTrustedSender(event);
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid TTS request.");
    }
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
  mainWindow.once("ready-to-show", () => {
    if (!process.argv.includes("--smoke-test")) {
      mainWindow?.setFullScreen(true);
    }
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

app.whenReady().then(() => {
  lockDownSession();
  stateStore = new ReadingStateStore(join(app.getPath("userData"), "database", "reading-state"), log);
  tts = new TtsSidecar(repoRoot, join(app.getPath("userData"), "tts-cache"), log);
  registerIpc();
  createWindow();
  void tts.start().catch((error) => log(`[tts:init] ${String(error)}`));
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => tts?.shutdown());
