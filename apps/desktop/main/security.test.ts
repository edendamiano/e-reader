import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowedRequestUrl } from "./security";

const renderer = resolve("D:/app/dist/renderer/index.html");

describe("Electron request allow-list", () => {
  it("allows only renderer build files plus inert local document schemes", () => {
    expect(isAllowedRequestUrl(pathToFileURL(renderer).href, renderer)).toBe(true);
    expect(isAllowedRequestUrl(pathToFileURL(resolve(renderer, "../assets/app.js")).href, renderer)).toBe(true);
    expect(isAllowedRequestUrl("data:image/png;base64,AA==", renderer)).toBe(true);
    expect(isAllowedRequestUrl("blob:null/1234", renderer)).toBe(true);
  });

  it.each([
    "https://example.com/tracker",
    "http://127.0.0.1:8080/",
    "file:///C:/Windows/win.ini",
    "javascript:alert(1)",
    "not a url",
  ])("blocks network, arbitrary filesystem, and dangerous request %s", (url) => {
    expect(isAllowedRequestUrl(url, renderer)).toBe(false);
  });
});
