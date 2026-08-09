import { extname, resolve } from "node:path";
import type { OpenPublicationResult } from "../../shared/src/types";
import { openAzw3 } from "./azw3";
import { openEpub } from "./epub";

export async function openPublication(filePath: string, repoRoot: string): Promise<OpenPublicationResult> {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".epub") {
    return openEpub(filePath);
  }
  if (extension === ".azw3") {
    return openAzw3(filePath, resolve(repoRoot, "native/azw3/bin/mobitool.exe"));
  }
  throw new Error("Only EPUB and AZW3/KF8 files are supported.");
}
