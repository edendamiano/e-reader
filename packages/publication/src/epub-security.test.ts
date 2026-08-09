import { imageSize } from "image-size";
import { describe, expect, it } from "vitest";
import { assertSafeZipEntryName } from "./epub";

describe("EPUB image parser hardening", () => {
  it("rejects an ICNS zero-length entry before the vulnerable parser can run", () => {
    const malicious = Buffer.alloc(16);
    malicious.write("icns", 0, "ascii");
    malicious.writeUInt32BE(16, 4);
    malicious.write("TOC ", 8, "ascii");
    malicious.writeUInt32BE(0, 12);

    expect(() => imageSize(malicious)).toThrow(/disabled file type: icns/i);
  });

  it.each(["../escape.xhtml", "%2e%2e/escape.xhtml", "%252e%252e/escape.xhtml", "%25252e%25252e/escape.xhtml", "C:/escape.xhtml", "folder\\escape.xhtml"])(
    "rejects unsafe ZIP entry name %s",
    (fileName) => {
      expect(() => assertSafeZipEntryName(fileName)).toThrow(/unsafe archive entry name/i);
    },
  );

  it("accepts a normal EPUB entry name", () => {
    expect(() => assertSafeZipEntryName("OEBPS/Text/chapter-01.xhtml")).not.toThrow();
  });

  it("rejects an LCP license before Readium can enter its legacy request path", () => {
    expect(() => assertSafeZipEntryName("META-INF/license.lcpl")).toThrow("此文件受保护，无法读取。");
  });
});
