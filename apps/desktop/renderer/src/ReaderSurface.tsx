import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUnitLocator, restoreUnitIndex } from "../../../../packages/locator/src/locator";
import type { OpenPublicationResult, PublicationLinkDto, ReaderSettings, ReadingLocator, ReadingUnit } from "../../../../packages/shared/src/types";
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

function hrefBase(href: string): string {
  return href.split("#", 1)[0]?.split("?", 1)[0] ?? href;
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
  const saveTimerRef = useRef<number>();
  const resizeTimerRef = useRef<number>();
  const transientTimerRef = useRef<number>();
  const pageAnimationRef = useRef<number>();
  const pageRef = useRef(0);
  const pageCountRef = useRef(1);
  const viewLocatorRef = useRef<ReadingLocator | undefined>(opened.restoredLocator);
  const pendingRestoreRef = useRef<ReadingLocator | undefined>(opened.restoredLocator);
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
    const width = Math.max(1, frame.clientWidth);
    const bounded = Math.max(0, Math.min(pageCountRef.current - 1, nextPage));
    const targetLeft = bounded * width;
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
        return rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < frame.clientHeight;
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
      const width = Math.max(1, frame.clientWidth);
      const count = Math.max(1, Math.ceil(Math.max(scrolling.scrollWidth, content.scrollWidth) / width));
      pageCountRef.current = count;
      setPageCount(count);
      const target = locator ?? pendingRestoreRef.current ?? viewLocatorRef.current ?? opened.restoredLocator;
      pendingRestoreRef.current = undefined;
      const restoreIndex = restoreUnitIndex(prepared.units, target);
      const restoreUnit = prepared.units[restoreIndex];
      const element = restoreUnit ? document.querySelector(restoreUnit.locator.locations.cssSelector ?? "") : undefined;
      const absoluteLeft = element ? element.getBoundingClientRect().left + scrolling.scrollLeft : 0;
      const restoredPage = Math.max(0, Math.min(count - 1, Math.floor((absoluteLeft + 1) / width)));
      scrolling.scrollLeft = restoredPage * width;
      pageRef.current = restoredPage;
      setPage(restoredPage);
      const local = count <= 1 ? (target?.locations.progression ?? 0) : restoredPage / (count - 1);
      setTotalProgress(spine.length <= 1 ? local : (spineIndex + local) / spine.length);
    }));
  }, [fontSize, opened.restoredLocator, prepared.units, settings.lineHeight, settings.pageMargin, settings.theme, spine.length, spineIndex]);

  const changeSettings = useCallback((next: ReaderSettings) => {
    void onSettingsChange(next).catch(() => setTransientMessage("设置暂时无法保存。"));
  }, [onSettingsChange, setTransientMessage]);

  keyHandlerRef.current = (event: KeyboardEvent) => {
    if (event.ctrlKey && event.key.toLowerCase() === "c") return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (tocOpen) setTocOpen(false);
      else void onExit();
      return;
    }
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

  useEffect(() => () => {
    window.clearTimeout(saveTimerRef.current);
    window.clearTimeout(resizeTimerRef.current);
    window.clearTimeout(transientTimerRef.current);
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
