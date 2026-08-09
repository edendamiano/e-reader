import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUnitLocator, restoreUnitIndex } from "../../../../packages/locator/src/locator";
import type { OpenPublicationResult, PublicationLinkDto, ReaderSettings, ReadingLocator, SpeechUnit } from "../../../../packages/shared/src/types";
import { prepareReaderDocument } from "./reader-document";

interface ReaderSurfaceProps {
  opened: OpenPublicationResult;
  settings: ReaderSettings;
  onExit(): Promise<void>;
  onSettingsChange(settings: ReaderSettings): Promise<void>;
}

function scrollingElement(frame: HTMLIFrameElement): HTMLElement | undefined {
  return frame.contentDocument?.scrollingElement as HTMLElement | undefined;
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
  const audioRef = useRef<HTMLAudioElement>();
  const audioUnitIdRef = useRef<string>();
  const playRequestRef = useRef(0);
  const saveTimerRef = useRef<number>();
  const resizeTimerRef = useRef<number>();
  const transientTimerRef = useRef<number>();
  const pageRef = useRef(0);
  const pageCountRef = useRef(1);
  const viewLocatorRef = useRef<ReadingLocator | undefined>(opened.restoredLocator);
  const pendingRestoreRef = useRef<ReadingLocator | undefined>(opened.restoredLocator);
  const navigatingRef = useRef(false);
  const autoPlayAfterLoadRef = useRef(false);
  const frameClickHandlerRef = useRef<(event: MouseEvent) => void>(() => undefined);
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  const [resource, setResource] = useState({ href: opened.href, rawHtml: opened.rawHtml });
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [totalProgress, setTotalProgress] = useState(opened.restoredLocator?.locations.totalProgression ?? 0);
  const [activeUnitId, setActiveUnitId] = useState<string>();
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

  const setHighlight = useCallback((unitId: string | undefined) => {
    const document = iframeRef.current?.contentDocument;
    document?.querySelectorAll(".speech-unit.is-active").forEach((element) => element.classList.remove("is-active"));
    if (unitId) document?.querySelector(`[data-speech-unit-id="${unitId}"]`)?.classList.add("is-active");
    setActiveUnitId(unitId);
  }, []);

  const cancelPlayback = useCallback(() => {
    playRequestRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.pause();
    }
    audioRef.current = undefined;
    audioUnitIdRef.current = undefined;
  }, []);

  const loadSpineIndex = useCallback(async (targetIndex: number, edge: "start" | "end", autoPlay = false) => {
    if (navigatingRef.current || targetIndex < 0 || targetIndex >= spine.length) return;
    navigatingRef.current = true;
    cancelPlayback();
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
        autoPlayAfterLoadRef.current = autoPlay;
        setActiveUnitId(undefined);
        setResource(next);
        setTocOpen(false);
        return;
      }
    } catch {
      setTransientMessage("无法打开下一章节。");
    } finally {
      navigatingRef.current = false;
    }
  }, [cancelPlayback, locale, opened.publication.bookId, setTransientMessage, spine, spineIndex]);

  const canonicalLocator = useCallback((unit: SpeechUnit, localProgression: number): ReadingLocator => {
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
      void loadSpineIndex(spineIndex - 1, "end");
      return;
    }
    if (nextPage >= pageCountRef.current) {
      void loadSpineIndex(spineIndex + 1, "start");
      return;
    }
    const width = Math.max(1, frame.clientWidth);
    const bounded = Math.max(0, Math.min(pageCountRef.current - 1, nextPage));
    scrolling.scrollLeft = bounded * width;
    pageRef.current = bounded;
    setPage(bounded);
    const visible = prepared.units.find((unit) => {
      const element = frame.contentDocument?.querySelector(unit.locator.locations.cssSelector ?? "");
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < frame.clientHeight;
    });
    if (visible && persist) {
      const local = pageCountRef.current <= 1 ? 0 : bounded / (pageCountRef.current - 1);
      queueLocatorSave(canonicalLocator(visible, local));
    }
  }, [canonicalLocator, loadSpineIndex, prepared.units, queueLocatorSave, spineIndex]);

  const pageForUnit = useCallback((unit: SpeechUnit): number => {
    const frame = iframeRef.current;
    const scrolling = frame ? scrollingElement(frame) : undefined;
    const element = frame?.contentDocument?.querySelector(unit.locator.locations.cssSelector ?? "");
    if (!frame || !scrolling || !element) return 0;
    const absoluteLeft = element.getBoundingClientRect().left + scrolling.scrollLeft;
    return Math.max(0, Math.min(pageCountRef.current - 1, Math.floor((absoluteLeft + 1) / Math.max(1, frame.clientWidth))));
  }, []);

  const playUnit = useCallback(async (index: number): Promise<void> => {
    const unit = prepared.units[index];
    if (!unit) return;
    cancelPlayback();
    const requestId = playRequestRef.current;
    setHighlight(unit.id);
    const targetPage = pageForUnit(unit);
    if (targetPage !== pageRef.current) applyPage(targetPage, false);
    setMessage("正在准备朗读…");
    try {
      const synthesized = await window.ereader.synthesize(unit.text, settings.speechRate, {
        bookId: unit.bookId,
        href: unit.href,
        order: unit.order,
        languageHint: locale,
        type: unit.type,
      });
      if (playRequestRef.current !== requestId) return;
      const audio = new Audio(synthesized.audioDataUrl);
      audioRef.current = audio;
      audioUnitIdRef.current = unit.id;
      audio.onended = () => {
        if (audioRef.current !== audio) return;
        audioRef.current = undefined;
        audioUnitIdRef.current = undefined;
        const next = index + 1;
        if (prepared.units[next]) void playUnit(next);
        else void loadSpineIndex(spineIndex + 1, "start", true).then(() => setHighlight(undefined));
      };
      setMessage("");
      await audio.play();
    } catch {
      if (playRequestRef.current === requestId) {
        audioRef.current = undefined;
        audioUnitIdRef.current = undefined;
        setMessage("朗读暂时不可用。");
      }
    }
  }, [applyPage, cancelPlayback, loadSpineIndex, locale, pageForUnit, prepared.units, setHighlight, settings.speechRate, spineIndex]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audioUnitIdRef.current === activeUnitId) {
      if (audio.paused) void audio.play();
      else audio.pause();
      return;
    }
    const activeIndex = activeUnitId ? prepared.units.findIndex((unit) => unit.id === activeUnitId) : -1;
    const index = activeIndex >= 0 ? activeIndex : prepared.units.findIndex((unit) => pageForUnit(unit) === pageRef.current);
    void playUnit(Math.max(0, index));
  }, [activeUnitId, pageForUnit, playUnit, prepared.units]);

  const repaginate = useCallback((locator?: ReadingLocator) => {
    const frame = iframeRef.current;
    const document = frame?.contentDocument;
    const scrolling = frame ? scrollingElement(frame) : undefined;
    const content = document?.getElementById("book-content");
    if (!frame || !document || !scrolling || !content) return;
    document.documentElement.style.setProperty("--font-size", `${fontSize}px`);
    document.documentElement.style.setProperty("--line-height", String(settings.lineHeight));
    document.documentElement.style.setProperty("--page-margin", `${settings.pageMargin}vw`);
    document.documentElement.style.setProperty("--paper", settings.theme === "night" ? "#171816" : "#f4f0e7");
    document.documentElement.style.setProperty("--ink", settings.theme === "night" ? "#d8d3c8" : "#292824");
    document.body.style.fontFamily = settings.fontFamily === "sans"
      ? 'system-ui, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif'
      : 'Georgia, "Noto Serif CJK SC", "Source Han Serif SC", SimSun, serif';
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
  }, [fontSize, opened.restoredLocator, prepared.units, settings.fontFamily, settings.lineHeight, settings.pageMargin, settings.theme, spine.length, spineIndex]);

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
    else if (event.key === "ArrowUp") {
      const speechRate = Math.min(2, Number((settings.speechRate + 0.05).toFixed(2)));
      changeSettings({ ...settings, speechRate });
      setTransientMessage(`${speechRate.toFixed(2)}×`);
    } else if (event.key === "ArrowDown") {
      const speechRate = Math.max(0.5, Number((settings.speechRate - 0.05).toFixed(2)));
      changeSettings({ ...settings, speechRate });
      setTransientMessage(`${speechRate.toFixed(2)}×`);
    } else if (event.key === " ") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "+" || event.key === "=") {
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
    const target = event.target as HTMLElement;
    const unitElement = target.closest<HTMLElement>("[data-speech-unit-id]");
    if (unitElement?.dataset.speechUnitId) {
      if (audioUnitIdRef.current !== unitElement.dataset.speechUnitId) cancelPlayback();
      setHighlight(unitElement.dataset.speechUnitId);
      const unit = prepared.units.find((candidate) => candidate.id === unitElement.dataset.speechUnitId);
      if (unit) {
        const local = pageCountRef.current <= 1 ? 0 : pageRef.current / (pageCountRef.current - 1);
        queueLocatorSave(canonicalLocator(unit, local));
      }
      return;
    }
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
    if (viewLocatorRef.current) void window.ereader.saveLocator(viewLocatorRef.current).catch(() => undefined);
    cancelPlayback();
    const document = iframeRef.current?.contentDocument;
    document?.removeEventListener("click", forwardFrameClick);
    document?.removeEventListener("keydown", forwardKeyDown);
  }, [cancelPlayback, forwardFrameClick, forwardKeyDown]);

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
          if (autoPlayAfterLoadRef.current) {
            autoPlayAfterLoadRef.current = false;
            window.setTimeout(() => void playUnit(0), 80);
          }
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
