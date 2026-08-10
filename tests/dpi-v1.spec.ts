import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");
const executable = resolve(repoRoot, "node_modules/electron/dist/electron.exe");
const screenshotRoot = resolve(__dirname, "../../../png/phase-3");

for (const scale of [1, 1.25, 1.5]) {
  test(`bookshelf remains usable at ${Math.round(scale * 100)} percent DPI`, async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), `ereader-dpi-${scale}-`));
    await mkdir(screenshotRoot, { recursive: true });
    const application = await electron.launch({
      executablePath: executable,
      args: [repoRoot, "--smoke-test", `--force-device-scale-factor=${scale}`],
      cwd: repoRoot,
      env: { ...process.env, EREADER_DATA_ROOT: dataRoot, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
    });
    try {
      const page = await application.firstWindow();
      await expect(page.getByTestId("bookshelf")).toBeVisible({ timeout: 20_000 });
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(700, 540));
      await page.waitForTimeout(300);
      const metrics = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        bodyWidth: document.body.scrollWidth,
        bodyHeight: document.body.scrollHeight,
      }));
      expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
      expect(metrics.innerWidth).toBeGreaterThanOrEqual(660);
      await expect(page.getByRole("button", { name: "导入" })).toBeVisible();
      await expect(page.getByRole("button", { name: "设置" })).toBeVisible();
      await page.screenshot({ path: join(screenshotRoot, `dpi-${Math.round(scale * 100)}-min-window.png`) });
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 900));
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: "设置" }).click();
      await expect(page.getByTestId("settings-view")).toBeVisible();
      await page.screenshot({ path: join(screenshotRoot, `dpi-${Math.round(scale * 100)}-settings.png`) });
    } finally {
      await application.close();
      await rm(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  });
}
