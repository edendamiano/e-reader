import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");
const executable = process.env.EREADER_PACKAGED_EXE
  ? resolve(process.env.EREADER_PACKAGED_EXE)
  : resolve(repoRoot, "release/win-unpacked/E-Reader.exe");
const fixture = resolve(repoRoot, "fixtures/generated/phase0.epub");
const azw3Fixture = resolve(repoRoot, "../../data-input/pg11-images-kf8.azw3");
const screenshotRoot = resolve(repoRoot, "../../png/phase-3");

async function launch(dataRoot: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: executable,
    cwd: resolve(executable, ".."),
    env: {
      ...process.env,
      EREADER_DATA_ROOT: dataRoot,
    },
  });
}

test("packaged EXE imports, reads, blocks network, and resumes", async () => {
  test.setTimeout(240_000);
  await mkdir(screenshotRoot, { recursive: true });
  const dataRoot = await mkdtemp(join(tmpdir(), "ereader-packaged-v1-"));
  let application: ElectronApplication | undefined;
  let restarted: ElectronApplication | undefined;
  try {
    application = await launch(dataRoot);
    let page = await application.firstWindow();
    await expect(page.getByTestId("bookshelf")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".empty-library")).toContainText("将 EPUB 或 AZW3 拖到这里");
    await expect(page.locator(".empty-library")).toContainText("Ctrl+O");
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByLabel("页面").selectOption("night");
    await page.getByRole("slider", { name: "字号" }).fill("24");
    await expect.poll(() => page.evaluate(() => window.ereader.getSettings())).toMatchObject({ theme: "night", fontSize: 24 });
    await page.getByRole("button", { name: /书架/ }).click();

    await page.evaluate(() => {
      const element = document.createElement("input");
      element.type = "file";
      element.multiple = true;
      element.dataset.packagedFile = "true";
      element.hidden = true;
      document.body.append(element);
    });
    const input = page.locator("input[data-packaged-file]");
    await input.setInputFiles([fixture, azw3Fixture]);
    await page.evaluate(() => {
      const files = document.querySelector<HTMLInputElement>("input[data-packaged-file]")?.files;
      if (!files?.length) throw new Error("Fixture files are unavailable.");
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      document.querySelector(".library-shell")?.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    const tile = page.getByTestId("book-tile");
    await expect(tile).toHaveCount(2, { timeout: 30_000 });
    const coverSources = await tile.locator("img").evaluateAll((images) => images.map((image) => image.getAttribute("src") ?? ""));
    expect(coverSources.some((source) => /^data:image\/(?:png|jpeg);base64,/.test(source))).toBe(true);
    expect(coverSources.some((source) => /^data:image\/svg\+xml;base64,/.test(source))).toBe(true);
    await page.screenshot({ path: join(screenshotRoot, "packaged-bookshelf.png") });

    await tile.filter({ hasText: "E-Reader Phase 0 Fixture" }).dblclick();
    await expect(page.getByTestId("reader-ready")).toBeVisible({ timeout: 20_000 });
    await expect(page.frameLocator("iframe.book-frame").locator("h1")).toContainText("第一章");
    await expect(page.evaluate(() => fetch("https://example.invalid/telemetry").then(() => "allowed").catch(() => "blocked"))).resolves.toBe("blocked");
    await expect(page.evaluate(() => fetch("file:///C:/Windows/win.ini").then(() => "allowed").catch(() => "blocked"))).resolves.toBe("blocked");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(screenshotRoot, "packaged-reader.png") });

    await page.waitForTimeout(800);
    await application.close();
    application = undefined;

    restarted = await launch(dataRoot);
    page = await restarted.firstWindow();
    await expect(page.getByTestId("reader-ready")).toBeVisible({ timeout: 20_000 });
    await expect(page.frameLocator("iframe.book-frame").locator("h1")).toContainText("第一章");
  } finally {
    if (application) await application.close().catch(() => undefined);
    if (restarted) await restarted.close().catch(() => undefined);
    await rm(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
