import { createUnitLocator } from "../../locator/src/locator";
import type { ReadingUnit, ReadingUnitType } from "../../shared/src/types";

export interface TextBlock {
  text: string;
  selector: string;
  type: ReadingUnitType;
}
const FALLBACK_SENTENCE_PATTERN = /[^。！？!?….]+(?:[…。！？!?]+|$)/gu;

export function segmentSentences(text: string, locale = "und"): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) {
    return [];
  }

  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
    const segments = Array.from(segmenter.segment(clean), (entry) => entry.segment.trim()).filter(Boolean);
    if (segments.length > 0) {
      return segments;
    }
  }

  return clean.match(FALLBACK_SENTENCE_PATTERN)?.map((part) => part.trim()).filter(Boolean) ?? [clean];
}

export function buildReadingUnits(
  bookId: string,
  href: string,
  blocks: TextBlock[],
  locale = "und",
): ReadingUnit[] {
  const pending: Array<Omit<ReadingUnit, "locator"> & { selector: string }> = [];
  for (const block of blocks) {
    const sentences = segmentSentences(block.text, locale);
    for (const sentence of sentences) {
      const order = pending.length;
      pending.push({
        id: `reading-${order}`,
        bookId,
        href,
        text: sentence,
        type: block.type,
        order,
        selector: block.selector,
      });
    }
  }

  return pending.map(({ selector: _selector, ...unit }, index) => ({
    ...unit,
    locator: createUnitLocator(
      bookId,
      href,
      unit.id,
      unit.text,
      pending.length <= 1 ? 0 : index / (pending.length - 1),
    ),
  }));
}
