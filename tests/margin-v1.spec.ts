import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");
const executable = resolve(repoRoot, "node_modules/electron/dist/electron.exe");
const fixture = resolve(repoRoot, "fixtures/generated/phase0.epub");
const screenshotRoot = resolve(repoRoot, "../../png/phase-3");

test("reader keeps equal left and right margins at every supported setting", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "ereader-margin-v1-"));
  await mkdir(screenshotRoot, { recursive: true });
  const application = await electron.launch({
    executablePath: executable,
    args: [repoRoot, "--smoke-test"],
    cwd: repoRoot,
    env: { ...process.env, EREADER_DATA_ROOT: dataRoot, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
  });
  try {
    const page = await application.firstWindow();
    await application.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) return;
      const area = screen.getDisplayMatching(window.getBounds()).workArea;
      const width = Math.min(1280, area.width);
      const height = Math.min(900, area.height);
      window.setBounds({
        x: area.x + Math.floor((area.width - width) / 2),
        y: area.y + Math.floor((area.height - height) / 2),
        width,
        height,
      });
    });
    await expect(page.getByTestId("bookshelf")).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.type = "file";
      input.dataset.marginFixture = "true";
      input.hidden = true;
      document.body.append(input);
    });
    const input = page.locator("input[data-margin-fixture]");
    await input.setInputFiles(fixture);
    await page.evaluate(() => {
      const files = document.querySelector<HTMLInputElement>("input[data-margin-fixture]")?.files;
      if (!files?.length) throw new Error("Margin fixture is unavailable.");
      const transfer = new DataTransfer();
      transfer.items.add(files[0]);
      document.querySelector(".library-shell")?.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(page.getByTestId("book-tile")).toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("book-tile").dblclick();
    await expect(page.getByTestId("reader-ready")).toBeVisible({ timeout: 20_000 });

    const frame = page.frameLocator("iframe.book-frame");
    const main = frame.locator("main#book-content");
    await expect(main).toBeVisible();
    await frame.locator("body").evaluate(async () => { await document.fonts.ready; });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.waitForTimeout(500);
    for (const margin of [4, 8, 16]) {
      await main.evaluate((element, value) => element.ownerDocument.documentElement.style.setProperty("--page-margin", `${value}vw`), margin);
      await page.waitForTimeout(120);
      const metrics = await main.evaluate((element, value) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          left: rect.left,
          right: innerWidth - rect.right,
          expected: innerWidth * value / 100,
          width: rect.width,
          viewport: innerWidth,
          columnWidth: Number.parseFloat(style.columnWidth),
          columnGap: Number.parseFloat(style.columnGap),
        };
      }, margin);
      expect(Math.abs(metrics.left - metrics.right)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.left - metrics.expected)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.width + metrics.left + metrics.right - metrics.viewport)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.columnWidth - metrics.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.columnGap - 2 * metrics.expected)).toBeLessThanOrEqual(1);
      if (margin === 8) {
        const overflow = await main.evaluate((element) => {
          const content = element.getBoundingClientRect();
          const rects = Array.from(element.querySelectorAll(".reading-unit")).flatMap((unit) => {
            const range = unit.ownerDocument.createRange();
            range.selectNodeContents(unit);
            return Array.from(range.getClientRects()).map((rect) => ({
              text: unit.textContent?.slice(0, 80) ?? "",
              left: rect.left,
              right: rect.right,
              width: rect.width,
            }));
          });
          return rects
            .filter((rect) => rect.left < content.right && rect.right > content.right + 1)
            .sort((a, b) => b.right - a.right)
            .slice(0, 10)
            .map((rect) => ({ ...rect, contentLeft: content.left, contentRight: content.right }));
        });
        expect(overflow).toEqual([]);
      }
    }

    await main.evaluate((element) => element.ownerDocument.documentElement.style.setProperty("--page-margin", "8vw"));
    await page.waitForTimeout(50);
    const before = await main.evaluate((element) => element.scrollLeft);
    const viewportWidth = await main.evaluate((element) => element.ownerDocument.defaultView?.innerWidth ?? 0);
    const paginationDiagnostics = await main.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      contentScrollWidth: element.scrollWidth,
      viewportWidth: element.ownerDocument.defaultView?.innerWidth ?? 0,
    }));
    process.stdout.write(`[pagination] ${JSON.stringify(paginationDiagnostics)} status=${await page.locator(".sr-only").textContent()}\n`);
    await main.evaluate((element) => element.ownerDocument.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
    await page.waitForTimeout(80);
    const midway = await main.evaluate((element) => element.scrollLeft);
    expect(midway).toBeGreaterThan(before);
    expect(midway).toBeLessThan(before + viewportWidth);
    await page.waitForTimeout(140);
    const afterArrow = await main.evaluate((element) => element.scrollLeft);
    expect(Math.abs(afterArrow - (before + viewportWidth))).toBeLessThanOrEqual(1);

    const clickedPageEdge = await main.evaluate((element) => {
      const document = element.ownerDocument;
      const x = (document.defaultView?.innerWidth ?? 0) * 0.82;
      document.documentElement.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: (document.defaultView?.innerHeight ?? 0) * 0.5,
      }));
      return true;
    });
    expect(clickedPageEdge).toBe(true);
    await page.waitForTimeout(220);
    const afterTextClick = await main.evaluate((element) => element.scrollLeft);
    expect(Math.abs(afterTextClick - (afterArrow + viewportWidth))).toBeLessThanOrEqual(1);
    const turnedPageGeometry = await main.evaluate((element) => {
      const content = element.getBoundingClientRect();
      const visibleRects = Array.from(element.querySelectorAll(".reading-unit")).flatMap((unit) => {
        const range = unit.ownerDocument.createRange();
        range.selectNodeContents(unit);
        return Array.from(range.getClientRects()).map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
      }).filter((rect) => rect.right > content.left && rect.left < content.right && rect.bottom > content.top && rect.top < content.bottom);
      return {
        left: content.left,
        right: content.right,
        viewportRight: element.ownerDocument.defaultView?.innerWidth ?? 0,
        overflow: visibleRects.filter((rect) => rect.left < content.left - 1 || rect.right > content.right + 1),
      };
    });
    expect(Math.abs(turnedPageGeometry.left - (turnedPageGeometry.viewportRight - turnedPageGeometry.right))).toBeLessThanOrEqual(1);
    expect(turnedPageGeometry.overflow).toEqual([]);
    await page.screenshot({ path: join(screenshotRoot, "reader-turned-page-symmetric-margins.png") });
  } finally {
    await application.close().catch(() => undefined);
    await rm(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
