import { _electron as electron, expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");
const screenshotPath = resolve(repoRoot, "../../png/phase0-tts.png");

test("persistent offline TTS caches audio and advances SpeechUnit playback", async () => {
  test.setTimeout(180_000);
  await mkdir(resolve(screenshotPath, ".."), { recursive: true });
  const application = await electron.launch({
    executablePath: resolve(repoRoot, "node_modules/electron/dist/electron.exe"),
    args: [repoRoot, "--smoke-test"],
    cwd: repoRoot,
    env: {
      ...process.env,
      EREADER_TTS_PYTHON: resolve(repoRoot, "tts/.venv/Scripts/python.exe"),
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
    },
  });
  try {
    const page = await application.firstWindow();
    page.on("console", (message) => process.stdout.write(`[renderer:${message.type()}] ${message.text()}\n`));
    page.on("pageerror", (error) => process.stdout.write(`[renderer:error] ${error.stack ?? error.message}\n`));
    await expect(page.getByTestId("reader-ready")).toBeVisible({ timeout: 15_000 });

    const health = await page.evaluate(() => window.ereader.ttsHealth());
    expect(health).toMatchObject({ ready: true });
    expect(health).not.toHaveProperty("engine");
    expect(health).not.toHaveProperty("device");

    const cacheText = `本地离线朗读缓存验证，编号 ${randomUUID()}。`;
    const first = await page.evaluate((text) => window.ereader.synthesize(text, 1, { language: "zh" }), cacheText);
    const second = await page.evaluate((text) => window.ereader.synthesize(text, 1, { language: "zh" }), cacheText);
    expect(first.audioDataUrl.startsWith("data:audio/wav;base64,")).toBe(true);
    expect(first.audioDataUrl.length).toBeGreaterThan(1_000);
    expect(first.cacheHit).toBe(false);
    expect(first).not.toHaveProperty("engine");
    expect(second.cacheHit).toBe(true);
    expect(second.audioDataUrl).toBe(first.audioDataUrl);

    const bookFrame = page.frameLocator("iframe.book-frame");
    const units = await bookFrame.locator("[data-speech-unit-id]").evaluateAll((elements) => elements.slice(0, 12).map((element, index) => ({
      id: element.getAttribute("data-speech-unit-id") ?? "",
      index,
      textLength: element.textContent?.trim().length ?? Number.MAX_SAFE_INTEGER,
    })));
    const candidates = units.filter((unit) => unit.id && unit.index < units.length - 1).sort((left, right) => left.textLength - right.textLength);
    expect(candidates.length).toBeGreaterThan(1);

    const firstUnit = candidates[0];
    const firstLocator = bookFrame.locator(`[data-speech-unit-id="${firstUnit.id}"]`);
    await firstLocator.click();
    await expect(firstLocator).toHaveClass(/is-active/);
    await page.keyboard.press("Space");
    await expect.poll(
      () => bookFrame.locator(".speech-unit.is-active").getAttribute("data-speech-unit-id"),
      { timeout: 30_000 },
    ).not.toBe(firstUnit.id);
    await page.screenshot({ path: screenshotPath });

    const activeAfterFirst = await bookFrame.locator(".speech-unit.is-active").getAttribute("data-speech-unit-id");
    const target = candidates.find((candidate) => candidate.id !== firstUnit.id && candidate.id !== activeAfterFirst) ?? candidates[1];
    const targetLocator = bookFrame.locator(`[data-speech-unit-id="${target.id}"]`);
    await targetLocator.click();
    await expect(targetLocator).toHaveClass(/is-active/);
    await page.keyboard.press("Space");
    await expect.poll(
      () => bookFrame.locator(".speech-unit.is-active").getAttribute("data-speech-unit-id"),
      { timeout: 30_000 },
    ).not.toBe(target.id);
    await expect(page.locator("body")).not.toContainText("朗读暂时不可用");
  } finally {
    await application.close();
  }
});
