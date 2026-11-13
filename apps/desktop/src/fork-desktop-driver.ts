import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";

export const DRIVER_BINARY = "cua-driver";
export const HELPER_BINARY = "bb-studio-desktop-helper";
export const DESKTOP_CONTROL_RESOURCES = "desktop-control";
export const DESKTOP_CONTROL_DIR_ENV = "BB_STUDIO_DESKTOP_CONTROL_DIR";

const PASSED_ENV = ["PATH", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG"];

export const DRIVER_FIXED_ENV: Readonly<Record<string, string>> = {
  CUA_DRIVER_EMBEDDED: "1",
  CUA_DRIVER_PERMISSION_MODE: "standard",
  DO_NOT_TRACK: "1",
  CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
  CUA_TELEMETRY_ENABLED: "0",
  CUA_TELEMETRY: "off",
  CUA_DRIVER_RS_UPDATE_CHECK: "0",
};

export function desktopDriverEnv(
  base: NodeJS.ProcessEnv,
  options: { stateDir: string; hostBundleId: string },
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (PASSED_ENV.includes(name) || name.startsWith("LC_")) env[name] = value;
  }
  const home = join(options.stateDir, "home");
  return {
    ...env,
    HOME: home,
    CUA_HOME: join(home, ".cua"),
    CUA_DRIVER_RS_HOME: join(home, ".cua-driver"),
    CUA_DRIVER_TELEMETRY_HOME: join(home, ".cua-driver"),
    CUA_DRIVER_HOST_BUNDLE_ID: options.hostBundleId,
    ...DRIVER_FIXED_ENV,
  };
}

export function driverServeArgs(socketPath: string): string[] {
  return ["serve", "--embedded", "--no-overlay", "--socket", socketPath];
}

export function driverMcpArgs(socketPath: string): string[] {
  return ["mcp", "--embedded", "--socket", socketPath];
}

export function desktopControlDir(input: {
  isPackaged: boolean;
  resourcesPath: string;
  env: NodeJS.ProcessEnv;
}): string | null {
  const override = input.env[DESKTOP_CONTROL_DIR_ENV]?.trim();
  if (override !== undefined && override.length > 0) return override;
  return input.isPackaged
    ? join(input.resourcesPath, DESKTOP_CONTROL_RESOURCES)
    : null;
}

export interface DriverCallResult {
  text: string;
  images: { data: string; mimeType: string }[];
  structured: unknown;
  isError: boolean;
}

