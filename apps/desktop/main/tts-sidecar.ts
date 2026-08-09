import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { TtsHealth, TtsSynthesisResult } from "../../../packages/shared/src/types";

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface SidecarMessage extends Record<string, unknown> {
  type: string;
  requestId?: string;
}

export class TtsSidecar {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<string, PendingRequest>();
  private restartBudget = 1;
  private stopping = false;

  public constructor(
    private readonly repoRoot: string,
    private readonly cacheRoot: string,
    private readonly logger: (line: string) => void,
  ) {}

  private pythonPath(): string {
    const configured = process.env.EREADER_TTS_PYTHON;
    if (configured) {
      return configured;
    }
    return resolve(this.repoRoot, "tts/.venv/Scripts/python.exe");
  }

  public async start(): Promise<void> {
    if (this.stopping) {
      return;
    }
    if (this.child && !this.child.killed) {
      return;
    }
    const python = this.pythonPath();
    try {
      await fs.access(python);
    } catch {
      this.logger(`TTS runtime not installed at ${python}`);
      return;
    }

    const service = resolve(this.repoRoot, "tts/service/main.py");
    const modelRoot = resolve(this.repoRoot, "models/huggingface");
    await fs.mkdir(modelRoot, { recursive: true });
    this.child = spawn(python, ["-I", "-X", "utf8", "-u", service], {
      cwd: this.repoRoot,
      env: {
        ...process.env,
        EREADER_TTS_CACHE: this.cacheRoot,
        HF_HOME: process.env.HF_HOME ?? modelRoot,
        HF_HUB_OFFLINE: process.env.EREADER_ALLOW_MODEL_DOWNLOAD === "1" ? "0" : "1",
        TRANSFORMERS_OFFLINE: process.env.EREADER_ALLOW_MODEL_DOWNLOAD === "1" ? "0" : "1",
        PYTHONUTF8: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.onLine(line));
    this.child.stderr.on("data", (chunk) => this.logger(`[tts] ${String(chunk).trimEnd()}`));
    this.child.on("exit", (code, signal) => this.onExit(code, signal));
    await this.request("health", {}, 120_000);
  }

  private onLine(line: string): void {
    let message: SidecarMessage;
    try {
      message = JSON.parse(line) as SidecarMessage;
    } catch {
      this.logger(`[tts:invalid-json] ${line}`);
      return;
    }
    if (!message.requestId) {
      this.logger(`[tts:event] ${line}`);
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.type === "error") {
      pending.reject(new Error(String(message.message ?? "TTS request failed.")));
    } else {
      pending.resolve(message);
    }
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.logger(`[tts:exit] code=${code ?? "null"} signal=${signal ?? "null"}`);
    this.child = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("TTS sidecar exited."));
    }
    this.pending.clear();
    if (!this.stopping && this.restartBudget > 0) {
      this.restartBudget -= 1;
      void this.start().catch((error) => this.logger(`[tts:restart] ${String(error)}`));
    }
  }

  private request(type: string, payload: Record<string, unknown>, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    if (!this.child || this.child.killed) {
      return Promise.reject(new Error("朗读暂时不可用。"));
    }
    const requestId = randomUUID();
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        rejectRequest(new Error("TTS request timed out."));
      }, timeoutMs);
      this.pending.set(requestId, { resolve: resolveRequest, reject: rejectRequest, timer });
      this.child?.stdin.write(`${JSON.stringify({ type, requestId, ...payload })}\n`, "utf8");
    });
  }

  public async health(): Promise<TtsHealth> {
    try {
      await this.start();
      const response = await this.request("health", {}, 120_000);
      return {
        ready: Boolean(response.ready),
        detail: typeof response.detail === "string" ? response.detail : undefined,
      };
    } catch (error) {
      return { ready: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  public async synthesize(text: string, speed: number, context: Record<string, unknown>): Promise<TtsSynthesisResult> {
    await this.start();
    const response = await this.request("synthesize", { text, speed, context }, 180_000);
    const audioPath = String(response.audioPath ?? "");
    const absoluteCache = resolve(this.cacheRoot).toLowerCase();
    const absoluteAudio = resolve(audioPath).toLowerCase();
    if (!isAbsolute(audioPath) || !(absoluteAudio === absoluteCache || absoluteAudio.startsWith(`${absoluteCache}\\`))) {
      throw new Error("TTS sidecar returned an invalid audio path.");
    }
    const audio = await fs.readFile(audioPath);
    return {
      requestId: String(response.requestId),
      audioDataUrl: `data:audio/wav;base64,${audio.toString("base64")}`,
      durationMs: Number(response.durationMs ?? 0),
      cacheHit: Boolean(response.cacheHit),
    };
  }

  public shutdown(): void {
    this.stopping = true;
    this.restartBudget = 0;
    if (!this.child || this.child.killed) {
      return;
    }
    const child = this.child;
    child.stdin.write(`${JSON.stringify({ type: "shutdown", requestId: randomUUID() })}\n`, "utf8");
    setTimeout(() => {
      if (this.child === child && !child.killed) {
        child.kill();
      }
    }, 2_000).unref();
  }
}
