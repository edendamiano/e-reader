import { describe, expect, it } from "vitest";
import { resolveLibraryPaths, resolveRuntimeRoot } from "./runtime-paths";

describe("packaged runtime path resolution", () => {
  it("uses resourcesPath and never the development repository in packaged mode", () => {
    const root = resolveRuntimeRoot(true, "C:\\Program Files\\E-Reader\\resources", "D:\\codex-output\\e-reader");
  });

  it("keeps all user data below the stable LocalAppData root", () => {
    const paths = resolveLibraryPaths(undefined, "C:\\Users\\Reader\\AppData\\Local", "C:\\fallback");
    expect(paths.root).toBe("C:\\Users\\Reader\\AppData\\Local\\EReader");
    expect(paths.database).toBe("C:\\Users\\Reader\\AppData\\Local\\EReader\\database\\reader.sqlite3");
    expect(paths.library).toBe("C:\\Users\\Reader\\AppData\\Local\\EReader\\library");
  });
});
