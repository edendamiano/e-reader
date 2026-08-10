import { session, type BrowserWindow, type WebContents } from "electron";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isAllowedRequestUrl(url: string, rendererFile: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "data:" || parsed.protocol === "blob:" || parsed.protocol === "devtools:") return true;
  if (parsed.protocol !== "file:") return false;
  try {
    const requested = resolve(fileURLToPath(parsed)).toLowerCase();
    const rendererRoot = dirname(resolve(rendererFile)).toLowerCase();
    return requested === rendererRoot || requested.startsWith(`${rendererRoot}\\`);
  } catch {
    return false;
  }
}

export function lockDownSession(rendererFile: string): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequestUrl(details.url, rendererFile) });
  });
}

export function hardenWindow(window: BrowserWindow, rendererFile: string, production = false): void {
  const expected = new URL(`file:///${resolve(rendererFile).replace(/\\/g, "/")}`).href;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (production) {
    window.webContents.on("before-input-event", (event, input) => {
      const devToolsShortcut = input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i");
      if (devToolsShortcut) event.preventDefault();
    });
  }
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
