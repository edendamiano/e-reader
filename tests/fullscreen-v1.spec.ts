import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");
const executable = resolve(repoRoot, "node_modules/electron/dist/electron.exe");

test("production launch defaults to fullscreen and F11 toggles it", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "ereader-fullscreen-v1-"));
  const application = await electron.launch({
    executablePath: executable,
    args: [repoRoot, "--smoke-test"],
    cwd: repoRoot,
    env: {
      ...process.env,
      EREADER_DATA_ROOT: dataRoot,
      EREADER_DEFAULT_FULLSCREEN: "1",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
    },
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByTestId("bookshelf")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen())).toBe(true);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({ type: "keyDown", keyCode: "F11" }));
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen())).toBe(false);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({ type: "keyDown", keyCode: "F11" }));
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen())).toBe(true);
  } finally {
    await application.close().catch(() => undefined);
    await rm(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
