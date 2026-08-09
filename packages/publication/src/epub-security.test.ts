import { describe, expect, it } from "vitest";
import { assertSafeZipEntryName } from "./epub";

describe("EPUB archive hardening", () => {
  it.each(["../escape.xhtml", "%2e%2e/escape.xhtml", "%252e%252e/escape.xhtml", "%25252e%25252e/escape.xhtml", "C:/escape.xhtml", "folder\\escape.xhtml"])(
    "rejects unsafe ZIP entry name %s",
    (fileName) => {
      expect(() => assertSafeZipEntryName(fileName)).toThrow(/unsafe archive entry name/i);
    },
  );

  it("accepts a normal EPUB entry name", () => {
    expect(() => assertSafeZipEntryName("OEBPS/Text/chapter-01.xhtml")).not.toThrow();
  });

  it("rejects unsupported LCP protection before package parsing", () => {
    expect(() => assertSafeZipEntryName("META-INF/license.lcpl")).toThrow("此文件受保护，无法读取。");
  });
});
