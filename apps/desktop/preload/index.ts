import { contextBridge, ipcRenderer } from "electron";
import type { EReaderBridge, ReadingLocator } from "../../../packages/shared/src/types";

const bridge: EReaderBridge = Object.freeze({
  openDefaultFixture: () => ipcRenderer.invoke("publication:open-default"),
  chooseBook: () => ipcRenderer.invoke("publication:choose"),
  loadSavedLocator: (bookId: string) => ipcRenderer.invoke("locator:load", bookId),
  saveLocator: (locator: ReadingLocator) => ipcRenderer.invoke("locator:save", locator),
  ttsHealth: () => ipcRenderer.invoke("tts:health"),
  synthesize: (text: string, speed: number, context: Record<string, unknown>) => ipcRenderer.invoke("tts:synthesize", { text, speed, context }),
});

contextBridge.exposeInMainWorld("ereader", bridge);
