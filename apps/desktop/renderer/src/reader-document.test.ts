// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { prepareReaderDocument } from "./reader-document";

describe("publication markup isolation", () => {
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
});
