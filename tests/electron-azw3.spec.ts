import { _electron as electron, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");
const azw3Path = resolve(repoRoot, "../../data-input/pg11-images-kf8.azw3");
const screenshotPath = resolve(repoRoot, "../../png/phase0-azw3.png");

test("real no-DRM KF8 is normalized and rendered through the shared Publication path", async () => {
  test.skip(!existsSync(azw3Path), "Project Gutenberg KF8 fixture is not installed.");
  await mkdir(resolve(screenshotPath, ".."), { recursive: true });
  const dataRoot = await mkdtemp(resolve(tmpdir(), "ereader-phase0-azw3-"));
  const application = await electron.launch({
    executablePath: resolve(repoRoot, "node_modules/electron/dist/electron.exe"),
    args: [repoRoot, "--smoke-test"],
    cwd: repoRoot,
    env: {
      ...process.env,
      EREADER_DATA_ROOT: dataRoot,
      EREADER_STARTUP_MODE: "fixture",
      EREADER_DEFAULT_BOOK: azw3Path,
      EREADER_TTS_PYTHON: resolve(repoRoot, "tts/.missing/python.exe"),
    },
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByTestId("reader-ready")).toBeVisible({ timeout: 20_000 });
    const bookFrame = page.frameLocator("iframe.book-frame");
    await expect(bookFrame.locator("body")).toContainText("Alice", { timeout: 8_000 });
    expect(await bookFrame.locator("[data-speech-unit-id]").count()).toBeGreaterThan(0);
    await page.screenshot({ path: screenshotPath });
  } finally {
    await application.close();
    await rm(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
