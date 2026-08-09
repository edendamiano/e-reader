import { describe, expect, it } from "vitest";
import { buildSpeechUnits, segmentSentences } from "./speech-units";

describe("speech unit segmentation", () => {
  it("keeps a mixed-language semantic sentence together", () => {
    const result = segmentSentences("我们使用 Transformer architecture 解决这个问题。下一句。", "zh-CN");
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("我们使用 Transformer architecture 解决这个问题。");
    expect(result[1]).toBe("下一句。");
  });

  it("creates stable ordered locators", () => {
    const units = buildSpeechUnits("book", "chapter.xhtml", [
      { text: "One. Two.", selector: "p:nth-of-type(1)", type: "paragraph" },
    ], "en");
    expect(units.map((unit) => unit.order)).toEqual([0, 1]);
    expect(units[1]?.locator.locations.cssSelector).toContain("speech-1");
  });
});
