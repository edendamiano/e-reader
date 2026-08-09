import { useCallback, useEffect, useState } from "react";
import type { ImportResult, LibraryBook, LibrarySort, OpenPublicationResult, ReaderSettings } from "../../../../packages/shared/src/types";
import { LibraryView } from "./LibraryView";
import { ReaderSurface } from "./ReaderSurface";
import { SettingsView } from "./SettingsView";

type Screen = "loading" | "library" | "reader" | "settings";

function importNotice(results: ImportResult[]): string {
  if (results.length === 0) return "";
  const imported = results.filter((result) => result.status === "imported").length;
  const duplicates = results.filter((result) => result.status === "duplicate").length;
  const failed = results.filter((result) => result.status === "failed");
  if (failed.some((result) => result.message?.includes("此文件受保护"))) return "此文件受保护，无法读取。";
  if (failed.length > 0) return `${imported ? `已导入 ${imported} 本；` : ""}${failed.length} 个文件无法导入。`;
  if (duplicates > 0 && imported === 0) return "此书已在书架中";
  return `已导入 ${imported} 本${duplicates ? `，跳过 ${duplicates} 本重复书籍` : ""}。`;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [opened, setOpened] = useState<OpenPublicationResult>();
  const [settings, setSettings] = useState<ReaderSettings>();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [notice, setNotice] = useState("");

  const refreshBooks = useCallback(async (nextQuery = query, nextSort = sort) => {
    setBooks(await window.ereader.listBooks(nextQuery, nextSort));
  }, [query, sort]);

  useEffect(() => {
    void window.ereader.startup().then((state) => {
      setBooks(state.books);
      setSettings(state.settings);
      if (state.resume) {
        setOpened(state.resume);
        setScreen("reader");
      } else {
        setScreen("library");
      }
    }).catch(() => {
      setNotice("应用数据无法打开，请查看日志。 ");
      setScreen("library");
    });
  }, []);

  const handleImportResults = useCallback(async (results: ImportResult[]) => {
    setNotice(importNotice(results));
    await refreshBooks();
  }, [refreshBooks]);

  const chooseAndImport = useCallback(async () => {
    try {
      await handleImportResults(await window.ereader.chooseAndImport());
    } catch {
      setNotice("无法导入所选文件。技术细节已写入日志。");
    }
  }, [handleImportResults]);

  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "o" && screen !== "reader") {
        event.preventDefault();
        void chooseAndImport();
      }
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, [chooseAndImport, screen]);

  const openBook = useCallback(async (bookId: string) => {
    try {
      setNotice("");
      const result = await window.ereader.openLibraryBook(bookId);
      setOpened(result);
      setScreen("reader");
    } catch {
      setNotice("无法打开此书，文件可能已损坏或被移除。");
      setScreen("library");
    }
  }, []);

  const leaveReader = useCallback(async () => {
    await window.ereader.setReadingMode(false);
    setOpened(undefined);
    await refreshBooks();
    setScreen("library");
  }, [refreshBooks]);

  const saveSettings = useCallback(async (next: ReaderSettings) => {
    const saved = await window.ereader.saveSettings(next);
    setSettings(saved);
  }, []);

  if (screen === "loading" || !settings) return <div className="center-message">正在打开书架…</div>;
  if (screen === "reader" && opened) {
    return <ReaderSurface key={opened.publication.bookId} opened={opened} settings={settings} onExit={leaveReader} onSettingsChange={saveSettings} />;
  }
  if (screen === "settings") {
    return <SettingsView settings={settings} onChange={saveSettings} onBack={() => setScreen("library")} />;
  }
  return (
    <LibraryView
      books={books}
      query={query}
      sort={sort}
      notice={notice}
      onQueryChange={(value) => {
        setQuery(value);
        void refreshBooks(value, sort);
      }}
      onSortChange={(value) => {
        setSort(value);
        void refreshBooks(query, value);
      }}
      onImport={chooseAndImport}
      onDropImport={async (files) => handleImportResults(await window.ereader.importDroppedFiles(files))}
      onOpen={openBook}
      onDelete={async (bookId) => {
        await window.ereader.deleteLibraryBook(bookId);
        setNotice("已从书架删除；原始文件未受影响。");
        await refreshBooks();
      }}
      onSettings={() => setScreen("settings")}
    />
  );
}
