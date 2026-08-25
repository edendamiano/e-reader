import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUnitLocator, restoreUnitIndex } from "../../../../packages/locator/src/locator";
import type { OpenPublicationResult, PublicationLinkDto, ReaderSettings, ReadingLocator, ReadingUnit } from "../../../../packages/shared/src/types";
import { indexSearchChapter, normalizeSearchText, searchBook, searchChapterTitle, type BookSearchResult, type IndexedSearchChapter } from "./book-search";
import { prepareReaderDocument } from "./reader-document";

interface ReaderSurfaceProps {
  opened: OpenPublicationResult;
  settings: ReaderSettings;
  onExit(): Promise<void>;
  onSettingsChange(settings: ReaderSettings): Promise<void>;
}

function scrollingElement(frame: HTMLIFrameElement): HTMLElement | undefined {
  return frame.contentDocument?.getElementById("book-content") ?? undefined;
}

function paginationPitch(frame: HTMLIFrameElement, content: HTMLElement): number {
  const style = frame.contentWindow?.getComputedStyle(content);
  const columnWidth = Number.parseFloat(style?.columnWidth ?? "");
  const columnGap = Number.parseFloat(style?.columnGap ?? "");
  const measured = columnWidth + columnGap;
  return Number.isFinite(measured) && measured > 0 ? measured : Math.max(1, frame.clientWidth);
}

function hrefBase(href: string): string {
  return href.split("#", 1)[0]?.split("?", 1)[0] ?? href;
}

function clearSearchHighlights(document: Document | undefined): void {
  if (!document) return;
  const parents = new Set<Node>();
  for (const mark of Array.from(document.querySelectorAll("mark.reader-search-hit"))) {
    if (mark.parentNode) parents.add(mark.parentNode);
    mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
  }
  parents.forEach((parent) => parent.normalize());
}

function addSearchHighlights(document: Document, result: BookSearchResult): HTMLElement | undefined {
  const anchorId = result.highlights[0]?.unitId;
  const anchor = anchorId ? document.querySelector<HTMLElement>(`[data-reading-unit-id="${anchorId}"]`) : undefined;
  const expected = result.locator.text?.highlight;
  if (!anchor || (expected && !normalizeSearchText(anchor.textContent ?? "").startsWith(normalizeSearchText(expected)))) return undefined;
  clearSearchHighlights(document);
  let firstMark: HTMLElement | undefined;
  const ids = Array.from(new Set(result.highlights.map((highlight) => highlight.unitId)));

  for (const id of ids) {
    const unit = document.querySelector<HTMLElement>(`[data-reading-unit-id="${id}"]`);
    if (!unit) continue;
    const text = unit.textContent ?? "";
    const ranges = result.highlights.filter((highlight) => highlight.unitId === id).sort((left, right) => left.start - right.start);
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const range of ranges) {
      const start = Math.max(cursor, Math.min(text.length, range.start));
      const end = Math.max(start, Math.min(text.length, range.end));
      if (start > cursor) fragment.append(document.createTextNode(text.slice(cursor, start)));
      if (end > start) {
        const mark = document.createElement("mark");
        mark.className = "reader-search-hit";
        mark.textContent = text.slice(start, end);
        fragment.append(mark);
        firstMark ??= mark;
      }
      cursor = end;
    }
    if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
    unit.replaceChildren(fragment);
  }

  return firstMark;
}

