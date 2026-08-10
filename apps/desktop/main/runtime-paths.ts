import { join, resolve } from "node:path";
import type { LibraryPaths } from "./library-service";

export function resolveRuntimeRoot(isPackaged: boolean, resourcesPath: string, repoRoot: string): string {
  return isPackaged ? resolve(resourcesPath) : resolve(repoRoot);
}

export function resolveLibraryPaths(configuredRoot: string | undefined, localAppData: string | undefined, userData: string): LibraryPaths {
  const root = configuredRoot
    ? resolve(configuredRoot)
    : localAppData
      ? join(localAppData, "EReader")
      : resolve(userData);
  return {
    root,
    library: join(root, "library"),
    database: join(root, "database", "reader.sqlite3"),
    logs: join(root, "logs"),
  };
}
