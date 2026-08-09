import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { OpenPublicationResult } from "../../shared/src/types";
import { openEpub, sha256File } from "./epub";

const execFileAsync = promisify(execFile);
const MAX_AZW3_BYTES = 1_000_000_000;
const CONVERSION_TIMEOUT_MS = 120_000;

export interface Azw3Header {
  encryptionType: number;
  fileVersion: number;
}

export class ProtectedPublicationError extends Error {
  public readonly code = "PUBLICATION_PROTECTED";

  public constructor() {
    super("此文件受保护，无法读取。");
    this.name = "ProtectedPublicationError";
  }
}

export async function inspectAzw3Header(filePath: string): Promise<Azw3Header> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_AZW3_BYTES) {
    throw new Error("AZW3 size is invalid or exceeds the safety limit.");
  }

  const file = await fs.open(filePath, "r");
  try {
    const pdbHeader = Buffer.alloc(86);
    const pdbRead = await file.read(pdbHeader, 0, pdbHeader.length, 0);
    if (pdbRead.bytesRead < 86 || pdbHeader.toString("ascii", 60, 68) !== "BOOKMOBI") {
      throw new Error("Not a supported Kindle/MOBI container.");
    }
    const firstRecordOffset = pdbHeader.readUInt32BE(78);
    if (firstRecordOffset < 86 || firstRecordOffset + 40 > stat.size) {
      throw new Error("Corrupted AZW3 record table.");
    }
    const recordHeader = Buffer.alloc(40);
    const recordRead = await file.read(recordHeader, 0, recordHeader.length, firstRecordOffset);
    if (recordRead.bytesRead < recordHeader.length || recordHeader.toString("ascii", 16, 20) !== "MOBI") {
      throw new Error("AZW3 MOBI header is missing.");
    }
    return {
      encryptionType: recordHeader.readUInt16BE(12),
      fileVersion: recordHeader.readUInt32BE(36),
    };
  } finally {
    await file.close();
  }
}

export async function openAzw3(filePath: string, mobitoolPath: string): Promise<OpenPublicationResult> {
  if (extname(filePath).toLowerCase() !== ".azw3") {
    throw new Error("AZW3 adapter only accepts .azw3 files.");
  }
  const header = await inspectAzw3Header(filePath);
  if (header.encryptionType !== 0) {
    throw new ProtectedPublicationError();
  }
  if (header.fileVersion < 8) {
    throw new Error("MOBI7 is not supported; a KF8/AZW3 publication is required.");
  }

  const converter = resolve(mobitoolPath);
  const converterStat = await fs.stat(converter);
  if (!converterStat.isFile()) {
    throw new Error("AZW3 converter is not installed.");
  }

  const source = resolve(filePath);
  const originalBookId = await sha256File(source);
  const conversionRoot = await fs.mkdtemp(join(tmpdir(), "ereader-azw3-"));
  try {
    try {
      await execFileAsync(converter, ["-e", "-o", conversionRoot, source], {
        windowsHide: true,
        timeout: CONVERSION_TIMEOUT_MS,
        maxBuffer: 1_000_000,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/encrypted|drm/i.test(detail)) {
        throw new ProtectedPublicationError();
      }
      throw new Error(`AZW3 normalization failed: ${detail}`);
    }

    const entries = await fs.readdir(conversionRoot, { withFileTypes: true });
    const epubs = entries.filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".epub");
    const normalizedEntry = epubs[0];
    if (epubs.length !== 1 || !normalizedEntry) {
      throw new Error(`AZW3 normalization produced ${epubs.length} EPUB files for ${basename(source)}.`);
    }
    const normalizedPath = join(conversionRoot, normalizedEntry.name);
    const opened = await openEpub(normalizedPath);
    opened.publication.bookId = originalBookId;
    opened.publication.sourcePath = source;
    return opened;
  } finally {
    await fs.rm(conversionRoot, { recursive: true, force: true });
  }
}
