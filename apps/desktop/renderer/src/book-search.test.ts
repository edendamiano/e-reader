import { describe, expect, it } from "vitest";
import { buildReadingUnits } from "../../../../packages/reader-core/src/reading-units";
import { indexSearchChapter, normalizeSearchText, searchBook, searchChapterTitle } from "./book-search";

const bookId = "a".repeat(64);

function chapter(href: string, title: string, texts: string[], spineIndex = 0) {
  const units = buildReadingUnits(bookId, href, texts.map((text, index) => ({
    text,
    selector: `p:nth-of-type(${index + 1})`,
    type: "paragraph" as const,
  })), "zh-CN");
  return indexSearchChapter(href, title, spineIndex, units);
}

describe("whole-book text search", () => {
  it("normalizes case, full-width forms, whitespace, and Chinese/English punctuation", () => {
    expect(normalizeSearchText("Ｔｅｓｔ，\n 世界！ 2026")).toBe("test世界2026");
    expect(normalizeSearchText("‘Hello’ — world…")).toBe("helloworld");
  });

  it("finds a copied sentence despite different punctuation and line breaks", () => {
    const source = chapter("one.xhtml", "第一章", ["我们使用 Transformer architecture，处理中文。"]);
    const matches = searchBook([source], "我们使用\n transformer architecture, 处理中文!");

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ chapterTitle: "第一章", href: "one.xhtml", match: "我们使用 Transformer architecture，处理中文" });
    expect(matches[0]?.highlights[0]).toMatchObject({ start: 0 });
  });

  it("returns all repeated occurrences across multiple chapters", () => {
    const first = chapter("one.xhtml", "第一章", ["苹果出现在这里，苹果再次出现。"]);
    const second = chapter("two.xhtml", "第二章", ["第二章也有苹果。"], 1);

    expect(searchBook([first, second], "苹果").map((match) => match.chapterTitle)).toEqual(["第一章", "第一章", "第二章"]);
  });

  it("matches several non-adjacent keywords within a sentence", () => {
    const source = chapter("one.xhtml", "第一章", ["Transformer architecture 能够处理复杂的中文排版。"]);
    const matches = searchBook([source], "transformer 中文");

    expect(matches).toHaveLength(1);
    expect(matches[0]?.highlights).toHaveLength(2);
  });

  it("matches text copied across adjacent reading units", () => {
    const source = chapter("one.xhtml", "第一章", ["前半句就在这里。", "后半句紧接着出现。"]);
    const matches = searchBook([source], "就在这里, 后半句紧接着");

    expect(matches).toHaveLength(1);
    expect(matches[0]?.highlights).toHaveLength(2);
    expect(matches[0]?.locator.locations.cssSelector).toContain("reading-0");
  });

  it("keeps nearby context and stable reading-unit locators", () => {
    const source = chapter("one.xhtml", "第一章", ["前文背景。", "需要找到的关键句子就在这里。", "后文背景。"]);
    const match = searchBook([source], "关键句子")[0];

    expect(match?.before).toContain("前文背景");
    expect(match?.after).toContain("后文背景");
    expect(match?.locator.href).toBe("one.xhtml");
  });

  it("uses nested table-of-contents titles and strips href fragments", () => {
    const title = searchChapterTitle("two.xhtml", 1, [{ href: "one.xhtml", title: "卷一", children: [{ href: "two.xhtml#start", title: "第二章" }] }], []);

    expect(title).toBe("第二章");
  });
});
