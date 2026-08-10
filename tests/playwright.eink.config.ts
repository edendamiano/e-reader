import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "eink-visual.spec.ts",
  timeout: 240_000,
  workers: 1,
  reporter: "line",
  use: { trace: "retain-on-failure" },
});
