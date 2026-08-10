import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export class RotatingLogger {
  private readonly file: string;

  public constructor(private readonly root: string, private readonly maxBytes = 5 * 1024 * 1024, private readonly backups = 3) {
    mkdirSync(root, { recursive: true });
    this.file = join(root, "reader.log");
  }

  private rotate(incomingBytes: number): void {
    const current = existsSync(this.file) ? statSync(this.file).size : 0;
    if (current + incomingBytes <= this.maxBytes) return;
    const oldest = `${this.file}.${this.backups}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let index = this.backups - 1; index >= 1; index -= 1) {
      const source = `${this.file}.${index}`;
      if (existsSync(source)) renameSync(source, `${this.file}.${index + 1}`);
    }
    if (existsSync(this.file)) renameSync(this.file, `${this.file}.1`);
  }

  public write(line: string): void {
    const normalized = line.replace(/[\r\n]+/g, " ").slice(0, 16_384);
    const record = `${new Date().toISOString()} ${normalized}\n`;
    this.rotate(Buffer.byteLength(record));
    appendFileSync(this.file, record, "utf8");
  }
}
