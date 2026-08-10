import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RotatingLogger } from "./rotating-logger";

let root = "";
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

describe("RotatingLogger", () => {
  it("rotates at a fixed bound and strips multiline technical output", async () => {
    root = await fs.mkdtemp(join(tmpdir(), "ereader-logs-"));
    const logger = new RotatingLogger(root, 120, 2);
    for (let index = 0; index < 12; index += 1) logger.write(`event-${index}\ntrace`);
    const files = await fs.readdir(root);
    expect(files.sort()).toEqual(["reader.log", "reader.log.1", "reader.log.2"]);
    expect(await fs.readFile(join(root, "reader.log"), "utf8")).not.toContain("\ntrace");
  });
});
