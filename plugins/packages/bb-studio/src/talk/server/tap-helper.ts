// Starts the bb-talk-tap helper (packages/bb-studio/bin/bb-talk-tap, built
// from native/talk-tap) after checking it against its committed SHA-256.
// A helper that doesn't match is never run. See tap-protocol.ts for the lines
// it speaks.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { release } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { LineSplitter, STOP_COMMAND, appsOutputSchema, captureArgv, parseTapLine, permissionOutputSchema, type CaptureArgs, type FakeAudio, type TapEvent } from "./tap-protocol";

export const HELPER_NAME = "bb-talk-tap";

/** packages/bb-studio/bin, from dist/server.js or from src/talk/server in tests. */
export function defaultHelperPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", "bin", HELPER_NAME), join(here, "..", "..", "..", "bin", HELPER_NAME)];
  return candidates.find((path) => existsSync(path)) ?? candidates[0]!;
}

/** The hash file beside the helper: a hex SHA-256, optionally followed by the file name (shasum's format). */
export function parseHashFile(text: string): string | null {
  const hex = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/** Process taps need macOS 14.2 (Darwin 23.2) or later. */
export function platformSupport(platform: string = process.platform, kernel: string = release()): string | null {
  if (platform !== "darwin") return "Call capture needs a Mac.";
  const [major = 0, minor = 0] = kernel.split(".").map(Number);
  if (major < 23 || (major === 23 && minor < 2)) return "Call capture needs macOS 14.2 or later.";
  return null;
}

export class HelperError extends Error {
  constructor(message: string, readonly code: "missing" | "hash" | "exit" | "output") {
    super(message);
  }
}

export interface CaptureHandle {
  /** Asks the helper to stop; it closes its last pieces, says "stopped" and exits. Kills it after `graceMs`. */
  stop(graceMs?: number): Promise<void>;
  /** Kills it now. */
  kill(): void;
  /** Settles when the process exits. */
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export interface TapHelperOptions {
  path?: string;
  /** Replays these WAV files instead of tapping (`--fake`); no permission or prompt. */
  fake?: FakeAudio | null;
  log?: (message: string) => void;
}

export class TapHelper {
  readonly path: string;
  readonly fake: FakeAudio | null;
  private readonly log: (message: string) => void;

  constructor(options: TapHelperOptions = {}) {
    this.path = options.path ?? defaultHelperPath();
    this.fake = options.fake ?? null;
    this.log = options.log ?? (() => {});
  }

  /**
   * Refuses a missing helper or one whose bytes don't match its .sha256. Git
   * installs keep the executable bit; an install that drops it gets it back.
   */
  async verify(): Promise<void> {
    let info;
    try {
      info = await stat(this.path);
    } catch {
      throw new HelperError("The call capture helper isn't installed with this Studio.", "missing");
    }
    let expected: string | null = null;
    try {
      expected = parseHashFile(await readFile(`${this.path}.sha256`, "utf8"));
    } catch {
      // Handled below.
    }
    if (!expected) throw new HelperError("The call capture helper has no checksum, so Studio won't run it.", "hash");
    const actual = createHash("sha256").update(await readFile(this.path)).digest("hex");
    if (actual !== expected) {
      throw new HelperError("The call capture helper doesn't match its checksum, so Studio won't run it. Reinstall Studio.", "hash");
    }
    if ((info.mode & 0o111) === 0) await chmod(this.path, 0o755);
  }

  /** `apps`: what is playing audio now. Needs no permission. */
  async apps() {
    return (await this.runOnce(["apps"], appsOutputSchema)).apps;
  }

  /** `permission`: reads the audio-capture permission without prompting. */
  async permission() {
    return (await this.runOnce(["permission"], permissionOutputSchema)).audioCapture;
  }

  /** `capture`: events go to `onEvent` in order; stderr goes to the log. */
  async capture(args: CaptureArgs, onEvent: (event: TapEvent) => void): Promise<CaptureHandle> {
    await this.verify();
    const child = spawn(this.path, captureArgv(args, this.fake ?? undefined), { stdio: ["pipe", "pipe", "pipe"] });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("error", (error) => {
        this.log(`${HELPER_NAME} failed to start: ${error.message}`);
        resolve({ code: null, signal: null });
      });
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    this.pipeStderr(child);
    const lines = new LineSplitter();
    const deliver = (line: string) => {
      const event = parseTapLine(line);
      if (event) onEvent(event);
      else if (line.trim()) this.log(`${HELPER_NAME}: ignored output ${line.slice(0, 200)}`);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => lines.push(chunk).forEach(deliver));
    child.stdout.on("end", () => lines.flush().forEach(deliver));
    child.stdin.on("error", () => {
      // It exited before reading stop; `exited` reports it.
    });
    let killTimer: NodeJS.Timeout | null = null;
    void exited.then(() => {
      if (killTimer) clearTimeout(killTimer);
    });
    return {
      exited,
      kill: () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      },
      stop: async (graceMs = 10_000) => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        if (child.stdin.writable) child.stdin.write(STOP_COMMAND);
        killTimer ??= setTimeout(() => {
          this.log(`${HELPER_NAME} didn't stop within ${graceMs} ms; ending it.`);
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
        }, graceMs);
        await exited;
      },
    };
  }

  private async runOnce<T extends z.ZodTypeAny>(argv: string[], schema: T, timeoutMs = 10_000): Promise<z.infer<T>> {
    await this.verify();
    const child = spawn(this.path, argv, { stdio: ["ignore", "pipe", "pipe"] });
    this.pipeStderr(child);
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    }).finally(() => clearTimeout(timer));
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = schema.safeParse(JSON.parse(line));
        if (parsed.success) return parsed.data;
      } catch {
        // Not JSON; keep looking.
      }
    }
    throw new HelperError(`${HELPER_NAME} ${argv[0]} ${code === 0 ? "printed nothing Studio understands" : `exited with ${code}`}.`, code === 0 ? "output" : "exit");
  }

  private pipeStderr(child: Pick<ChildProcessWithoutNullStreams, "stderr"> | { stderr: NodeJS.ReadableStream | null }): void {
    const lines = new LineSplitter();
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      for (const line of lines.push(chunk)) if (line.trim()) this.log(`${HELPER_NAME}: ${line.slice(0, 500)}`);
    });
  }
}
