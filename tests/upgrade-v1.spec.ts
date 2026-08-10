import { _electron as electron, expect, test } from "@playwright/test";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");
const executable = resolve(process.env.EREADER_PACKAGED_EXE ?? "");
const dataRoot = resolve(process.env.EREADER_UPGRADE_DATA_ROOT ?? "");
const phase = process.env.EREADER_UPGRADE_PHASE;
const fixture = resolve(repoRoot, "fixtures/generated/phase0.epub");

test(`installed upgrade phase ${phase}`, async () => {
  expect(["A", "B"]).toContain(phase);
  const application = await electron.launch({
    executablePath: executable,
    cwd: resolve(executable, ".."),
    env: { ...process.env, EREADER_DATA_ROOT: dataRoot, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
  });
  try {
    const page = await application.firstWindow();
    if (phase === "A") {
      await expect(page.getByTestId("bookshelf")).toBeVisible({ timeout: 20_000 });
      await page.evaluate(() => {
        const element = document.createElement("input");
        element.type = "file";
        element.dataset.upgradeFile = "true";
        element.hidden = true;
        document.body.append(element);
      });
      const input = page.locator("input[data-upgrade-file]");
      await input.setInputFiles(fixture);
      await page.evaluate(() => {
        const file = document.querySelector<HTMLInputElement>("input[data-upgrade-file]")?.files?.[0];
        if (!file) throw new Error("Upgrade fixture is unavailable.");
        const transfer = new DataTransfer();
        transfer.items.add(file);
        document.querySelector(".library-shell")?.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      });
      await expect(page.getByTestId("book-tile")).toHaveCount(1, { timeout: 20_000 });
      await page.getByRole("button", { name: "设置" }).click();
      await page.getByLabel("页面").selectOption("night");
      await expect.poll(() => page.evaluate(() => window.ereader.getSettings())).toMatchObject({ theme: "night" });
      await page.getByRole("slider", { name: "字号" }).fill("24");
      await expect.poll(() => page.evaluate(() => window.ereader.getSettings())).toMatchObject({ theme: "night", fontSize: 24 });
      await expect.poll(() => page.evaluate(() => window.ereader.getSettings())).toMatchObject({ theme: "night", fontSize: 24 });
      await page.getByRole("button", { name: /书架/ }).click();
      await page.getByTestId("book-tile").dblclick();
      await expect(page.getByTestId("reader-ready")).toBeVisible();
      await expect(page.frameLocator("iframe.book-frame").locator("h1")).toContainText("第一章");
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => Number((await page.locator(".reading-progress").textContent())?.replace("%", ""))).toBeGreaterThan(0);
      await page.waitForTimeout(600);
    } else {
      await expect(page.getByTestId("reader-ready")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("reader-ready")).toHaveClass(/theme-night/);
      const settings = await page.evaluate(() => window.ereader.getSettings());
      expect(settings).toMatchObject({ theme: "night", fontSize: 24 });
      const progress = Number((await page.locator(".reading-progress").textContent())?.replace("%", ""));
      expect(progress).toBeGreaterThan(0);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("book-tile")).toHaveCount(1);
    }
  } finally {
    await application.close();
  }
});
