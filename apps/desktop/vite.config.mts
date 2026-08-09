import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(configDir, "renderer"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve(configDir, "../../dist/renderer"),
    emptyOutDir: false,
  },
});
