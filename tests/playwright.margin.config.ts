import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "margin-v1.spec.ts",
  timeout: 90_000,
  workers: 1,
  reporter: "line",
  use: { trace: "retain-on-failure" },
});
