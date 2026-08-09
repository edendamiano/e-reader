import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingLocator } from "../../../packages/shared/src/types";
import { ReadingStateStore } from "./state-store";

const BOOK_ID = "a".repeat(64);
let root = "";

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "ereader-state-test-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("ReadingStateStore", () => {
  it("atomically saves and reloads a locator", async () => {
    const store = new ReadingStateStore(root);
    const locator: ReadingLocator = {
      bookId: BOOK_ID,
      href: "OEBPS/chapter.xhtml",
      locations: { progression: 0.42 },
      text: { highlight: "A stable sentence." },
    };

    await store.save(locator);

    await expect(store.load(BOOK_ID)).resolves.toEqual(locator);
    const updated = { ...locator, locations: { progression: 0.84 } };
    await store.save(updated);
    await expect(store.load(BOOK_ID)).resolves.toEqual(updated);
    await expect(fs.readdir(root)).resolves.toEqual([`${BOOK_ID}.json`]);
  });

  it("quarantines corrupt state and restores from the book beginning", async () => {
    const logger = vi.fn();
    const store = new ReadingStateStore(root, logger);
    await fs.writeFile(join(root, `${BOOK_ID}.json`), "{broken", "utf8");

    await expect(store.load(BOOK_ID)).resolves.toBeUndefined();
    const entries = await fs.readdir(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(new RegExp(`^${BOOK_ID}\\.json\\.corrupt-\\d+$`));
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("[state:corrupt]"));
  });
});
