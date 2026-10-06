// code-server, one process per open workspace. The plugin downloads a pinned
// code-server release into its data folder on first use (checked against its
// SHA-256 before unpacking), and runs each workspace on its own loopback port
// with a multi-root .code-workspace file and its own password. VS Code
// watches that file, so changing a workspace's folders while its server runs
// updates the open editor without a restart.
import { spawn as spawnProcess, execFile, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import { IDLE_TIMEOUT_SECONDS, type ServerStatus, type Workspace } from "../shared";
import type { BbTheme } from "../theme";
import { applyLayout, applyTheme } from "./settings";

export const CODE_SERVER_VERSION = "4.140.0";
const READY_TIMEOUT_MS = 60_000;
const STOPPED: ServerStatus = { state: "stopped", url: null, password: null, error: null };
const pending = (state: "installing" | "starting"): ServerStatus => ({ state, url: null, password: null, error: null });

/** GitHub's SHA-256 for each release archive; a download must match before it's unpacked. */
export const RELEASE_SHA256: Record<string, string> = {
  [`code-server-${CODE_SERVER_VERSION}-macos-arm64`]: "82c7144406ac31c373acfa786b6705c7c5463d895f728fde2cb94402b945b301",
  [`code-server-${CODE_SERVER_VERSION}-macos-amd64`]: "a5393b6eed4aa68b084e724c3c565f805abd996c609356043119f0323e40cf52",
  [`code-server-${CODE_SERVER_VERSION}-linux-arm64`]: "ae4b07153f2037b06d24749bc8004221fcbf3ffe317038401be0452f541bf200",
  [`code-server-${CODE_SERVER_VERSION}-linux-amd64`]: "864c5d01c808ade57e4d12c708717be7a187219fded60428f263b9e2da9f6b48",
};
/** Written into an install once its archive matched, so a partial or older install is replaced. */
const INSTALL_MARKER = ".studio-code-sha256";

export async function verifySha256(file: string, expected: string): Promise<void> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  const actual = hash.digest("hex");
  if (actual !== expected) throw new Error(`The code-server download failed its checksum (got ${actual}), so it wasn't installed.`);
}

/**
 * code-server's arguments. It binds a port the OS picks (read back from its
 * log, so nothing else can take it first), asks for the password in
 * `config`, and keeps its cookie apart from other workspaces': cookies
 * ignore ports, so on 127.0.0.1 they would overwrite each other. Workspace
 * trust is skipped only for folders the user chose.
 */
export function codeServerArgs(options: { config: string; userData: string; extensions: string; cookieSuffix: string; trusted: boolean; file: string }): string[] {
  return [
    "--bind-addr", "127.0.0.1:0",
    "--config", options.config,
    "--cookie-suffix", options.cookieSuffix,
    "--disable-telemetry",
    "--disable-update-check",
    "--idle-timeout-seconds", String(IDLE_TIMEOUT_SECONDS),
    "--user-data-dir", options.userData,
    "--extensions-dir", options.extensions,
    ...(options.trusted ? ["--disable-workspace-trust"] : []),
    options.file,
  ];
}

/** The server's config: password auth, so only BB's panel (which knows it) gets in. */
export function serverConfig(password: string): string {
  return `auth: password\npassword: ${password}\n`;
}

