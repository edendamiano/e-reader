import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUnitLocator, restoreUnitIndex } from "../../../../packages/locator/src/locator";
import type { OpenPublicationResult, ReadingLocator, SpeechUnit } from "../../../../packages/shared/src/types";
import { prepareReaderDocument } from "./reader-document";

interface ReaderSurfaceProps {
  opened: OpenPublicationResult;
}

function scrollingElement(frame: HTMLIFrameElement): HTMLElement | undefined {
  return frame.contentDocument?.scrollingElement as HTMLElement | undefined;
}

export function ReaderSurface({ opened }: ReaderSurfaceProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const audioRef = useRef<HTMLAudioElement>();
  const audioUnitIdRef = useRef<string>();
  const playRequestRef = useRef(0);
  const saveTimerRef = useRef<number>();
  const pageRef = useRef(0);
  const pageCountRef = useRef(1);
  const viewLocatorRef = useRef<ReadingLocator | undefined>(opened.restoredLocator);
  const frameClickHandlerRef = useRef<(event: MouseEvent) => void>(() => undefined);
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [activeUnitId, setActiveUnitId] = useState<string>();
  const [speed, setSpeed] = useState(1);
  const [fontSize, setFontSize] = useState(21);
  const [message, setMessage] = useState("");
  const locale = opened.publication.languages[0] ?? "und";
  const prepared = useMemo(
    () => prepareReaderDocument(opened.rawHtml, opened.publication.bookId, opened.href, locale),
    [locale, opened.href, opened.publication.bookId, opened.rawHtml],
  );

  const queueLocatorSave = useCallback((locator: ReadingLocator) => {
    viewLocatorRef.current = locator;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void window.ereader.saveLocator(locator), 250);
  }, []);

  const applyPage = useCallback((nextPage: number, persist = true) => {
    const frame = iframeRef.current;
    const scrolling = frame ? scrollingElement(frame) : undefined;
    if (!frame || !scrolling) return;
    const width = Math.max(1, frame.clientWidth);
    const currentPageCount = pageCountRef.current;
    const bounded = Math.max(0, Math.min(currentPageCount - 1, nextPage));
    scrolling.scrollLeft = bounded * width;
    pageRef.current = bounded;
    setPage(bounded);

    const visible = prepared.units.find((unit) => {
      const element = frame.contentDocument?.querySelector(unit.locator.locations.cssSelector ?? "");
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.right > 0 && rect.left < width;
    });
    if (visible && persist) {
      const locator = createUnitLocator(
        opened.publication.bookId,
        opened.href,
        visible.id,
        visible.text,
        currentPageCount <= 1 ? 0 : bounded / (currentPageCount - 1),
        currentPageCount <= 1 ? 0 : bounded / (currentPageCount - 1),
      );
      queueLocatorSave(locator);
    }
  }, [opened.href, opened.publication.bookId, prepared.units, queueLocatorSave]);

  const pageForUnit = useCallback((unit: SpeechUnit): number => {
    const frame = iframeRef.current;
    const scrolling = frame ? scrollingElement(frame) : undefined;
    const element = frame?.contentDocument?.querySelector(unit.locator.locations.cssSelector ?? "");
    if (!frame || !scrolling || !element) return 0;
    const absoluteLeft = element.getBoundingClientRect().left + scrolling.scrollLeft;
    return Math.max(0, Math.min(pageCountRef.current - 1, Math.floor((absoluteLeft + 1) / Math.max(1, frame.clientWidth))));
  }, []);

  const setHighlight = useCallback((unitId: string | undefined) => {
    const document = iframeRef.current?.contentDocument;
    document?.querySelectorAll(".speech-unit.is-active").forEach((element) => element.classList.remove("is-active"));
    if (unitId) {
      document?.querySelector(`[data-speech-unit-id="${unitId}"]`)?.classList.add("is-active");
    }
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
    setMessage("");
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
      const synthesized = await window.ereader.synthesize(unit.text, speed, {
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
        else setHighlight(undefined);
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
  }, [applyPage, cancelPlayback, locale, pageForUnit, prepared.units, setHighlight, speed]);

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
    requestAnimationFrame(() => {
      const width = Math.max(1, frame.clientWidth);
      const count = Math.max(1, Math.ceil(Math.max(scrolling.scrollWidth, content.scrollWidth) / width));
      pageCountRef.current = count;
      setPageCount(count);
      const restoreIndex = restoreUnitIndex(prepared.units, locator ?? viewLocatorRef.current ?? opened.restoredLocator);
      const restoreUnit = prepared.units[restoreIndex];
      const element = restoreUnit ? document.querySelector(restoreUnit.locator.locations.cssSelector ?? "") : undefined;
      const absoluteLeft = element ? element.getBoundingClientRect().left + scrolling.scrollLeft : 0;
      const restoredPage = Math.max(0, Math.min(count - 1, Math.floor((absoluteLeft + 1) / width)));
      scrolling.scrollLeft = restoredPage * width;
      pageRef.current = restoredPage;
      setPage(restoredPage);
    });
  }, [fontSize, opened.restoredLocator, prepared.units]);

  keyHandlerRef.current = (event: KeyboardEvent) => {
    if (event.ctrlKey && event.key.toLowerCase() === "c") return;
    if (event.key === "ArrowLeft") applyPage(pageRef.current - 1);
    else if (event.key === "ArrowRight") applyPage(pageRef.current + 1);
    else if (event.key === "ArrowUp") setSpeed((value) => Math.min(2, Number((value + 0.05).toFixed(2))));
    else if (event.key === "ArrowDown") setSpeed((value) => Math.max(0.5, Number((value - 0.05).toFixed(2))));
    else if (event.key === " ") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "+" || event.key === "=") setFontSize((value) => Math.min(36, value + 1));
    else if (event.key === "-") setFontSize((value) => Math.max(14, value - 1));
  };

  const forwardKeyDown = useCallback((event: KeyboardEvent) => keyHandlerRef.current(event), []);
  const forwardFrameClick = useCallback((event: MouseEvent) => frameClickHandlerRef.current(event), []);

  frameClickHandlerRef.current = (event: MouseEvent) => {
    event.preventDefault();
    const target = event.target as HTMLElement;
    const unitElement = target.closest<HTMLElement>("[data-speech-unit-id]");
    if (unitElement?.dataset.speechUnitId) {
      const unit = prepared.units.find((candidate) => candidate.id === unitElement.dataset.speechUnitId);
      if (audioUnitIdRef.current !== unitElement.dataset.speechUnitId) {
        cancelPlayback();
      }
      setHighlight(unitElement.dataset.speechUnitId);
      if (unit) {
        const currentPageCount = pageCountRef.current;
        const progression = currentPageCount <= 1 ? 0 : pageRef.current / (currentPageCount - 1);
        queueLocatorSave(createUnitLocator(opened.publication.bookId, opened.href, unit.id, unit.text, progression, progression));
      }
    } else if (event.clientX < (iframeRef.current?.clientWidth ?? 0) * 0.32) {
      applyPage(pageRef.current - 1);
    } else if (event.clientX > (iframeRef.current?.clientWidth ?? 0) * 0.68) {
      applyPage(pageRef.current + 1);
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", forwardKeyDown);
    return () => window.removeEventListener("keydown", forwardKeyDown);
  }, [forwardKeyDown]);

  useEffect(() => {
    if (iframeRef.current?.contentDocument?.readyState === "complete") repaginate();
  }, [fontSize, repaginate]);

  useEffect(() => () => {
    window.clearTimeout(saveTimerRef.current);
    playRequestRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.pause();
    }
    audioRef.current = undefined;
    audioUnitIdRef.current = undefined;
    const document = iframeRef.current?.contentDocument;
    document?.removeEventListener("click", forwardFrameClick);
    document?.removeEventListener("keydown", forwardKeyDown);
  }, [forwardFrameClick, forwardKeyDown]);

  return (
    <main className="reader-shell" data-testid="reader-ready">
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
          repaginate(opened.restoredLocator);
        }}
      />
      <div className="reading-progress" aria-label="阅读进度">{Math.round((pageCount <= 1 ? 0 : page / (pageCount - 1)) * 100)}%</div>
      {(message || speed !== 1) && <div className="reader-message">{message || `${speed.toFixed(2)}×`}</div>}
    </main>
  );
}
