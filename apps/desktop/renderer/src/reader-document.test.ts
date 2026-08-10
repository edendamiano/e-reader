// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { prepareReaderDocument } from "./reader-document";

describe("publication markup isolation", () => {
  it("uses symmetric viewport-relative page geometry without CSS multiplication", () => {
    const prepared = prepareReaderDocument("<html><body><p>Balanced page margins.</p></body></html>", "a".repeat(64), "chapter.xhtml", "en");

    expect(prepared.html).toContain("width: calc(100vw - var(--page-margin) - var(--page-margin))");
    expect(prepared.html).toContain("column-gap: calc(var(--page-margin) + var(--page-margin))");
    expect(prepared.html).not.toContain("2 * var(--page-margin)");
  });

  it("removes script, handlers, remote resources, dangerous links, and active embedded formats", () => {
    const prepared = prepareReaderDocument(`<!doctype html><html><body>
      <h1 onclick="window.top.pwned=true">Safe heading</h1>
      <p>中文 English mixed sentence.</p>
      <script>window.top.pwned=true</script>
      <img src="https://example.invalid/tracker.png" onerror="window.top.pwned=true" />
      <a href="file:///C:/Windows/win.ini">local</a>
      <iframe src="https://example.invalid"></iframe>
      <svg onload="window.top.pwned=true"></svg>
    </body></html>`, "a".repeat(64), "chapter.xhtml", "zh-CN");
    expect(prepared.html).toContain("script-src 'none'");
    expect(prepared.html).not.toMatch(/<script|<iframe|<svg|onclick=|onerror=|https:\/\/|file:\/\//i);
    expect(prepared.units.map((unit) => unit.text).join(" ")).toContain("中文 English mixed sentence");
  });

  it("keeps only locally materialized raster image data", () => {
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const prepared = prepareReaderDocument(`<html><body><p>Image page text.</p><img src="${tinyPng}"/><img src="data:image/svg+xml;base64,PHN2Zy8+"/></body></html>`, "b".repeat(64), "image.xhtml", "en");
    expect(prepared.html).toContain(tinyPng);
    expect(prepared.html).not.toContain("image/svg+xml");
  });

  it("enforces the offline E-Ink palette, reader fonts, and image treatment", () => {
    const prepared = prepareReaderDocument('<html><body style="background:#ff0;color:red"><h1>章节 Chapter</h1><p>中文 Lora 2026。</p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"/></body></html>', "c".repeat(64), "theme.xhtml", "zh-CN");
    expect(prepared.html).toContain('font-family: "EReader Lora"');
    expect(prepared.html).toContain('font-family: "EReader Noto Serif SC"');
    expect(prepared.html).toContain("--paper: #f1f1ec");
    expect(prepared.html).toContain("--ink: #1c1d1b");
    expect(prepared.html).toContain("grayscale(1) saturate(0)");
    expect(prepared.html).toContain("background-color: transparent !important");
    expect(prepared.html).not.toContain("#ff0");
    expect(prepared.html).not.toContain("color:red");
    expect(prepared.html).not.toContain("filter: blur");
    expect(prepared.html).not.toContain("#ffffff");
    expect(prepared.html).not.toContain("#000000");
  });
});
