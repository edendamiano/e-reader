import { describe, expect, it } from "vitest";
import { createUnitLocator, restoreUnitIndex } from "./locator";
import type { SpeechUnit } from "../../shared/src/types";

function units(): SpeechUnit[] {
  return ["第一句。", "The second sentence.", "最后一句。"].map((text, order) => ({
    id: `speech-${order}`,
    bookId: "fixture",
    href: "OEBPS/chapter.xhtml",
    locator: createUnitLocator("fixture", "OEBPS/chapter.xhtml", `speech-${order}`, text, order / 2),
    text,
    type: "paragraph",
    order,
  }));
}

describe("stable locator fallback", () => {
  it("restores the exact speech unit after repagination", () => {
    const source = units();
    expect(restoreUnitIndex(source, source[1]?.locator)).toBe(1);
  });

  it("falls back to text quote when the selector is stale", () => {
    const locator = createUnitLocator("fixture", "OEBPS/chapter.xhtml", "old-id", "最后一句。", 0);
    expect(restoreUnitIndex(units(), locator)).toBe(2);
  });

  it("falls back to progression instead of failing", () => {
    const locator = createUnitLocator("fixture", "OEBPS/chapter.xhtml", "missing", "missing", 0.55);
    expect(restoreUnitIndex(units(), locator)).toBe(1);
  });
});
