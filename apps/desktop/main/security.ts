import { session, type BrowserWindow, type WebContents } from "electron";
import { resolve } from "node:path";

export function lockDownSession(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let protocol = "";
    try {
      protocol = new URL(details.url).protocol;
    } catch {
      callback({ cancel: true });
      return;
    }
    const allowed = protocol === "file:" || protocol === "data:" || protocol === "blob:" || protocol === "devtools:";
    callback({ cancel: !allowed });
  });
}

export function hardenWindow(window: BrowserWindow, rendererFile: string): void {
  const expected = new URL(`file:///${resolve(rendererFile).replace(/\\/g, "/")}`).href;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== expected) {
      event.preventDefault();
    }
  });
  window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInWorker = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    delete webPreferences.preload;
    const source = params.src ?? "";
    if (!source.startsWith("file:") && !source.startsWith("data:")) {
      event.preventDefault();
    }
  });
}

export function senderIsTrusted(sender: WebContents, rendererFile: string): boolean {
  const actual = sender.getURL();
  const expectedPath = resolve(rendererFile).replace(/\\/g, "/").toLowerCase();
  try {
    const parsed = new URL(actual);
    return parsed.protocol === "file:" && decodeURIComponent(parsed.pathname).replace(/^\//, "").toLowerCase() === expectedPath;
  } catch {
    return false;
  }
}
