import type { ReadingLocator, ReadingUnit } from "../../shared/src/types";

export function clampProgression(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value as number));
}
export function createUnitLocator(
  bookId: string,
  href: string,
  unitId: string,
  text: string,
  progression: number,
  totalProgression?: number,
  context?: { before?: string; after?: string },
): ReadingLocator {
  const clean = text.replace(/\s+/g, " ").trim();
  return {
    bookId,
    href,
    locations: {
      cssSelector: `[data-reading-unit-id="${unitId}"]`,
      progression: clampProgression(progression),
      totalProgression: totalProgression === undefined ? undefined : clampProgression(totalProgression),
    },
    text: {
      before: context?.before?.replace(/\s+/g, " ").trim().slice(-160) || undefined,
      highlight: clean.slice(0, 240),
      after: context?.after?.replace(/\s+/g, " ").trim().slice(0, 160) || undefined,
    },
  };
}

export function restoreUnitIndex(units: ReadingUnit[], locator: ReadingLocator | undefined): number {
  if (!locator || units.length === 0) {
    return 0;
  }

  const sameResource = !units[0] || units[0].href.split("#", 1)[0] === locator.href.split("#", 1)[0];
  const selector = locator.locations.cssSelector;
  if (selector && sameResource) {
    const idMatch = selector.match(/data-reading-unit-id=["']([^"']+)["']/);
    const index = idMatch ? units.findIndex((unit) => unit.id === idMatch[1]) : -1;
    if (index >= 0) {
      return index;
    }
  }

  const quote = locator.text?.highlight?.replace(/\s+/g, " ").trim();
  if (quote && sameResource) {
    const exactIndex = units.findIndex((unit) => unit.text.replace(/\s+/g, " ").trim() === quote);
    if (exactIndex >= 0) {
      return exactIndex;
    }
    const contextIndex = units.findIndex((unit) => unit.text.includes(quote) || quote.includes(unit.text));
    if (contextIndex >= 0) {
      return contextIndex;
    }
  }

  const progression = clampProgression(locator.locations.progression);
  return Math.min(units.length - 1, Math.round(progression * (units.length - 1)));
}
