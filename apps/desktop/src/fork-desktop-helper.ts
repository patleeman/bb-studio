import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

export type HelperEvent =
  | { event: "key"; key: string; down: boolean }
  | { event: "keyOther" };

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function readHelperEvent(
  message: Record<string, unknown>,
): HelperEvent | null {
  if (
    message.event === "key" &&
    typeof message.key === "string" &&
    typeof message.down === "boolean"
  ) {
    return { event: "key", key: message.key, down: message.down };
  }
  if (message.event === "keyOther") return { event: "keyOther" };
  return null;
}

export class DesktopHelper {
  private child: ChildProcess | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly options: {
      binary: string;
      log: (message: string) => void;
      onEvent: (event: HelperEvent) => void;
    },
  ) {}

  private ensure(): ChildProcess {
    if (this.child !== null) return this.child;
    if (!existsSync(this.options.binary))
      throw new Error("the desktop helper is missing from this build");
    const child = spawn(this.options.binary, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => this.read(chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) =>
      this.options.log(
        `desktop helper: ${chunk.toString().trim().slice(0, 300)}`,
      ),
    );
    child.once("exit", () => {
      if (this.child === child) this.child = null;
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("the desktop helper exited"));
      }
      this.pending.clear();
    });
    child.once("error", (error) =>
      this.options.log(`desktop helper failed: ${String(error)}`),
    );
    return child;
  }

  request(
    op: string,
    fields: Record<string, unknown> = {},
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>> {
    let child: ChildProcess;
    try {
      child = this.ensure();
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the desktop helper did not answer ${op}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin?.write(`${JSON.stringify({ id, op, ...fields })}\n`);
    });
  }

  stop(): void {
    this.child?.stdin?.end();
    this.child?.kill();
    this.child = null;
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf("\n");
      if (line.length === 0) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (pending === undefined) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok === true) {
          pending.resolve(
            typeof message.result === "object" && message.result !== null
              ? (message.result as Record<string, unknown>)
              : {},
          );
        } else {
          pending.reject(
            new Error(
              typeof message.error === "string"
                ? message.error
                : "helper error",
            ),
          );
        }
        continue;
      }
      const event = readHelperEvent(message);
      if (event !== null) this.options.onEvent(event);
    }
  }
}
