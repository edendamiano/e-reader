import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "dpi-v1.spec.ts",
  timeout: 90_000,
  workers: 1,
  reporter: "line",
});