/** The port in code-server's "HTTP server listening on http://127.0.0.1:<port>/" line. */
export function listeningPort(text: string): number | null {
  const match = /HTTP server listening on https?:\/\/127\.0\.0\.1:(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

/** Thrown inside a start that Stop, archive or delete cancelled. */
class Cancelled extends Error {}

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
type Spawn = (command: string, args: string[], options: Parameters<typeof spawnProcess>[2]) => ChildProcess;

export class CodeServers {
  private readonly entries = new Map<string, Entry>();
  private readonly starting = new Map<string, Promise<ServerStatus>>();
  private installing: Promise<string> | null = null;
  /** Each Stop bumps a workspace's generation; a start of an older one gives up. */
  private readonly generations = new Map<string, number>();
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
    /** Tests: the installed binary, and the process launcher. */
    install?(): Promise<string>;
    spawn?: Spawn;
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
    // A start still downloading or booting sees this and gives up.
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
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
    const generation = this.generations.get(id) ?? 0;
    /** Throws once Stop, archive or delete has cancelled this start. */
    const check = () => { if ((this.generations.get(id) ?? 0) !== generation) throw new Cancelled(); };
    let child: ChildProcess | null = null;
    try {
      await this.swept;
      check();
      const bin = await this.binary(id, check);
      check();
      this.set(id, { status: pending("starting"), child: null, file: null, stopping: false });
      const dir = join(this.options.root, "workspaces", id);
      await mkdir(dir, { recursive: true });
      const file = join(dir, workspaceFileName(workspace.title));
      await writeFile(file, workspaceFile(workspace.folders));
      await seedSettings(join(dir, "user-data", "User"));
      await applyLayout(dir).catch(() => false);
      const theme = this.options.theme?.();
      if (theme) await applyTheme(dir, theme).catch(() => false);
      // A new password each start, in a file only this user can read.
      const password = randomBytes(24).toString("base64url");
      const config = join(dir, "code-server.yaml");
      await writeFile(config, serverConfig(password), { mode: 0o600 });
      await chmod(config, 0o600);
      // The watchdog holds a pipe from this process: when BB exits for any
      // reason, even SIGKILL, the pipe closes and it stops code-server.
      const watchdog = join(this.options.root, "watchdog.cjs");
      await writeFile(watchdog, WATCHDOG);
      check();
      const launch = this.options.spawn ?? (spawnProcess as Spawn);
      child = launch(join(dirname(dirname(bin)), "lib", "node"), [watchdog, bin, ...codeServerArgs({
        config,
        userData: join(dir, "user-data"),
        extensions: join(this.options.root, "extensions"),
        cookieSuffix: id,
        trusted: workspace.trusted,
        file,
      })], {
        stdio: ["pipe", "pipe", "pipe"],
        // code-server keeps a heartbeat and state under XDG folders; keep
        // them in this workspace's folder, not the user's home.
        env: { ...process.env, XDG_DATA_HOME: join(dir, "xdg-data"), XDG_CONFIG_HOME: join(dir, "xdg-config") },
      });
      const started = child;
      const output: string[] = [];
      const keep = (chunk: Buffer) => { output.push(chunk.toString()); if (output.length > 40) output.shift(); };
      started.stdout?.on("data", keep);
      started.stderr?.on("data", keep);
      const entry: Entry = { status: pending("starting"), child: started, file, stopping: false };
      this.set(id, entry);
      started.on("exit", (code, signal) => {
        if (this.entries.get(id)?.child !== started) return;
        // Exit code 0 unasked is the idle timeout: nobody had the editor open.
        const error = entry.stopping || code === 0 ? null : `code-server exited (${signal ?? `code ${code}`}). ${tail(output)}`.trim();
        if (error) this.options.log.warn(`workspace ${id}: ${error}`);
        else if (!entry.stopping) this.options.log.info(`workspace ${id}: stopped after ${IDLE_TIMEOUT_SECONDS}s idle`);
        this.set(id, { status: error ? { state: "failed", url: null, password: null, error } : STOPPED, child: null, file: null, stopping: false });
      });
      const port = await waitUntilReady(started, () => listeningPort(output.join("")), check);
      const origin = `http://127.0.0.1:${port}`;
      const status: ServerStatus = { state: "running", url: `${origin}/?workspace=${encodeURIComponent(file)}`, password, error: null };
      this.set(id, { ...entry, status });
      this.options.log.info(`workspace ${id}: code-server on port ${port}`);
      return status;
    } catch (cause) {
      if (child) { child.removeAllListeners("exit"); child.kill("SIGTERM"); }
      // Stop already said "stopped"; a cancelled start leaves it that way.
      if (cause instanceof Cancelled) return this.status(id);
      // code-server's own exit message says more than "stopped while starting".
      const current = this.entries.get(id)?.status;
      const error = current?.state === "failed" && current.error ? current.error : cause instanceof Error ? cause.message : String(cause);
      const status: ServerStatus = { state: "failed", url: null, password: null, error };
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

  /** The code-server binary, downloading and checking the release the first time. */
  private async binary(id: string, check: () => void): Promise<string> {
    if (this.options.install) return this.options.install();
    const asset = releaseAsset(process.platform, process.arch);
    if (!asset) throw new Error(`code-server has no build for ${process.platform}-${process.arch}.`);
    const expected = RELEASE_SHA256[asset];
    if (!expected) throw new Error(`No checksum is pinned for ${asset}.`);
    const dir = join(this.options.root, "code-server", asset);
    const bin = join(dir, "bin", "code-server");
    const marker = (await readFile(join(dir, INSTALL_MARKER), "utf8").catch(() => "")).trim();
    if (existsSync(bin) && marker === expected) return bin;
    check();
    this.set(id, { status: pending("installing"), child: null, file: null, stopping: false });
    this.installing ??= this.download(asset, dir, expected).finally(() => { this.installing = null; });
    await this.installing;
    return bin;
  }

  private async download(asset: string, dir: string, expected: string): Promise<string> {
    const url = `https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/${asset}.tar.gz`;
    const parent = join(this.options.root, "code-server");
    await mkdir(parent, { recursive: true });
    // Downloads a crash interrupted, and an install from before checksums.
    for (const name of await readdir(parent)) if (name.startsWith(".download-")) await rm(join(parent, name), { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
    const staging = await mkdtemp(join(parent, ".download-"));
    try {
      this.options.log.info(`downloading ${url}`);
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error(`Couldn't download code-server (HTTP ${response.status}).`);
      const archive = join(staging, "code-server.tar.gz");
      await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), createWriteStream(archive));
      await verifySha256(archive, expected);
      await promisify(execFile)("tar", ["-xzf", archive, "-C", staging]);
      await writeFile(join(staging, asset, INSTALL_MARKER), `${expected}\n`);
      await rename(join(staging, asset), dir);
      return dir;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

/**
 * A new workspace's VS Code settings: no welcome page; BB is the agent, so
 * VS Code's own AI chat stays off; and light or dark follows the system until
 * BB's theme arrives. Workspace trust stays on: the server skips it only for
 * folders the user chose. Written once, so the user's later changes stay.
 */
export const DEFAULT_SETTINGS = {
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

/**
 * Runs code-server (argv[2]…) in its own process group and stops the whole
 * group, extension hosts and terminals' pty host included, on Stop or when
 * stdin closes, which is when BB exits.
 */
export const WATCHDOG = `const { spawn } = require("node:child_process");
const [bin, ...args] = process.argv.slice(2);
const child = spawn(bin, args, { stdio: ["ignore", "inherit", "inherit"], detached: true });
const signal = (name) => { try { process.kill(-child.pid, name); } catch {} };
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  signal("SIGTERM");
  setTimeout(() => { signal("SIGKILL"); process.exit(0); }, 5000).unref();
};
process.stdin.on("end", stop);
process.stdin.on("close", stop);
process.stdin.on("error", stop);
process.stdin.resume();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code, how) => {
  // Anything code-server left in its group goes with it.
  signal("SIGTERM");
  process.exit(code ?? (how ? 1 : 0));
});
`;

function tail(lines: string[]): string {
  return lines.join("").trim().split("\n").slice(-5).join("\n");
}

/** Waits for code-server to log its port and answer health checks; returns the port. */
async function waitUntilReady(child: ChildProcess, port: () => number | null, check: () => void): Promise<number> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    check();
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("code-server stopped while starting.");
    const bound = port();
    if (bound) {
      try {
        if ((await fetch(`http://127.0.0.1:${bound}/healthz`)).ok) return bound;
      } catch {
        // Not answering yet.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("code-server didn't start within a minute.");
}
