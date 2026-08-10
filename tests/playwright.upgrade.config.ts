import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "upgrade-v1.spec.ts",
  timeout: 120_000,
  workers: 1,
  reporter: "line",
});
