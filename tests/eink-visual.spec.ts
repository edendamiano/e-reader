import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");
const screenshotRoot = resolve(repoRoot, "../../png/eink-rendering");
const electronExe = resolve(repoRoot, "node_modules/electron/dist/electron.exe");

async function launchBook(bookPath: string): Promise<{ application: ElectronApplication; page: Page; dataRoot: string }> {
  const dataRoot = await mkdtemp(join(tmpdir(), "ereader-eink-"));
  const application = await electron.launch({
    executablePath: electronExe,
    args: [repoRoot, "--smoke-test"],
    cwd: repoRoot,
    env: { ...process.env, EREADER_DATA_ROOT: dataRoot, EREADER_STARTUP_MODE: "fixture", EREADER_DEFAULT_BOOK: bookPath },
  });
  const page = await application.firstWindow();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 1000));
  await expect(page.getByTestId("reader-ready")).toBeVisible({ timeout: 20_000 });
  await page.frameLocator("iframe.book-frame").locator("body").evaluate(async () => { await document.fonts.ready; });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.waitForTimeout(500);
  return { application, page, dataRoot };
}

async function closeBook(application: ElectronApplication, dataRoot: string): Promise<void> {
  await application.close().catch(() => undefined);
  await rm(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

async function setSettings(page: Page, changes: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (next) => {
    const current = await window.ereader.getSettings();
    await window.ereader.saveSettings({ ...current, ...next });
  }, changes);
  await page.reload();
  await expect(page.getByTestId("reader-ready")).toBeVisible({ timeout: 20_000 });
  await page.frameLocator("iframe.book-frame").locator("body").evaluate(async () => { await document.fonts.ready; });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.waitForTimeout(500);
}

async function turnRight(page: Page, count = 1): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(230);
  }
}

async function turnLeft(page: Page, count = 1): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(230);
  }
}

async function goToText(page: Page, text: string): Promise<void> {
  const targetPage = await page.frameLocator("iframe.book-frame").locator("main#book-content").evaluate((element, target) => {
    const unit = Array.from(element.querySelectorAll<HTMLElement>("[data-reading-unit-id]")).find((candidate) => candidate.textContent?.includes(target));
    if (!unit) return 0;
    return Math.max(0, Math.floor((unit.getBoundingClientRect().left + element.scrollLeft + 1) / Math.max(1, innerWidth)));
  }, text);
  await turnRight(page, targetPage);
}

test("capture actual E-Ink rendering and font comparisons", async () => {
  test.setTimeout(240_000);
  await mkdir(screenshotRoot, { recursive: true });
  const chinese = resolve(repoRoot, "../../data-input/pg23839-analects-zh-epub3.epub");
  const english = resolve(repoRoot, "../../data-input/pg11-alice-epub3.epub");
  const mixed = resolve(repoRoot, "fixtures/generated/phase0.epub");

  {
    const { application, page, dataRoot } = await launchBook(chinese);
    try {
      await goToText(page, "學而");
      await page.screenshot({ path: join(screenshotRoot, "01-chinese-title-day.png") });
      await turnRight(page);
      await page.screenshot({ path: join(screenshotRoot, "02-chinese-body-default-day.png") });
      const body = page.frameLocator("iframe.book-frame").locator("body");
      await body.evaluate((element) => { element.style.fontFamily = '"EReader Lora", "EReader Noto Serif SC", serif'; });
      await page.screenshot({ path: join(screenshotRoot, "comparison-noto-serif-sc.png") });
      await body.evaluate((element) => { element.style.fontFamily = '"EReader Lora", SimSun, serif'; });
      await page.screenshot({ path: join(screenshotRoot, "comparison-simsun.png") });
      await body.evaluate((element) => { element.style.fontFamily = '"EReader Lora", STSong, serif'; });
      await page.screenshot({ path: join(screenshotRoot, "comparison-stsong.png") });
      await setSettings(page, { fontSize: 16, theme: "day" });
      await turnRight(page);
      await page.screenshot({ path: join(screenshotRoot, "03-chinese-small-size-day.png") });
    } finally { await closeBook(application, dataRoot); }
  }

  {
    const { application, page, dataRoot } = await launchBook(english);
    try {
      await page.screenshot({ path: join(screenshotRoot, "04-english-title-day.png") });
      await turnRight(page);
      await page.screenshot({ path: join(screenshotRoot, "05-english-lora-long-paragraph-day.png") });
    } finally { await closeBook(application, dataRoot); }
  }

  {
    const { application, page, dataRoot } = await launchBook(mixed);
    try {
      const frame = page.frameLocator("iframe.book-frame");
      const imagePage = await frame.locator("img").first().evaluate((image) => {
        const content = document.getElementById("book-content");
        return Math.max(0, Math.floor((image.getBoundingClientRect().left + (content?.scrollLeft ?? 0) + 1) / Math.max(1, innerWidth)));
      });
      await turnRight(page, imagePage);
      await page.screenshot({ path: join(screenshotRoot, "06-image-grayscale-day.png") });
      await turnLeft(page, imagePage);
      await turnRight(page, imagePage + 1);
      const pagination = await page.frameLocator("iframe.book-frame").locator("main#book-content").evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          innerWidth,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          scrollLeft: element.scrollLeft,
          left: rect.left,
          right: rect.right,
          columnWidth: style.columnWidth,
          columnGap: style.columnGap,
        };
      });
      process.stdout.write(`[eink-pagination] ${JSON.stringify(pagination)}\n`);
      await page.screenshot({ path: join(screenshotRoot, "07-mixed-language-day.png") });
      await page.keyboard.press("t");
      await expect(page.getByTestId("toc-panel")).toBeVisible();
      await page.screenshot({ path: join(screenshotRoot, "08-ui-toc-overlay.png") });
      await page.keyboard.press("Escape");
      await setSettings(page, { fontSize: 21, theme: "night" });
      await turnRight(page);
      await page.screenshot({ path: join(screenshotRoot, "09-mixed-language-night.png") });
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setFullScreen(true));
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(screenshotRoot, "10-fullscreen-night.png") });
    } finally { await closeBook(application, dataRoot); }
  }
});
