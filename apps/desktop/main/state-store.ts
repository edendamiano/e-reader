import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { ReadingLocator } from "../../../packages/shared/src/types";

const BOOK_ID_PATTERN = /^[a-f0-9]{64}$/i;

export class ReadingStateStore {
  public constructor(
    private readonly root: string,
    private readonly logger: (line: string) => void = () => undefined,
  ) {}

  private pathFor(bookId: string): string {
    if (!BOOK_ID_PATTERN.test(bookId)) {
      throw new Error("Invalid book id.");
    }
    return join(this.root, `${bookId}.json`);
  }

  public async load(bookId: string): Promise<ReadingLocator | undefined> {
    const target = this.pathFor(bookId);
    try {
      const raw = await fs.readFile(target, "utf8");
      const candidate = JSON.parse(raw) as Partial<ReadingLocator>;
      if (
        candidate.bookId !== bookId
        || typeof candidate.href !== "string"
        || !candidate.locations
        || typeof candidate.locations !== "object"
      ) {
        throw new SyntaxError("Invalid reading locator shape.");
      }
      return candidate as ReadingLocator;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      if (error instanceof SyntaxError) {
        const quarantine = `${target}.corrupt-${Date.now()}`;
        try {
          await fs.rename(target, quarantine);
          this.logger(`[state:corrupt] bookId=${bookId} quarantined=${quarantine} error=${error.message}`);
        } catch (quarantineError) {
          this.logger(`[state:corrupt] bookId=${bookId} quarantine-failed=${String(quarantineError)} error=${error.message}`);
        }
        return undefined;
      }
      throw error;
    }
  }

  public async save(locator: ReadingLocator): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    const target = this.pathFor(locator.bookId);
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temp, "wx");
      try {
        await handle.writeFile(`${JSON.stringify(locator)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temp, target);
    } catch (error) {
      await fs.unlink(temp).catch(() => undefined);
      throw error;
    }
  }
}
