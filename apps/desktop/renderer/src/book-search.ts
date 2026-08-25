import type { PublicationLinkDto, ReadingLocator, ReadingUnit } from "../../../../packages/shared/src/types";

export interface SearchHighlight {
  unitId: string;
  start: number;
  end: number;
}

export interface BookSearchResult {
  id: string;
  chapterTitle: string;
  href: string;
  spineIndex: number;
  locator: ReadingLocator;
  before: string;
  match: string;
  after: string;
  highlights: SearchHighlight[];
}

interface IndexedReadingUnit {
  unit: ReadingUnit;
  normalized: string;
}

export interface IndexedSearchChapter {
  href: string;
  title: string;
  spineIndex: number;
  units: IndexedReadingUnit[];
}

interface NormalizedSource {
  value: string;
  starts: number[];
  ends: number[];
}

const IGNORED_CHARACTER = /^[\s\p{P}\p{Z}\p{Cf}]+$/u;

function normalizedSource(text: string, includeOffsets = false): NormalizedSource {
  let value = "";
  const starts: number[] = [];
  const ends: number[] = [];

  for (let offset = 0; offset < text.length;) {
    const codePoint = text.codePointAt(offset);
    if (codePoint === undefined) break;
    const source = String.fromCodePoint(codePoint);
    const next = offset + source.length;
    const expanded = source.normalize("NFKC").toLocaleLowerCase();
    for (const character of expanded) {
      if (IGNORED_CHARACTER.test(character)) continue;
      value += character;
      if (includeOffsets) {
        for (let index = 0; index < character.length; index += 1) {
          starts.push(offset);
          ends.push(next);
        }
      }
    }
    offset = next;
  }

  return { value, starts, ends };
}

export function normalizeSearchText(text: string): string {
  return normalizedSource(text).value;
}

function hrefBase(href: string): string {
  return href.split("#", 1)[0]?.split("?", 1)[0] ?? href;
}

export function searchChapterTitle(
  href: string,
  index: number,
  toc: PublicationLinkDto[],
  units: ReadingUnit[],
  fallback?: string,
): string {
  for (const link of toc) {
    if (hrefBase(link.href) === hrefBase(href) && link.title?.trim()) return link.title.trim();
    if (link.children?.length) {
      const nested = searchChapterTitle(href, index, link.children, [], "");
      if (nested) return nested;
    }
  }

  return units.find((unit) => unit.type === "heading")?.text.trim()
    || fallback?.trim()
    || (fallback === "" ? "" : `第 ${index + 1} 章`);
}

export function indexSearchChapter(
  href: string,
  title: string,
  spineIndex: number,
  units: ReadingUnit[],
): IndexedSearchChapter {
  return {
    href,
    title,
    spineIndex,
    units: units.map((unit) => ({ unit, normalized: normalizeSearchText(unit.text) })),
  };
}

function clipBefore(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 58 ? `…${compact.slice(-57)}` : compact;
}

function clipAfter(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 58 ? `${compact.slice(0, 57)}…` : compact;
}

function sourceHighlight(unit: ReadingUnit, normalizedStart: number, normalizedEnd: number): SearchHighlight | undefined {
  const source = normalizedSource(unit.text, true);
  const start = source.starts[normalizedStart];
  const end = source.ends[normalizedEnd - 1];
  return start === undefined || end === undefined ? undefined : { unitId: unit.id, start, end };
}

function resultForHighlights(
  chapter: IndexedSearchChapter,
  unitIndex: number,
  highlights: SearchHighlight[],
): BookSearchResult | undefined {
  const first = chapter.units[unitIndex]?.unit;
  const leading = highlights[0];
  if (!first || !leading) return undefined;
  const previous = chapter.units[unitIndex - 1]?.unit.text ?? "";
  const final = highlights[highlights.length - 1];
  const last = final?.unitId === first.id ? first : chapter.units[unitIndex + 1]?.unit;
  if (!final || !last) return undefined;
  const following = chapter.units[unitIndex + (last === first ? 1 : 2)]?.unit.text ?? "";
  const text = first === last
    ? first.text.slice(leading.start, final.end)
    : `${first.text.slice(leading.start)} ${last.text.slice(0, final.end)}`;

  return {
    id: `${chapter.href}:${first.id}:${leading.start}:${final.end}`,
    chapterTitle: chapter.title,
    href: chapter.href,
    spineIndex: chapter.spineIndex,
    locator: first.locator,
    before: clipBefore(`${previous} ${first.text.slice(0, leading.start)}`),
    match: text.replace(/\s+/g, " ").trim(),
    after: clipAfter(`${last.text.slice(final.end)} ${following}`),
    highlights,
  };
}

function phraseMatches(chapter: IndexedSearchChapter, unitIndex: number, query: string): BookSearchResult[] {
  const entry = chapter.units[unitIndex];
  if (!entry || !query) return [];
  const matches: BookSearchResult[] = [];

  for (let start = entry.normalized.indexOf(query); start >= 0; start = entry.normalized.indexOf(query, start + 1)) {
    const highlight = sourceHighlight(entry.unit, start, start + query.length);
    const result = highlight ? resultForHighlights(chapter, unitIndex, [highlight]) : undefined;
    if (result) matches.push(result);
  }

  const next = chapter.units[unitIndex + 1];
  if (next) {
    const combined = entry.normalized + next.normalized;
    const minimum = Math.max(0, entry.normalized.length - query.length + 1);
    for (let start = combined.indexOf(query, minimum); start >= 0 && start < entry.normalized.length; start = combined.indexOf(query, start + 1)) {
      const end = start + query.length;
      if (end <= entry.normalized.length) continue;
      const first = sourceHighlight(entry.unit, start, entry.normalized.length);
      const second = sourceHighlight(next.unit, 0, end - entry.normalized.length);
      const result = first && second ? resultForHighlights(chapter, unitIndex, [first, second]) : undefined;
      if (result) matches.push(result);
    }
  }

  return matches;
}

function keywordMatch(chapter: IndexedSearchChapter, unitIndex: number, keywords: string[]): BookSearchResult | undefined {
  const entry = chapter.units[unitIndex];
  if (!entry || keywords.length < 2 || !keywords.every((keyword) => entry.normalized.includes(keyword))) return undefined;
  const highlights = keywords.map((keyword) => {
    const start = entry.normalized.indexOf(keyword);
    return sourceHighlight(entry.unit, start, start + keyword.length);
  }).filter((highlight): highlight is SearchHighlight => Boolean(highlight)).sort((left, right) => left.start - right.start);
  return resultForHighlights(chapter, unitIndex, highlights);
}

export function searchBook(chapters: IndexedSearchChapter[], query: string): BookSearchResult[] {
  const phrase = normalizeSearchText(query);
  if (!phrase) return [];
  const keywords = Array.from(new Set(query.trim().split(/\s+/u).map(normalizeSearchText).filter(Boolean)));
  const results: BookSearchResult[] = [];

  for (const chapter of chapters) {
    for (let index = 0; index < chapter.units.length; index += 1) {
      const exact = phraseMatches(chapter, index, phrase);
      if (exact.length > 0) {
        results.push(...exact);
        continue;
      }
      const keywordsFound = keywordMatch(chapter, index, keywords);
      if (keywordsFound) results.push(keywordsFound);
    }
  }

  return results;
}
