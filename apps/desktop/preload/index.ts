import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { EReaderBridge, LibrarySort, ReaderSettings, ReadingLocator } from "../../../packages/shared/src/types";

const bridge: EReaderBridge = Object.freeze({
  startup: () => ipcRenderer.invoke("app:startup"),
  listBooks: (query: string, sort: LibrarySort) => ipcRenderer.invoke("library:list", query, sort),
  chooseAndImport: () => ipcRenderer.invoke("library:choose-import"),
  importDroppedFiles: (files: File[]) => ipcRenderer.invoke("library:import-paths", files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)),
  importTestPaths: (paths: string[]) => ipcRenderer.invoke("library:import-test-paths", paths),
  openLibraryBook: (bookId: string) => ipcRenderer.invoke("library:open", bookId),
  deleteLibraryBook: (bookId: string) => ipcRenderer.invoke("library:delete", bookId),
  loadPublicationResource: (bookId: string, href: string) => ipcRenderer.invoke("publication:resource", bookId, href),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: ReaderSettings) => ipcRenderer.invoke("settings:save", settings),
  setReadingMode: (reading: boolean) => ipcRenderer.invoke("window:reading-mode", reading),
  openDefaultFixture: () => ipcRenderer.invoke("publication:open-default"),
  loadSavedLocator: (bookId: string) => ipcRenderer.invoke("locator:load", bookId),
  saveLocator: (locator: ReadingLocator) => ipcRenderer.invoke("locator:save", locator),
});

contextBridge.exposeInMainWorld("ereader", bridge);
