import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");
const fixturePath = resolve(repoRoot, "fixtures/generated/phase0.epub");
const azw3Path = resolve(repoRoot, "../../data-input/pg11-images-kf8.azw3");
const screenshotRoot = resolve(repoRoot, "../../png/phase-1-2");

async function launch(dataRoot: string): Promise<{ application: ElectronApplication; page: Page }> {
  const application = await electron.launch({
    executablePath: resolve(repoRoot, "node_modules/electron/dist/electron.exe"),
    args: [repoRoot, "--smoke-test"],
    cwd: repoRoot,
    env: {
      ...process.env,
      EREADER_DATA_ROOT: dataRoot,
      EREADER_TTS_PYTHON: resolve(repoRoot, "tts/.missing/python.exe"),
    },
  });
  const page = await application.firstWindow();
  return { application, page };
}

async function choosePaths(application: ElectronApplication, paths: string[]): Promise<void> {
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selected }) as Awaited<ReturnType<typeof dialog.showOpenDialog>>;
  }, paths);
}

test("daily Library and full-spine Reader survive source deletion and abrupt restart", async () => {
  test.setTimeout(180_000);
  await fs.mkdir(screenshotRoot, { recursive: true });
  const dataRoot = await fs.mkdtemp(join(tmpdir(), "ereader-phase12-e2e-"));
  const incoming = join(dataRoot, "incoming.epub");
  const protectedPath = join(dataRoot, "protected.azw3");
  await fs.copyFile(fixturePath, incoming);
  const protectedBytes = await fs.readFile(azw3Path);
  protectedBytes.writeUInt16BE(2, protectedBytes.readUInt32BE(78) + 12);
  await fs.writeFile(protectedPath, protectedBytes);

  let first: ElectronApplication | undefined;
  let second: ElectronApplication | undefined;
  let third: ElectronApplication | undefined;
  try {
    const launched = await launch(dataRoot);
    first = launched.application;
    let page = launched.page;
    await expect(page.getByTestId("bookshelf")).toBeVisible({ timeout: 10_000 });

    const input = page.locator("input[data-e2e-file]");
    await page.evaluate(() => {
      const element = document.createElement("input");
      element.type = "file";
      element.dataset.e2eFile = "true";
      element.hidden = true;
      document.body.append(element);
    });
    await input.setInputFiles(incoming);
    await page.evaluate(() => {
      const element = document.querySelector<HTMLInputElement>("input[data-e2e-file]");
      const file = element?.files?.[0];
      if (!file) throw new Error("Backed test file is missing.");
      const transfer = new DataTransfer();
      transfer.items.add(file);
      document.querySelector(".library-shell")?.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(page.getByTestId("book-tile")).toHaveCount(1, { timeout: 15_000 });
    await fs.rm(incoming);

    await choosePaths(first, [azw3Path]);
    await page.keyboard.press("Control+O");
    await expect(page.getByTestId("book-tile")).toHaveCount(2, { timeout: 30_000 });

    await choosePaths(first, [fixturePath]);
    await page.keyboard.press("Control+O");
    await expect(page.getByRole("status")).toContainText("此书已在书架中");

    await choosePaths(first, [protectedPath]);
    await page.keyboard.press("Control+O");
    await expect(page.getByRole("status")).toContainText("此文件受保护，无法读取");

    await page.getByLabel("排序").selectOption("title");
    await page.getByLabel("搜索书名").fill("Alice");
    await expect(page.getByTestId("book-tile")).toHaveCount(1);
    await page.getByLabel("搜索书名").fill("");
    await expect(page.getByTestId("book-tile")).toHaveCount(2);
    await page.screenshot({ path: join(screenshotRoot, "bookshelf.png") });

    const fixtureTile = page.getByTestId("book-tile").filter({ hasText: "E-Reader Phase 0 Fixture" });
    await fixtureTile.dblclick();
    await expect(page.getByTestId("reader-ready")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".library-header")).toHaveCount(0);
    const bookFrame = page.frameLocator("iframe.book-frame");
    await expect(bookFrame.locator("h1")).toContainText("第一章");
    await page.screenshot({ path: join(screenshotRoot, "day-reading.png") });

    const initialProgress = await page.locator(".reading-progress").textContent();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".reading-progress")).not.toHaveText(initialProgress ?? "0%");
    const forwardProgress = await page.locator(".reading-progress").textContent();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".reading-progress")).not.toHaveText(forwardProgress ?? "0%");
    await bookFrame.locator("html").evaluate((root) => root.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      clientX: document.documentElement.clientWidth * 0.9,
      clientY: document.documentElement.clientHeight * 0.5,
    })));
    const edgeProgress = await page.locator(".reading-progress").textContent();
    await bookFrame.locator("html").evaluate((root) => root.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      clientX: document.documentElement.clientWidth * 0.1,
      clientY: document.documentElement.clientHeight * 0.5,
    })));
    await expect(page.locator(".reading-progress")).not.toHaveText(edgeProgress ?? "0%");

    await expect.poll(async () => {
      await page.keyboard.press("ArrowRight");
      return bookFrame.locator("h1").first().textContent();
    }, { timeout: 15_000, intervals: [50] }).toContain("Chapter Two");
    await page.keyboard.press("ArrowLeft");
    await expect(bookFrame.locator("h1")).toContainText("第一章", { timeout: 8_000 });

    await page.keyboard.press("t");
    await expect(page.getByTestId("toc-panel")).toBeVisible();
    await page.screenshot({ path: join(screenshotRoot, "toc.png") });
    await page.getByTestId("toc-panel").getByRole("button", { name: "第二章" }).click();
    await expect(bookFrame.locator("h1")).toContainText("Chapter Two", { timeout: 8_000 });
    const unit = bookFrame.locator("[data-speech-unit-id]").last();
    await unit.click();
    await expect(unit).toHaveClass(/is-active/);
    await page.keyboard.press("+");
    await first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1060, 760));
    await expect(unit).toBeVisible();
    await page.waitForTimeout(500);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("bookshelf")).toBeVisible();
    await page.getByTestId("book-tile").filter({ hasText: "Alice's Adventures in Wonderland" }).dblclick();
    await expect(page.getByTestId("reader-ready")).toBeVisible();
    await expect(page.frameLocator("iframe.book-frame").locator("body")).toContainText("Alice");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("bookshelf")).toBeVisible();
    await page.getByRole("button", { name: "设置" }).click();
    await expect(page.getByTestId("settings-view")).toBeVisible();
    await page.getByLabel("页面").selectOption("night");
    await page.screenshot({ path: join(screenshotRoot, "settings.png") });
    await page.getByRole("button", { name: /书架/ }).click();
    await page.getByTestId("book-tile").filter({ hasText: "E-Reader Phase 0 Fixture" }).dblclick();
    await expect(page.getByTestId("reader-ready")).toHaveClass(/theme-night/);
    await expect(bookFrame.locator("h1")).toContainText("Chapter Two", { timeout: 8_000 });
    await page.screenshot({ path: join(screenshotRoot, "night-reading.png") });
    const savedProgress = Number((await page.locator(".reading-progress").textContent())?.replace("%", ""));
    expect(savedProgress).toBeGreaterThan(0);
    await page.waitForTimeout(500);

    const process = first.process();
    await new Promise<void>((resolveKill, rejectKill) => {
      execFile("taskkill.exe", ["/PID", String(process.pid), "/T", "/F"], { windowsHide: true }, (error) => {
        if (error) rejectKill(error);
        else resolveKill();
      });
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    first = undefined;

    const relaunched = await launch(dataRoot);
    second = relaunched.application;
    page = relaunched.page;
    await expect(page.getByTestId("reader-ready")).toBeVisible({ timeout: 12_000 });
    const resumedFrame = page.frameLocator("iframe.book-frame");
    await expect(resumedFrame.locator("h1")).toContainText("Chapter Two");
    const resumedProgress = Number((await page.locator(".reading-progress").textContent())?.replace("%", ""));
    expect(resumedProgress).toBeGreaterThan(0);
    await second.close();
    second = undefined;

    const normalRestart = await launch(dataRoot);
    third = normalRestart.application;
    await expect(normalRestart.page.getByTestId("reader-ready")).toBeVisible({ timeout: 12_000 });
    await expect(normalRestart.page.frameLocator("iframe.book-frame").locator("h1")).toContainText("Chapter Two");
  } finally {
    if (first) await first.close().catch(() => undefined);
    if (second) await second.close().catch(() => undefined);
    if (third) await third.close().catch(() => undefined);
    await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
