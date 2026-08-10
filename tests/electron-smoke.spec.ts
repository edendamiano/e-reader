import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");
const screenshotPath = resolve(repoRoot, "../../png/phase0-reader.png");

test("secure Electron window renders and paginates the real EPUB fixture", async () => {
  await mkdir(resolve(screenshotPath, ".."), { recursive: true });
  const dataRoot = await mkdtemp(resolve(tmpdir(), "ereader-phase0-epub-"));
  const application = await electron.launch({
    executablePath: resolve(repoRoot, "node_modules/electron/dist/electron.exe"),
    args: [repoRoot, "--smoke-test"],
    cwd: repoRoot,
    env: { ...process.env, EREADER_DATA_ROOT: dataRoot, EREADER_STARTUP_MODE: "fixture" },
  });
  try {
    const page = await application.firstWindow();
    page.on("console", (message) => process.stdout.write(`[renderer:${message.type()}] ${message.text()}\n`));
    page.on("pageerror", (error) => process.stdout.write(`[renderer:error] ${error.stack ?? error.message}\n`));
    await page.waitForTimeout(1_000);
    process.stdout.write(`[renderer:state] url=${page.url()} text=${JSON.stringify(await page.locator("body").innerText())} bridge=${await page.evaluate(() => typeof window.ereader)}\n`);
    await expect(page.getByTestId("reader-ready")).toBeVisible({ timeout: 8_000 });
    const preferences = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return window?.webContents.getLastWebPreferences();
    });
    expect(preferences?.nodeIntegration).toBe(false);
    expect(preferences?.contextIsolation).toBe(true);
    expect(preferences?.sandbox).toBe(true);

    const bookFrame = page.frameLocator("iframe.book-frame");
    await expect(bookFrame.locator("h1")).toContainText("第一章");
    expect(await bookFrame.locator("[data-reading-unit-id]").count()).toBeGreaterThan(40);
    expect(await page.evaluate(() => window.__EPUB_SCRIPT_EXECUTED__)).toBeUndefined();
    expect(await page.evaluate(() => window.__EPUB_HANDLER_EXECUTED__)).toBeUndefined();
    await expect(page.evaluate(() => fetch("https://example.invalid/tracker").then(() => "allowed").catch(() => "blocked"))).resolves.toBe("blocked");
    await expect(page.evaluate(() => fetch("file:///C:/Windows/win.ini").then(() => "allowed").catch(() => "blocked"))).resolves.toBe("blocked");

    const initialProgress = await page.locator(".reading-progress").textContent();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".reading-progress")).not.toHaveText(initialProgress ?? "0%");

    const progressBeforeEdgeClick = await page.locator(".reading-progress").textContent();
    await bookFrame.locator("html").evaluate((root) => {
      root.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        clientX: document.documentElement.clientWidth * 0.9,
        clientY: document.documentElement.clientHeight * 0.5,
      }));
    });
    await expect(page.locator(".reading-progress")).not.toHaveText(progressBeforeEdgeClick ?? "0%");

    const visibleUnitId = await bookFrame.locator("[data-reading-unit-id]").evaluateAll((elements) => {
      const visible = elements.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= document.documentElement.clientWidth && rect.top >= 0 && rect.bottom <= document.documentElement.clientHeight;
      });
      return visible?.getAttribute("data-reading-unit-id") ?? "";
    });
    expect(visibleUnitId).not.toBe("");
    const selectedUnit = bookFrame.locator(`[data-reading-unit-id="${visibleUnitId}"]`);
    await selectedUnit.dispatchEvent("click");
    const fontSizeBefore = await bookFrame.locator("html").evaluate((root) => getComputedStyle(root).getPropertyValue("--font-size"));
    await page.keyboard.press("+");
    await expect.poll(() => bookFrame.locator("html").evaluate((root) => getComputedStyle(root).getPropertyValue("--font-size"))).not.toBe(fontSizeBefore);
    await expect(selectedUnit).toBeVisible();
    await page.screenshot({ path: screenshotPath });
  } finally {
    await application.close();
    await rm(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
