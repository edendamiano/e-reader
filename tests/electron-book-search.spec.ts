import { _electron as electron, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");
const epubPath = resolve(repoRoot, "fixtures/generated/phase0.epub");
const azw3Path = resolve(repoRoot, "../../data-input/pg11-images-kf8.azw3");
const longEpubPath = resolve(repoRoot, "../../data-input/se-don-quixote.epub");
const screenshotRoot = resolve(repoRoot, "../../png/whole-book-search");

async function openImportedBook(sourcePath: string) {
  const dataRoot = await mkdtemp(join(tmpdir(), "ereader-book-search-"));
  const application = await electron.launch({
    executablePath: resolve(repoRoot, "node_modules/electron/dist/electron.exe"),
    args: [repoRoot, "--smoke-test"],
    cwd: repoRoot,
    env: { ...process.env, EREADER_DATA_ROOT: dataRoot },
  });
  const page = await application.firstWindow();
  await expect(page.getByTestId("bookshelf")).toBeVisible({ timeout: 20_000 });
  await page.evaluate(async (path) => {
    await window.ereader.importTestPaths([path]);
  }, sourcePath);
  await page.reload();
  await expect(page.getByTestId("book-tile")).toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId("book-tile").dblclick();
  await expect(page.getByTestId("reader-ready")).toBeVisible({ timeout: 20_000 });
  return { application, page, dataRoot };
}

test("EPUB whole-book search normalizes text, lists all matches, jumps across chapters, and highlights", async () => {
  test.setTimeout(120_000);
  await mkdir(screenshotRoot, { recursive: true });
  const { application, page, dataRoot } = await openImportedBook(epubPath);
  try {
    const bookFrame = page.frameLocator("iframe.book-frame");
    await expect(bookFrame.locator("h1")).toContainText("第一章");
    await page.keyboard.press("Control+F");
    const panel = page.getByTestId("book-search-panel");
    const input = page.getByLabel("搜索当前整本书");
    await expect(panel).toBeVisible();
    await expect(input).toBeFocused();

    await input.fill("我们使用  transformer architecture，检查中英混排");
    await expect(page.getByTestId("book-search-status")).toContainText("找到 34 处匹配", { timeout: 20_000 });
    await expect(page.getByTestId("book-search-result")).toHaveCount(34);
    await expect(page.getByTestId("book-search-result").first()).toContainText("第一章");
    await page.screenshot({ path: join(screenshotRoot, "epub-multiple-results.png") });

    await input.fill("locator   should survive，a font-size change");
    await expect(page.getByTestId("book-search-result")).toHaveCount(1);
    await expect(page.getByTestId("book-search-result")).toContainText("第二章");
    await page.getByTestId("book-search-result").click();
    await expect(panel).toHaveCount(0);
    await expect(bookFrame.locator("h1")).toContainText("Chapter Two", { timeout: 12_000 });
    await expect(bookFrame.locator("mark.reader-search-hit")).toContainText("locator should survive a font-size change");
    const geometry = await bookFrame.locator("mark.reader-search-hit").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: innerWidth };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1);
    await page.screenshot({ path: join(screenshotRoot, "epub-cross-chapter-highlight.png") });
    await expect(bookFrame.locator("mark.reader-search-hit")).toHaveCount(0, { timeout: 7_000 });

    await page.keyboard.press("Control+F");
    await expect(panel).toBeVisible();
    await input.fill("locator sentence");
    await expect(page.getByTestId("book-search-result")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("reader-ready")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("bookshelf")).toBeVisible();
  } finally {
    await application.close().catch(() => undefined);
    await rm(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test("AZW3 uses its normalized EPUB spine for whole-book search and result navigation", async () => {
  test.skip(!existsSync(azw3Path), "Project Gutenberg KF8 fixture is not installed.");
  test.setTimeout(150_000);
  await mkdir(screenshotRoot, { recursive: true });
  const { application, page, dataRoot } = await openImportedBook(azw3Path);
  try {
    await page.keyboard.press("Control+F");
    const input = page.getByLabel("搜索当前整本书");
    await input.fill("cheshire  cat");
    await expect(page.getByTestId("book-search-status")).toHaveText(/^找到 \d+ 处匹配$/, { timeout: 90_000 });
    const matches = page.getByTestId("book-search-result");
    expect(await matches.count()).toBeGreaterThan(1);
    await page.screenshot({ path: join(screenshotRoot, "azw3-whole-book-results.png") });
    await matches.first().click();
    const mark = page.frameLocator("iframe.book-frame").locator("mark.reader-search-hit");
    await expect(mark.first()).toBeVisible({ timeout: 15_000 });
    await expect(mark.first()).toContainText(/cheshire/i);
    await page.screenshot({ path: join(screenshotRoot, "azw3-search-highlight.png") });
  } finally {
    await application.close().catch(() => undefined);
    await rm(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test("long EPUB indexes all 142 spine chapters and searches its complete text", async () => {
  test.skip(!existsSync(longEpubPath), "Long Standard Ebooks EPUB fixture is not installed.");
  test.setTimeout(240_000);
  await mkdir(screenshotRoot, { recursive: true });
  const { application, page, dataRoot } = await openImportedBook(longEpubPath);
  try {
    await page.keyboard.press("Control+F");
    const input = page.getByLabel("搜索当前整本书");
    await input.fill("ingenious   gentleman");
    const status = page.getByTestId("book-search-status");
    await expect(status).toHaveText(/^找到 \d+ 处匹配$/, { timeout: 180_000 });
    expect(await page.getByTestId("book-search-result").count()).toBeGreaterThan(0);
    await input.clear();
    await expect(status).toContainText("共 142 个章节");
    await input.fill("ingenious gentleman");
    await expect(page.getByTestId("book-search-result").first()).toBeVisible();
    await page.screenshot({ path: join(screenshotRoot, "epub-142-chapters-results.png") });
  } finally {
    await application.close().catch(() => undefined);
    await rm(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
