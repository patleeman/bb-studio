// code-server, one process per open workspace. The plugin downloads a pinned
// code-server release into its data folder on first use, and runs each
// workspace on its own loopback port with a multi-root .code-workspace file.
// VS Code watches that file, so changing a workspace's folders while its
// server runs updates the open editor without a restart.
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import { IDLE_TIMEOUT_SECONDS, type ServerStatus, type Workspace } from "../shared";
import type { BbTheme } from "../theme";
import { applyTheme } from "./settings";

export const CODE_SERVER_VERSION = "4.140.0";
const READY_TIMEOUT_MS = 60_000;
const STOPPED: ServerStatus = { state: "stopped", url: null, error: null };

/** The release folder name for this machine, or null where code-server has no build. */
export function releaseAsset(platform: string, arch: string): string | null {
  const os = platform === "darwin" ? "macos" : platform === "linux" ? "linux" : null;
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "amd64" : null;
  return os && cpu ? `code-server-${CODE_SERVER_VERSION}-${os}-${cpu}` : null;
}

/** VS Code's multi-root workspace file for these folders. */
export function workspaceFile(folders: string[]): string {
  return `${JSON.stringify({ folders: folders.map((path) => ({ path })), settings: {} }, null, 2)}\n`;
}

/** The workspace file's name, which VS Code shows as the window title. */
export function workspaceFileName(title: string): string {
  const name = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${name || "Workspace"}.code-workspace`;
}

type Entry = { status: ServerStatus; child: ChildProcess | null; file: string | null; stopping: boolean };

export class CodeServers {
  private readonly entries = new Map<string, Entry>();
  private readonly starting = new Map<string, Promise<ServerStatus>>();
  private installing: Promise<string> | null = null;
  /** Leftovers from a BB that crashed, stopped before the first start. */
  private readonly swept: Promise<void>;

  constructor(private readonly options: {
    /** The plugin's own data folder. */
    root: string;
    log: { info(message: string): void; warn(message: string): void };
    /** A workspace's status changed. */
    onChange(id: string): void;
    /** BB's theme as last seen, for a workspace that starts. */
    theme?(): BbTheme | null;
  }) {
    this.swept = this.sweep();
  }

  status(id: string): ServerStatus {
    return this.entries.get(id)?.status ?? STOPPED;
  }

  /** Starts the workspace's server, or returns the running one. */
  open(workspace: Workspace): Promise<ServerStatus> {
    const running = this.entries.get(workspace.id);
    if (running?.status.state === "running") return Promise.resolve(running.status);
    const pending = this.starting.get(workspace.id);
    if (pending) return pending;
    const start = this.start(workspace).finally(() => this.starting.delete(workspace.id));
    this.starting.set(workspace.id, start);
    return start;
  }

  /** Writes new folders into a running server's workspace file. */
  async sync(workspace: Workspace): Promise<void> {
    const entry = this.entries.get(workspace.id);
    if (entry?.file && entry.child) await writeFile(entry.file, workspaceFile(workspace.folders));
  }

  stop(id: string): ServerStatus {
    const entry = this.entries.get(id);
    if (entry?.child) {
      entry.stopping = true;
      entry.child.kill("SIGTERM");
    }
    this.set(id, { status: STOPPED, child: null, file: null, stopping: false });
    return STOPPED;
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.stop(id);
  }

  private set(id: string, entry: Entry): void {
    this.entries.set(id, entry);
    this.options.onChange(id);
  }

  private async start(workspace: Workspace): Promise<ServerStatus> {
    const { id } = workspace;
    if (!workspace.folders.length) throw new Error("Add a folder to open this workspace.");
    try {
      await this.swept;
      const bin = await this.binary(id);
      this.set(id, { status: { state: "starting", url: null, error: null }, child: null, file: null, stopping: false });
      const dir = join(this.options.root, "workspaces", id);
      await mkdir(dir, { recursive: true });
      const file = join(dir, workspaceFileName(workspace.title));
      await writeFile(file, workspaceFile(workspace.folders));
      await seedSettings(join(dir, "user-data", "User"));
      const theme = this.options.theme?.();
      if (theme) await applyTheme(dir, theme).catch(() => false);
      const config = join(this.options.root, "config.yaml");
      await writeFile(config, "auth: none\n");
      const port = await freePort();
      // The watchdog holds a pipe from this process: when BB exits for any
      // reason, even SIGKILL, the pipe closes and it stops code-server.
      const watchdog = join(this.options.root, "watchdog.cjs");
      await writeFile(watchdog, WATCHDOG);
      const child = spawn(join(dirname(dirname(bin)), "lib", "node"), [watchdog, bin,
        "--bind-addr", `127.0.0.1:${port}`,
        "--auth", "none",
        "--config", config,
        "--disable-telemetry",
        "--disable-update-check",
        "--idle-timeout-seconds", String(IDLE_TIMEOUT_SECONDS),
        "--user-data-dir", join(dir, "user-data"),
        "--extensions-dir", join(this.options.root, "extensions"),
        file,
      ], {
        stdio: ["pipe", "pipe", "pipe"],
        // code-server keeps a heartbeat and state under XDG folders; keep
        // them in this workspace's folder, not the user's home.
        env: { ...process.env, XDG_DATA_HOME: join(dir, "xdg-data"), XDG_CONFIG_HOME: join(dir, "xdg-config") },
      });
      const output: string[] = [];
      const keep = (chunk: Buffer) => { output.push(chunk.toString()); if (output.length > 40) output.shift(); };
      child.stdout?.on("data", keep);
      child.stderr?.on("data", keep);
      const entry: Entry = { status: { state: "starting", url: null, error: null }, child, file, stopping: false };
      this.set(id, entry);
      child.on("exit", (code, signal) => {
        if (this.entries.get(id)?.child !== child) return;
        // Exit code 0 unasked is the idle timeout: nobody had the editor open.
        const error = entry.stopping || code === 0 ? null : `code-server exited (${signal ?? `code ${code}`}). ${tail(output)}`.trim();
        if (error) this.options.log.warn(`workspace ${id}: ${error}`);
        else if (!entry.stopping) this.options.log.info(`workspace ${id}: stopped after ${IDLE_TIMEOUT_SECONDS}s idle`);
        this.set(id, { status: error ? { state: "failed", url: null, error } : STOPPED, child: null, file: null, stopping: false });
      });
      const origin = `http://127.0.0.1:${port}`;
      await waitUntilReady(`${origin}/healthz`, child);
      const status: ServerStatus = { state: "running", url: `${origin}/?workspace=${encodeURIComponent(file)}`, error: null };
      this.set(id, { ...entry, status });
      this.options.log.info(`workspace ${id}: code-server on port ${port}`);
      return status;
    } catch (cause) {
      // code-server's own exit message says more than "stopped while starting".
      const current = this.entries.get(id)?.status;
      const error = current?.state === "failed" && current.error ? current.error : cause instanceof Error ? cause.message : String(cause);
      const child = this.entries.get(id)?.child;
      if (child) { child.removeAllListeners("exit"); child.kill("SIGTERM"); }
      const status: ServerStatus = { state: "failed", url: null, error };
      this.set(id, { status, child: null, file: null, stopping: false });
      return status;
    }
  }

  /** Stops code-servers a previous run left behind, found by their paths in this plugin's folder. */
  private async sweep(): Promise<void> {
    try {
      const { stdout } = await promisify(execFile)("ps", ["-axo", "pid=,command="], { maxBuffer: 16 * 1024 * 1024 });
      const pids = leftoverPids(stdout, this.options.root, process.pid);
      for (const pid of pids) {
        try { process.kill(pid, "SIGTERM"); } catch { /* Already gone. */ }
      }
      if (pids.length) this.options.log.info(`stopped ${pids.length} code-server process(es) left from an earlier run`);
    } catch (error) {
      this.options.log.warn(`couldn't look for leftover code-servers: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The code-server binary, downloading the release the first time. */
  private async binary(id: string): Promise<string> {
    const asset = releaseAsset(process.platform, process.arch);
    if (!asset) throw new Error(`code-server has no build for ${process.platform}-${process.arch}.`);
    const dir = join(this.options.root, "code-server", asset);
    const bin = join(dir, "bin", "code-server");
    if (existsSync(bin)) return bin;
    this.set(id, { status: { state: "installing", url: null, error: null }, child: null, file: null, stopping: false });
    this.installing ??= this.download(asset, dir).finally(() => { this.installing = null; });
    await this.installing;
    return bin;
  }

  private async download(asset: string, dir: string): Promise<string> {
    const url = `https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/${asset}.tar.gz`;
    const parent = join(this.options.root, "code-server");
    await mkdir(parent, { recursive: true });
    const staging = await mkdtemp(join(parent, ".download-"));
    try {
      this.options.log.info(`downloading ${url}`);
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error(`Couldn't download code-server (HTTP ${response.status}).`);
      const archive = join(staging, "code-server.tar.gz");
      await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), createWriteStream(archive));
      await promisify(execFile)("tar", ["-xzf", archive, "-C", staging]);
      await rename(join(staging, asset), dir);
      return dir;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

/**
 * A new workspace's VS Code settings: the user picked these folders, so no
 * Restricted Mode; no welcome page; BB is the agent, so VS Code's own AI chat
 * stays off; and light or dark follows the system like BB. Written once, so
 * the user's later changes stay.
 */
export const DEFAULT_SETTINGS = {
  "security.workspace.trust.enabled": false,
  "workbench.startupEditor": "none",
  "chat.disableAIFeatures": true,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  // Until the app sends BB's palette, follow the system like BB's default.
  "window.autoDetectColorScheme": true,
  "workbench.preferredLightColorTheme": "Light Modern",
  "workbench.preferredDarkColorTheme": "Dark Modern",
};

async function seedSettings(dir: string): Promise<void> {
  const file = join(dir, "settings.json");
  if (existsSync(file)) return;
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`);
}

/**
 * Processes in `ps -axo pid=,command=` output that are this plugin's
 * watchdogs or run code-server from its install folder. Nothing else: BB's
 * own plugin host may name the plugin's folder too.
 */
export function leftoverPids(ps: string, root: string, self: number): number[] {
  const base = root.replace(/\/+$/, "");
  const markers = [`${base}/code-server/`, `${base}/watchdog.cjs`];
  return ps.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match || !markers.some((marker) => match[2]!.includes(marker))) return [];
    const pid = Number(match[1]);
    return pid === self ? [] : [pid];
  });
}

/** Runs code-server (argv[2]…) and stops it when stdin closes, which is when BB exits. */
const WATCHDOG = `const { spawn } = require("node:child_process");
const [bin, ...args] = process.argv.slice(2);
const child = spawn(bin, args, { stdio: ["ignore", "inherit", "inherit"] });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
  setTimeout(() => { child.kill("SIGKILL"); process.exit(0); }, 5000).unref();
};
process.stdin.on("end", stop);
process.stdin.on("close", stop);
process.stdin.on("error", stop);
process.stdin.resume();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
`;

function tail(lines: string[]): string {
  return lines.join("").trim().split("\n").slice(-5).join("\n");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("No free port."))));
    });
  });
}

async function waitUntilReady(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("code-server stopped while starting.");
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("code-server didn't start within a minute.");
}