function TocTree({ links, currentHref, onSelect, depth = 0 }: {
  links: PublicationLinkDto[];
  currentHref: string;
  onSelect(href: string): void;
  depth?: number;
}) {
  return (
    <ul className="toc-list">
      {links.map((link, index) => {
        const current = hrefBase(link.href) === hrefBase(currentHref);
        return (
          <li key={`${link.href}-${index}`}>
            <button type="button" className={current ? "is-current" : ""} style={{ paddingLeft: `${18 + depth * 18}px` }} onClick={() => onSelect(link.href)}>{link.title || "未命名章节"}</button>
            {link.children && link.children.length > 0 && <TocTree links={link.children} currentHref={currentHref} onSelect={onSelect} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

export function ReaderSurface({ opened, settings, onExit, onSettingsChange }: ReaderSurfaceProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<number>();
  const resizeTimerRef = useRef<number>();
  const transientTimerRef = useRef<number>();
  const searchTimerRef = useRef<number>();
  const highlightTimerRef = useRef<number>();
  const pageAnimationRef = useRef<number>();
  const pageRef = useRef(0);
  const pageCountRef = useRef(1);
  const viewLocatorRef = useRef<ReadingLocator | undefined>(opened.restoredLocator);
  const pendingRestoreRef = useRef<ReadingLocator | undefined>(opened.restoredLocator);
  const pendingSearchResultRef = useRef<BookSearchResult>();
  const searchIndexRef = useRef<IndexedSearchChapter[]>([]);
  const searchPromiseRef = useRef<Promise<void>>();
  const searchCompleteRef = useRef(false);
  const searchQueryRef = useRef("");
  const navigatingRef = useRef(false);
  const frameClickHandlerRef = useRef<(event: MouseEvent) => void>(() => undefined);
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  const [resource, setResource] = useState({ href: opened.href, rawHtml: opened.rawHtml });
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [totalProgress, setTotalProgress] = useState(opened.restoredLocator?.locations.totalProgression ?? 0);
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [message, setMessage] = useState("");
  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BookSearchResult[]>([]);
  const [searchProgress, setSearchProgress] = useState({ indexed: 0, total: 0, failed: 0, working: false });
  const locale = opened.publication.languages[0] ?? "und";
  const spine = opened.publication.readingOrder;
  const spineIndex = Math.max(0, spine.findIndex((link) => hrefBase(link.href) === hrefBase(resource.href)));
  const prepared = useMemo(
    () => prepareReaderDocument(resource.rawHtml, opened.publication.bookId, resource.href, locale),
    [locale, opened.publication.bookId, resource.href, resource.rawHtml],
  );

  const setTransientMessage = useCallback((value: string) => {
    window.clearTimeout(transientTimerRef.current);
    setMessage(value);
    if (value) transientTimerRef.current = window.setTimeout(() => setMessage(""), 1_400);
  }, []);

  const buildSearchIndex = useCallback(async () => {
    if (searchCompleteRef.current) return;
    if (searchPromiseRef.current) return searchPromiseRef.current;

    const indexing = (async () => {
      const chapters: IndexedSearchChapter[] = [];
      let failed = 0;
      setSearchProgress({ indexed: 0, total: spine.length, failed: 0, working: true });

      for (let index = 0; index < spine.length; index += 1) {
        const link = spine[index];
        if (!link) continue;
        try {
          const current = hrefBase(link.href) === hrefBase(resource.href);
          const loaded = current ? resource : await window.ereader.loadPublicationResource(opened.publication.bookId, link.href);
          const units = current ? prepared.units : prepareReaderDocument(loaded.rawHtml, opened.publication.bookId, loaded.href, locale).units;
          const title = searchChapterTitle(loaded.href, index, opened.publication.toc, units, link.title);
          chapters.push(indexSearchChapter(loaded.href, title, index, units));
          searchIndexRef.current = [...chapters];
          if (searchQueryRef.current.trim()) setSearchResults(searchBook(searchIndexRef.current, searchQueryRef.current));
        } catch {
          failed += 1;
        }
        setSearchProgress({ indexed: index + 1, total: spine.length, failed, working: true });
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }

      searchCompleteRef.current = true;
      setSearchProgress({ indexed: spine.length, total: spine.length, failed, working: false });
    })();

    searchPromiseRef.current = indexing.finally(() => {
      searchPromiseRef.current = undefined;
    });
    return searchPromiseRef.current;
  }, [locale, opened.publication.bookId, opened.publication.toc, prepared.units, resource, spine]);

  const showSearchHighlights = useCallback((document: Document, result: BookSearchResult): HTMLElement | undefined => {
    window.clearTimeout(highlightTimerRef.current);
    const mark = addSearchHighlights(document, result);
    highlightTimerRef.current = window.setTimeout(() => clearSearchHighlights(document), 4_500);
    return mark;
  }, []);

  const queueLocatorSave = useCallback((locator: ReadingLocator) => {
    viewLocatorRef.current = locator;
    setTotalProgress(locator.locations.totalProgression ?? 0);
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void window.ereader.saveLocator(locator).catch(() => setTransientMessage("阅读位置暂时无法保存。"));
    }, 250);
  }, [setTransientMessage]);

  const loadSpineIndex = useCallback(async (targetIndex: number, edge: "start" | "end") => {
    if (navigatingRef.current || targetIndex < 0 || targetIndex >= spine.length) return;
    navigatingRef.current = true;
    setTransientMessage("正在翻页…");
    const step = targetIndex >= spineIndex ? 1 : -1;
    try {
      for (let index = targetIndex; index >= 0 && index < spine.length; index += step) {
        const link = spine[index];
        if (!link) break;
        const next = await window.ereader.loadPublicationResource(opened.publication.bookId, link.href);
        const candidate = prepareReaderDocument(next.rawHtml, opened.publication.bookId, next.href, locale);
        if (candidate.units.length === 0) continue;
        const progression = edge === "end" ? 1 : 0;
        const locator: ReadingLocator = {
          bookId: opened.publication.bookId,
          href: next.href,
          locations: {
            progression,
            totalProgression: spine.length <= 1 ? progression : (index + progression) / spine.length,
          },
        };
        pendingRestoreRef.current = locator;
        viewLocatorRef.current = locator;
        setResource(next);
        setTocOpen(false);
        return;
      }
    } catch {
      setTransientMessage("无法打开下一章节。");
    } finally {
      navigatingRef.current = false;
    }
  }, [locale, opened.publication.bookId, setTransientMessage, spine, spineIndex]);

  const canonicalLocator = useCallback((unit: ReadingUnit, localProgression: number): ReadingLocator => {
    const index = prepared.units.findIndex((candidate) => candidate.id === unit.id);
    const total = spine.length <= 1 ? localProgression : (spineIndex + localProgression) / spine.length;
    return createUnitLocator(
      opened.publication.bookId,
      resource.href,
      unit.id,
      unit.text,
      localProgression,
      total,
      { before: prepared.units[index - 1]?.text, after: prepared.units[index + 1]?.text },
    );
  }, [opened.publication.bookId, prepared.units, resource.href, spine.length, spineIndex]);

  const applyPage = useCallback((nextPage: number, persist = true) => {
    const frame = iframeRef.current;
    const scrolling = frame ? scrollingElement(frame) : undefined;
    if (!frame || !scrolling) return;
    if (nextPage < 0) {
      window.cancelAnimationFrame(pageAnimationRef.current ?? 0);
      void loadSpineIndex(spineIndex - 1, "end");
      return;
    }
    if (nextPage >= pageCountRef.current) {
      window.cancelAnimationFrame(pageAnimationRef.current ?? 0);
      void loadSpineIndex(spineIndex + 1, "start");
      return;
    }
    const viewportWidth = Math.max(1, frame.clientWidth);
    const pitch = paginationPitch(frame, scrolling);
    const bounded = Math.max(0, Math.min(pageCountRef.current - 1, nextPage));
    const targetLeft = bounded * pitch;
    const startLeft = scrolling.scrollLeft;
    const distance = targetLeft - startLeft;
    window.cancelAnimationFrame(pageAnimationRef.current ?? 0);
    pageRef.current = bounded;
    setPage(bounded);

    const finish = () => {
      scrolling.scrollLeft = targetLeft;
      if (!persist || pageRef.current !== bounded) return;
      const visibleElement = Array.from(frame.contentDocument?.querySelectorAll<HTMLElement>("[data-reading-unit-id]") ?? []).find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > 0 && rect.left < viewportWidth && rect.bottom > 0 && rect.top < frame.clientHeight;
      });
      const visible = visibleElement?.dataset.readingUnitId
        ? prepared.units.find((unit) => unit.id === visibleElement.dataset.readingUnitId)
        : undefined;
      const local = pageCountRef.current <= 1 ? 0 : bounded / (pageCountRef.current - 1);
      if (visible) {
        queueLocatorSave(canonicalLocator(visible, local));
      } else {
        queueLocatorSave({
          bookId: opened.publication.bookId,
          href: resource.href,
          locations: {
            progression: local,
            totalProgression: spine.length <= 1 ? local : (spineIndex + local) / spine.length,
          },
        });
      }
    };

    if (Math.abs(distance) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const startedAt = performance.now();
    const duration = 165;
    const animate = (now: number) => {
      if (pageRef.current !== bounded) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      scrolling.scrollLeft = startLeft + distance * eased;
      if (progress < 1) pageAnimationRef.current = window.requestAnimationFrame(animate);
      else finish();
    };
    pageAnimationRef.current = window.requestAnimationFrame(animate);
  }, [canonicalLocator, loadSpineIndex, opened.publication.bookId, prepared.units, queueLocatorSave, resource.href, spine.length, spineIndex]);

  const repaginate = useCallback((locator?: ReadingLocator) => {
    const frame = iframeRef.current;
    const document = frame?.contentDocument;
    const scrolling = frame ? scrollingElement(frame) : undefined;
    const content = document?.getElementById("book-content");
    if (!frame || !document || !scrolling || !content) return;
    document.documentElement.style.setProperty("--font-size", `${fontSize}px`);
    document.documentElement.style.setProperty("--line-height", String(settings.lineHeight));
    document.documentElement.style.setProperty("--page-margin", `${settings.pageMargin}vw`);
    document.documentElement.style.setProperty("--paper", settings.theme === "night" ? "#1b1c1a" : "#f1f1ec");
    document.documentElement.style.setProperty("--ink", settings.theme === "night" ? "#d2d0c8" : "#1c1d1b");
    document.documentElement.style.setProperty("--muted-ink", settings.theme === "night" ? "#aaa89f" : "#545550");
    document.documentElement.style.setProperty("--rule", settings.theme === "night" ? "rgba(210, 208, 200, 0.25)" : "rgba(28, 29, 27, 0.28)");
    document.documentElement.style.setProperty("--image-filter", settings.theme === "night" ? "grayscale(1) saturate(0) contrast(0.9) brightness(0.8)" : "grayscale(1) saturate(0) contrast(0.94) brightness(1.035)");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const pitch = paginationPitch(frame, content);
      const count = Math.max(1, Math.ceil(Math.max(scrolling.scrollWidth, content.scrollWidth) / pitch));
      pageCountRef.current = count;
      setPageCount(count);
      const target = locator ?? pendingRestoreRef.current ?? viewLocatorRef.current ?? opened.restoredLocator;
      pendingRestoreRef.current = undefined;
      const restoreIndex = restoreUnitIndex(prepared.units, target);
      const restoreUnit = prepared.units[restoreIndex];
      const element = restoreUnit ? document.querySelector(restoreUnit.locator.locations.cssSelector ?? "") : undefined;
      const absoluteLeft = element ? element.getBoundingClientRect().left + scrolling.scrollLeft : 0;
      let restoredPage = Math.max(0, Math.min(count - 1, Math.floor((absoluteLeft + 1) / pitch)));
      scrolling.scrollLeft = restoredPage * pitch;
      const searchResult = pendingSearchResultRef.current;
      if (searchResult && hrefBase(searchResult.href) === hrefBase(resource.href)) {
        const mark = showSearchHighlights(document, searchResult);
        if (mark) {
          pendingSearchResultRef.current = undefined;
          const matchLeft = mark.getBoundingClientRect().left + scrolling.scrollLeft;
          restoredPage = Math.max(0, Math.min(count - 1, Math.floor((matchLeft + 1) / pitch)));
          scrolling.scrollLeft = restoredPage * pitch;
        }
      }
      pageRef.current = restoredPage;
      setPage(restoredPage);
      const local = count <= 1 ? (target?.locations.progression ?? 0) : restoredPage / (count - 1);
      setTotalProgress(spine.length <= 1 ? local : (spineIndex + local) / spine.length);
    }));
  }, [fontSize, opened.restoredLocator, prepared.units, resource.href, settings.lineHeight, settings.pageMargin, settings.theme, showSearchHighlights, spine.length, spineIndex]);

  const jumpToSearchResult = useCallback(async (result: BookSearchResult) => {
    if (navigatingRef.current) return;
    const local = result.locator.locations.progression ?? 0;
    const locator: ReadingLocator = {
      ...result.locator,
      locations: {
        ...result.locator.locations,
        totalProgression: spine.length <= 1 ? local : (result.spineIndex + local) / spine.length,
      },
    };
    pendingSearchResultRef.current = result;
    pendingRestoreRef.current = locator;
    viewLocatorRef.current = locator;
    setSearchOpen(false);
    queueLocatorSave(locator);

    if (hrefBase(result.href) === hrefBase(resource.href)) {
      repaginate(locator);
      return;
    }

    navigatingRef.current = true;
    try {
      const next = await window.ereader.loadPublicationResource(opened.publication.bookId, result.href);
      setResource(next);
      setTocOpen(false);
    } catch {
      pendingSearchResultRef.current = undefined;
      setTransientMessage("无法打开搜索结果所在章节。");
    } finally {
      navigatingRef.current = false;
    }
  }, [opened.publication.bookId, queueLocatorSave, repaginate, resource.href, setTransientMessage, spine.length]);

  const changeSettings = useCallback((next: ReaderSettings) => {
    void onSettingsChange(next).catch(() => setTransientMessage("设置暂时无法保存。"));
  }, [onSettingsChange, setTransientMessage]);

  keyHandlerRef.current = (event: KeyboardEvent) => {
    if (event.ctrlKey && event.key.toLowerCase() === "c") return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setTocOpen(false);
      setSearchOpen(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (searchOpen) setSearchOpen(false);
      else if (tocOpen) setTocOpen(false);
      else void onExit();
      return;
    }
    if (searchOpen) return;
    if (event.key.toLowerCase() === "t" && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      setTocOpen((value) => !value);
      return;
    }
    if (tocOpen) return;
    if (event.key === "ArrowLeft") applyPage(pageRef.current - 1);
    else if (event.key === "ArrowRight") applyPage(pageRef.current + 1);
    else if (event.key === "+" || event.key === "=") {
      const next = Math.min(36, fontSize + 1);
      setFontSize(next);
      changeSettings({ ...settings, fontSize: next });
    } else if (event.key === "-") {
      const next = Math.max(14, fontSize - 1);
      setFontSize(next);
      changeSettings({ ...settings, fontSize: next });
    }
  };

  const forwardKeyDown = useCallback((event: KeyboardEvent) => keyHandlerRef.current(event), []);
  const forwardFrameClick = useCallback((event: MouseEvent) => frameClickHandlerRef.current(event), []);

  frameClickHandlerRef.current = (event: MouseEvent) => {
    const frame = iframeRef.current;
    const selection = frame?.contentDocument?.getSelection()?.toString().trim();
    if (selection) return;
    const width = frame?.clientWidth ?? 0;
    if (event.clientX < width * 0.23) {
      event.preventDefault();
      applyPage(pageRef.current - 1);
      return;
    }
    if (event.clientX > width * 0.77) {
      event.preventDefault();
      applyPage(pageRef.current + 1);
      return;
    }
    const target = event.target as HTMLElement;
    const unitElement = target.closest<HTMLElement>("[data-reading-unit-id]");
    if (unitElement?.dataset.readingUnitId) {
      const unit = prepared.units.find((candidate) => candidate.id === unitElement.dataset.readingUnitId);
      if (unit) {
        const local = pageCountRef.current <= 1 ? 0 : pageRef.current / (pageCountRef.current - 1);
        queueLocatorSave(canonicalLocator(unit, local));
      }
      return;
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", forwardKeyDown);
    return () => window.removeEventListener("keydown", forwardKeyDown);
  }, [forwardKeyDown]);

  useEffect(() => {
    const resized = () => {
      window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = window.setTimeout(() => repaginate(viewLocatorRef.current), 100);
    };
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, [repaginate]);

  useEffect(() => {
    setFontSize(settings.fontSize);
    if (iframeRef.current?.contentDocument?.readyState === "complete") repaginate(viewLocatorRef.current);
  }, [repaginate, settings.fontSize]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
    window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      setSearchResults(searchBook(searchIndexRef.current, searchQuery));
    }, 120);
    return () => window.clearTimeout(searchTimerRef.current);
  }, [searchQuery]);

  useEffect(() => {
    if (!searchOpen) return;
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
    void buildSearchIndex().catch(() => setTransientMessage("全文搜索暂时无法完成。"));
  }, [buildSearchIndex, searchOpen, setTransientMessage]);

  useEffect(() => () => {
    window.clearTimeout(saveTimerRef.current);
    window.clearTimeout(resizeTimerRef.current);
    window.clearTimeout(transientTimerRef.current);
    window.clearTimeout(searchTimerRef.current);
    window.clearTimeout(highlightTimerRef.current);
    window.cancelAnimationFrame(pageAnimationRef.current ?? 0);
    if (viewLocatorRef.current) void window.ereader.saveLocator(viewLocatorRef.current).catch(() => undefined);
    const document = iframeRef.current?.contentDocument;
    document?.removeEventListener("click", forwardFrameClick);
    document?.removeEventListener("keydown", forwardKeyDown);
  }, [forwardFrameClick, forwardKeyDown]);

  return (
    <main className={`reader-shell theme-${settings.theme}`} data-testid="reader-ready">
      <iframe
        ref={iframeRef}
        className="book-frame"
        title={opened.publication.title}
        sandbox="allow-same-origin"
        srcDoc={prepared.html}
        onLoad={() => {
          const document = iframeRef.current?.contentDocument;
          document?.addEventListener("click", forwardFrameClick);
          document?.addEventListener("keydown", forwardKeyDown);
          repaginate(pendingRestoreRef.current);
        }}
      />
      {settings.showProgress && <div className="reading-progress" aria-label="阅读进度">{Math.round(Math.max(0, Math.min(1, totalProgress)) * 100)}%</div>}
      {message && <div className="reader-message">{message}</div>}
      {searchOpen && (
        <div className="toc-backdrop search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
          <section className="toc-panel search-panel" aria-label="搜索全书" data-testid="book-search-panel">
            <header><h2>搜索全书</h2><button type="button" aria-label="关闭搜索" onClick={() => setSearchOpen(false)}>×</button></header>
            <div className="book-search-field">
              <input
                ref={searchInputRef}
                aria-label="搜索当前整本书"
                placeholder="输入一句话或几个关键词"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
              />
              <p className="book-search-status" role="status" data-testid="book-search-status">
                {searchProgress.working
                  ? `正在搜索全书：${searchProgress.indexed}/${searchProgress.total} 个章节${searchResults.length ? `，已找到 ${searchResults.length} 处` : ""}`
                  : searchQuery.trim()
                    ? `找到 ${searchResults.length} 处匹配${searchProgress.failed ? `；${searchProgress.failed} 个章节无法读取` : ""}`
                    : `输入内容以搜索当前整本书${searchProgress.total ? `，共 ${searchProgress.total} 个章节` : ""}`}
              </p>
            </div>
            {searchResults.length > 0 && (
              <ol className="book-search-results" aria-label="全文搜索结果">
                {searchResults.map((result) => (
                  <li key={result.id}>
                    <button type="button" data-testid="book-search-result" onClick={() => { void jumpToSearchResult(result); }}>
                      <span className="book-search-chapter">{result.chapterTitle}</span>
                      <span className="book-search-excerpt">{result.before && <span>{result.before} </span>}<strong>{result.match}</strong>{result.after && <span> {result.after}</span>}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
      {tocOpen && (
        <div className="toc-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTocOpen(false); }}>
          <nav className="toc-panel" aria-label="目录" data-testid="toc-panel">
            <header><h2>目录</h2><button type="button" aria-label="关闭目录" onClick={() => setTocOpen(false)}>×</button></header>
            <TocTree links={opened.publication.toc} currentHref={resource.href} onSelect={(href) => {
              const target = spine.findIndex((link) => hrefBase(link.href) === hrefBase(href));
              if (target >= 0) void loadSpineIndex(target, "start");
            }} />
          </nav>
        </div>
      )}
      <span className="sr-only">第 {page + 1} 页，共 {pageCount} 页</span>
    </main>
  );
}