export function readCallResult(result: unknown): DriverCallResult {
  const record =
    typeof result === "object" && result !== null
      ? (result as Record<string, unknown>)
      : {};
  const content = Array.isArray(record.content) ? record.content : [];
  const texts: string[] = [];
  const images: { data: string; mimeType: string }[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const item = part as Record<string, unknown>;
    if (item.type === "text" && typeof item.text === "string")
      texts.push(item.text);
    if (item.type === "image" && typeof item.data === "string") {
      images.push({
        data: item.data,
        mimeType:
          typeof item.mimeType === "string" ? item.mimeType : "image/png",
      });
    }
  }
  return {
    text: texts.join("\n"),
    images,
    structured: record.structuredContent ?? null,
    isError: record.isError === true,
  };
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function waitForSocket(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection(path);
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline)
          reject(new Error("the driver did not start in time"));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

export class DesktopDriver {
  private serve: ChildProcess | null = null;
  private mcp: ChildProcess | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private starting: Promise<void> | null = null;
  version: string | null = null;
  lastError: string | null = null;

  constructor(
    private readonly options: {
      binary: string;
      stateDir: string;
      socketPath: string;
      hostBundleId: string;
      env: NodeJS.ProcessEnv;
      log: (message: string) => void;
      onExit: () => void;
    },
  ) {}

  get running(): boolean {
    return this.mcp !== null && this.serve !== null;
  }

  start(): Promise<void> {
    if (this.running) return Promise.resolve();
    this.starting ??= this.launch().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async launch(): Promise<void> {
    const env = desktopDriverEnv(this.options.env, {
      stateDir: this.options.stateDir,
      hostBundleId: this.options.hostBundleId,
    });
    if (!existsSync(this.options.binary))
      throw new Error("the desktop driver is missing from this build");
    mkdirSync(env.HOME ?? this.options.stateDir, {
      recursive: true,
      mode: 0o700,
    });
    if (existsSync(this.options.socketPath))
      rmSync(this.options.socketPath, { force: true });
    const serve = spawn(
      this.options.binary,
      driverServeArgs(this.options.socketPath),
      {
        env: { ...env, CUA_DRIVER_PARENT_LIVENESS_STDIN: "1" },
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    this.serve = serve;
    let serveErr = "";
    serve.stderr?.on("data", (chunk: Buffer) => {
      serveErr = `${serveErr}${chunk.toString()}`.slice(-4000);
    });
    serve.once("error", (error) => {
      serveErr = `${serveErr}${String(error)}`;
    });
    serve.once("exit", (code) => {
      this.options.log(
        `desktop driver exited (${String(code)}): ${serveErr.trim().slice(-400)}`,
      );
      if (this.serve === serve) this.shutdown("the driver exited");
    });
    try {
      await waitForSocket(this.options.socketPath, 10_000);
    } catch (error) {
      this.shutdown(serveErr.trim().slice(-300) || String(error));
      throw new Error(this.lastError ?? String(error));
    }
    const mcp = spawn(
      this.options.binary,
      driverMcpArgs(this.options.socketPath),
      {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.mcp = mcp;
    mcp.stdout?.on("data", (chunk: Buffer) => this.read(chunk.toString()));
    mcp.stderr?.on("data", (chunk: Buffer) =>
      this.options.log(
        `desktop driver mcp: ${chunk.toString().trim().slice(0, 400)}`,
      ),
    );
    mcp.once("error", (error) =>
      this.options.log(`desktop driver mcp failed: ${String(error)}`),
    );
    mcp.once("exit", () => {
      if (this.mcp === mcp) this.shutdown("the driver connection closed");
    });
    const init = (await this.rpc(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "bb-studio", version: "1" },
      },
      15_000,
    )) as { serverInfo?: { version?: unknown } };
    this.version =
      typeof init?.serverInfo?.version === "string"
        ? init.serverInfo.version
        : null;
    this.notify("notifications/initialized");
    this.lastError = null;
  }

  async call(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 60_000,
  ): Promise<DriverCallResult> {
    await this.start();
    return readCallResult(
      await this.rpc("tools/call", { name, arguments: args }, timeoutMs),
    );
  }

  stop(): void {
    this.shutdown(null);
  }

  private shutdown(reason: string | null): void {
    const { serve, mcp } = this;
    this.serve = null;
    this.mcp = null;
    if (reason !== null) this.lastError = reason;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason ?? "the driver stopped"));
    }
    this.pending.clear();
    mcp?.kill();
    serve?.stdin?.end();
    serve?.kill();
    rmSync(this.options.socketPath, { force: true });
    if (reason !== null) this.options.onExit();
  }

  private notify(method: string): void {
    this.mcp?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  private rpc(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const mcp = this.mcp;
    if (mcp === null)
      return Promise.reject(new Error("the driver is not running"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the driver did not answer ${method} in time`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      mcp.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf("\n");
      if (line.length === 0) continue;
      let message: {
        id?: unknown;
        result?: unknown;
        error?: { message?: unknown };
      };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        continue;
      }
      if (typeof message.id !== "number") continue;
      const pending = this.pending.get(message.id);
      if (pending === undefined) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) {
        pending.reject(
          new Error(
            typeof message.error.message === "string"
              ? message.error.message
              : "driver error",
          ),
        );
      } else {
        pending.resolve(message.result);
      }
    }
  }
}
