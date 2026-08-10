import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "fullscreen-v1.spec.ts",
  timeout: 60_000,
  workers: 1,
  reporter: "line",
});
