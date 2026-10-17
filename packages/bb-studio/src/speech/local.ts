// Local voices: Studio installs mlx-audio with uv into its own data folder and
// runs its OpenAI-compatible server on 127.0.0.1, so speech needs no account
// and never leaves the Mac. Models download into the same folder on first use.
// The server runs while the local engine is chosen (or after it's first used),
// restarts with backoff when it crashes, and stops when the engine changes.
import { spawn as spawnChild } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { SpeechNotSetUpError, type LocalSpeechServer, type SpeechModel } from "./engines";

export const MLX_AUDIO_VERSION = "0.5.9";
/** What `uv pip install` puts in the venv; changing it makes Studio ask to install again. */
export const LOCAL_PACKAGES = [
  `mlx-audio[tts,server]==${MLX_AUDIO_VERSION}`,
  "misaki[en]==0.9.4",
  "mistral-common[audio]>=1.12,<2",
  "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
];
const PYTHON_VERSION = "3.12";

export interface LocalModel extends SpeechModel {
  voices: string[];
  /** The voice to use when none is set; empty for the model's own. */
  defaultVoice: string;
}

// Only models whose weights allow commercial use (see the README's Speech section).
export const LOCAL_MODELS: readonly LocalModel[] = [
  {
    id: "mlx-community/Kokoro-82M-bf16",
    name: "Kokoro · fast (0.4 GB)",
    defaultVoice: "af_heart",
    voices: ["af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "am_adam", "am_michael", "am_fenrir", "bf_emma", "bf_isabella", "bm_george", "bm_lewis"],
  },
  {
    id: "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
    name: "Qwen3-TTS 1.7B · more natural, follows delivery (3 GB)",
    defaultVoice: "ryan",
    voices: ["ryan", "aiden", "dylan", "eric", "serena", "vivian", "uncle_fu", "ono_anna", "sohee"],
  },
  {
    id: "mlx-community/chatterbox-turbo-fp16",
    name: "Chatterbox Turbo · clone a voice from a recording (3 GB)",
    defaultVoice: "",
    voices: [],
  },
];
export const DEFAULT_LOCAL_MODEL = LOCAL_MODELS[0]!;

export const isLocalModel = (model: string) => LOCAL_MODELS.some((each) => each.id === model);

/** Why local voices can't run on this machine, or null when they can. */
export function localSupport(platform: string = process.platform, arch: string = process.arch): string | null {
  if (platform === "darwin" && arch === "arm64") return null;
  return `Local voices need a Mac with Apple silicon (mlx-audio runs on MLX); this BB host is ${platform}/${arch}. Use OpenRouter or a custom endpoint instead.`;
}

export const UV_MISSING = "Local voices are installed with uv, which isn't on this Mac. Install it with `curl -LsSf https://astral.sh/uv/install.sh | sh` (or `brew install uv`), then try again.";

/** uv on PATH or where its installers put it; BB's PATH often lacks ~/.local/bin. */
export function findUv(env: Record<string, string | undefined> = process.env, home: string = homedir(), exists: (path: string) => boolean = existsSync): string | null {
  const onPath = (env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "uv"));
  const known = [join(home, ".local", "bin", "uv"), join(home, ".cargo", "bin", "uv"), "/opt/homebrew/bin/uv", "/usr/local/bin/uv"];
  return [...(env.UV_BIN ? [env.UV_BIN] : []), ...onPath, ...known].find((path) => exists(path)) ?? null;
}

export interface LocalPaths {
  root: string;
  venv: string;
  python: string;
  server: string;
  /** Hugging Face's cache, where models download. */
  hfHome: string;
  logs: string;
  /** Written after a whole install, with what was installed. */
  marker: string;
  pid: string;
}

export function localPaths(root: string): LocalPaths {
  const venv = join(root, "venv");
  return {
    root,
    venv,
    python: join(venv, "bin", "python"),
    server: join(venv, "bin", "mlx_audio.server"),
    hfHome: join(root, "hf"),
    logs: join(root, "logs"),
    marker: join(root, "installed.json"),
    pid: join(root, "server.pid"),
  };
}

export interface Command { command: string; args: string[]; env?: Record<string, string> }

export function installCommands(uv: string, paths: LocalPaths): Command[] {
  return [
    { command: uv, args: ["venv", "--clear", "--python", PYTHON_VERSION, paths.venv] },
    { command: uv, args: ["pip", "install", "--python", paths.python, ...LOCAL_PACKAGES] },
  ];
}

export function serverCommand(paths: LocalPaths, port: number): Command {
  return {
    command: paths.server,
    args: ["--host", "127.0.0.1", "--port", String(port), "--log-dir", paths.logs],
    env: { HF_HOME: paths.hfHome, HF_HUB_DISABLE_TELEMETRY: "1", PYTHONUNBUFFERED: "1" },
  };
}

/** A port nothing listens on now, from the OS. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("No free port."))));
    });
  });
}

/** Seconds to wait before restart number `attempt` (from 1): 1, 2, 4… up to a minute. */
export function restartDelay(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

export type LocalState = "unsupported" | "not-installed" | "installing" | "stopped" | "starting" | "ready" | "failed";

export interface LocalStatus {
  state: LocalState;
  installed: boolean;
  /** What's wrong or happening, in a sentence. */
  detail: string | null;
  /** The last lines of the install or the server's output. */
  log: string[];
  url: string | null;
}

export interface LocalProcess {
  pid?: number;
  exited: Promise<{ code: number | null; signal: string | null }>;
  kill(signal?: NodeJS.Signals): void;
}

export interface LocalDeps {
  root: string;
  platform?: string;
  arch?: string;
  env?: Record<string, string | undefined>;
  home?: string;
  exists?(path: string): boolean;
  /** Start a command, sending each line it prints to onLine. */
  spawn?(command: Command, onLine: (line: string) => void): LocalProcess;
  fetch?: typeof fetch;
  freePort?(): Promise<number>;
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
  /** Whether the local engine is the chosen one now; read every few seconds. */
  selected(): boolean;
  log?(message: string): void;
  /** How long a new server gets to answer before it counts as failed. */
  startTimeoutMs?: number;
}

const LOG_LINES = 200;
const STATUS_LINES = 15;

export class LocalVoice implements LocalSpeechServer {
  readonly paths: LocalPaths;
  private readonly lines: string[] = [];
  private installing: Promise<void> | null = null;
  private phase: "stopped" | "starting" | "ready" | "failed" = "stopped";
  private failure: string | null = null;
  private url: string | null = null;
  /** Running because someone asked (start, or speech), not only because the engine is chosen. */
  private requested = false;
  /** Stopped by hand: stays down until started or used again. */
  private held = false;
  private loadedModel: string | null = null;
  private wake: () => void = () => {};
  private readonly waiters = new Set<{ resolve(url: string): void; reject(error: Error): void }>();

  constructor(private readonly deps: LocalDeps) {
    this.paths = localPaths(deps.root);
  }

  private get fetch() { return this.deps.fetch ?? fetch; }
  private log(line: string): void {
    for (const each of line.split(/\r?\n|\r/)) {
      if (!each.trim()) continue;
      this.lines.push(each);
      if (this.lines.length > LOG_LINES) this.lines.shift();
    }
  }

  unsupported(): string | null {
    return localSupport(this.deps.platform, this.deps.arch);
  }

  installed(): boolean {
    const exists = this.deps.exists ?? existsSync;
    return exists(this.paths.server) && exists(this.paths.marker) && this.markerCurrent;
  }
  /** Set after reading the marker; a marker from older pins asks for a new install. */
  private markerCurrent = true;
  async checkMarker(): Promise<void> {
    const marker = await readFile(this.paths.marker, "utf8").then((text) => JSON.parse(text) as { packages?: string[] }, () => null);
    this.markerCurrent = marker === null || JSON.stringify(marker.packages) === JSON.stringify(LOCAL_PACKAGES);
  }

  status(): LocalStatus {
    const base = { installed: false, log: this.lines.slice(-STATUS_LINES), url: null };
    const unsupported = this.unsupported();
    if (unsupported) return { ...base, state: "unsupported", detail: unsupported, log: [] };
    if (this.installing) return { ...base, state: "installing", detail: "Installing mlx-audio…" };
    if (!this.installed()) {
      if (this.failure) return { ...base, state: "failed", detail: this.failure };
      return { ...base, state: "not-installed", detail: this.markerCurrent ? "Not installed yet." : "An update is ready; install again." };
    }
    const running = { ...base, installed: true, url: this.url };
    if (this.phase === "ready") return { ...running, state: "ready", detail: null };
    if (this.phase === "starting") return { ...running, state: "starting", detail: "Starting the local voice server…" };
    if (this.phase === "failed") return { ...running, state: "failed", detail: this.failure };
    return { ...running, state: "stopped", detail: this.wanted() ? "Starting soon." : "Stopped; starts when it speaks." };
  }

  problem(): string | null {
    const unsupported = this.unsupported();
    if (unsupported) return unsupported;
    if (this.installing) return "Local voices are still installing; see Studio → Setup → Speech.";
    if (!this.installed()) return "Install local voices first: Studio → Setup → Speech → Install, or `bb studio speech local install`.";
    return null;
  }

  models(): SpeechModel[] {
    return LOCAL_MODELS.map(({ defaultVoice: _, ...model }) => ({ ...model, voices: model.voices.length ? [...model.voices] : null }));
  }

  /** Voices the running server lists for a model; null when it isn't running or lists none. */
  async voices(model: string, signal?: AbortSignal): Promise<string[] | null> {
    if (this.phase !== "ready" || !this.url) return null;
    const response = await this.fetch(`${this.url}/audio/voices?model=${encodeURIComponent(model)}`, { signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    const voices = (body.data ?? []).map((voice) => voice.id).filter((id): id is string => typeof id === "string");
    return voices.length ? voices : null;
  }

  async useModel(model: string): Promise<void> {
    const previous = this.loadedModel;
    this.loadedModel = model;
    if (!previous || previous === model || !this.url) return;
    await this.fetch(`${this.url}/models?model_name=${encodeURIComponent(previous)}`, { method: "DELETE", signal: AbortSignal.timeout(10_000) })
      .catch((error) => this.deps.log?.(`Studio couldn't unload ${previous} from the local voice server: ${String(error)}`));
  }

  private wanted(): boolean {
    return !this.held && (this.requested || this.deps.selected());
  }

  /** Run the server now (and keep it running until stopped or the engine changes). */
  start(): void {
    this.held = false;
    this.requested = true;
    this.wake();
  }

  /** Stop the server until it's started or used again. */
  stop(): void {
    this.held = true;
    this.requested = false;
    this.wake();
  }

  /** The engine moved away from local: stop unless it's still chosen. */
  release(): void {
    this.requested = false;
    this.wake();
  }

  async ready(signal?: AbortSignal): Promise<string> {
    const problem = this.problem();
    if (problem) throw new SpeechNotSetUpError(problem);
    this.held = false;
    this.requested = true;
    if (this.phase === "ready" && this.url) return this.url;
    if (this.phase === "failed") this.attempt = 0;
    const waiting = new Promise<string>((resolve, reject) => {
      const waiter = { resolve, reject };
      this.waiters.add(waiter);
      signal?.addEventListener("abort", () => { this.waiters.delete(waiter); reject(signal.reason as Error); }, { once: true });
    });
    this.wake();
    return waiting;
  }

  private settle(error?: Error): void {
    for (const waiter of this.waiters) {
      if (error) waiter.reject(error);
      else waiter.resolve(this.url!);
    }
    this.waiters.clear();
  }

  /** Install (or reinstall) mlx-audio; resolves when done, throws with the reason it failed. */
  install(): Promise<void> {
    const unsupported = this.unsupported();
    if (unsupported) return Promise.reject(new Error(unsupported));
    if (this.installing) return this.installing;
    const uv = findUv(this.deps.env, this.deps.home, this.deps.exists);
    if (!uv) {
      this.failure = UV_MISSING;
      return Promise.reject(new Error(UV_MISSING));
    }
    this.failure = null;
    this.lines.length = 0;
    this.installing = (async () => {
      const wasRunning = this.phase !== "stopped";
      this.held = true;
      this.wake();
      // The old server runs from the venv being replaced; let it stop first.
      if (wasRunning) await this.until(() => this.phase === "stopped", 15_000);
      try {
        await mkdir(this.paths.root, { recursive: true });
        await rm(this.paths.marker, { force: true });
        for (const step of installCommands(uv, this.paths)) {
          this.log(`$ ${[step.command, ...step.args].join(" ")}`);
          const child = this.spawn(step, (line) => this.log(line));
          const { code, signal } = await child.exited;
          if (code !== 0) throw new Error(`${step.args.slice(0, 2).join(" ")} failed (${signal ?? `exit ${code}`}): ${this.lines.at(-1) ?? "no output"}`);
        }
        await writeFile(this.paths.marker, JSON.stringify({ packages: LOCAL_PACKAGES, at: new Date().toISOString() }, null, 2));
        this.markerCurrent = true;
        this.log("Installed. Models download on first use.");
      } catch (error) {
        this.failure = `Install failed: ${error instanceof Error ? error.message : String(error)}`;
        throw error;
      } finally {
        this.installing = null;
        this.held = false;
        this.wake();
      }
    })();
    return this.installing;
  }

  private until(check: () => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (check() || Date.now() - started > timeoutMs) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  }

  private spawn(command: Command, onLine: (line: string) => void): LocalProcess {
    return (this.deps.spawn ?? spawnProcess)(command, onLine);
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return (this.deps.sleep ?? sleepUnlessWoken)(ms, signal);
  }

  private attempt = 0;

  /** The background service: keep the server up while it's wanted. Resolves when `signal` aborts. */
  async run(signal: AbortSignal): Promise<void> {
    await this.checkMarker();
    await this.killStale();
    while (!signal.aborted) {
      const woken = new AbortController();
      this.wake = () => woken.abort();
      const stop = AbortSignal.any([signal, woken.signal]);
      if (!this.wanted() || this.installing || this.problem()) {
        // The engine can change in BB's settings without telling Studio, so look again every few seconds.
        await this.sleep(3000, stop);
        continue;
      }
      const ranFor = await this.serve(signal);
      if (signal.aborted || this.phase !== "failed") continue;
      this.attempt = ranFor > 60_000 ? 1 : this.attempt + 1;
      const delay = restartDelay(this.attempt);
      this.log(`Restarting in ${delay / 1000}s.`);
      // A new request (ready) resets the attempt and restarts now.
      const retry = new AbortController();
      this.wake = () => retry.abort();
      await this.sleep(delay, AbortSignal.any([signal, retry.signal]));
    }
    this.settle(new Error("Studio stopped."));
  }

  /** One run of the server, until it exits or isn't wanted; returns how long it was ready. */
  private async serve(signal: AbortSignal): Promise<number> {
    const port = await (this.deps.freePort ?? freePort)();
    const command = serverCommand(this.paths, port);
    const url = `http://127.0.0.1:${port}/v1`;
    this.phase = "starting";
    this.failure = null;
    this.loadedModel = null;
    this.log(`$ mlx_audio.server --port ${port}`);
    await mkdir(this.paths.logs, { recursive: true }).catch(() => {});
    const child = this.spawn(command, (line) => this.log(line));
    if (child.pid) await writeFile(this.paths.pid, String(child.pid)).catch(() => {});
    const ended: { exit: { code: number | null; signal: string | null } | null } = { exit: null };
    const exited = child.exited.then((result) => { ended.exit = result; });

    // Up once it answers its model list.
    const deadline = Date.now() + (this.deps.startTimeoutMs ?? 120_000);
    let up = false;
    while (!up && !ended.exit && !signal.aborted && this.wanted() && Date.now() < deadline) {
      up = await this.fetch(`${url}/models`, { signal: AbortSignal.timeout(2000) }).then((response) => response.ok, () => false);
      if (!up) await Promise.race([exited, this.sleep(300, signal)]);
    }
    let readyAt = 0;
    if (up && !ended.exit) {
      this.url = url;
      this.phase = "ready";
      readyAt = Date.now();
      this.log(`Ready at ${url}.`);
      this.settle();
      // Run until it exits, isn't wanted any more, or Studio stops.
      while (!ended.exit && !signal.aborted && this.wanted()) {
        const woken = new AbortController();
        this.wake = () => woken.abort();
        await Promise.race([exited, this.sleep(3000, AbortSignal.any([signal, woken.signal]))]);
      }
    }
    const ranFor = readyAt ? Date.now() - readyAt : 0;
    this.url = null;
    const exit = ended.exit;
    if (exit) {
      const { code, signal: killed } = exit;
      this.phase = "failed";
      this.failure = `The local voice server stopped (${killed ?? `exit ${code}`}): ${this.lines.at(-1) ?? "no output"}`;
    } else if (!up && !signal.aborted && this.wanted()) {
      this.phase = "failed";
      this.failure = "The local voice server didn't answer within two minutes.";
    } else {
      this.phase = "stopped";
    }
    if (!exit) {
      child.kill("SIGTERM");
      const killer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(killer);
      this.log("Stopped.");
    }
    await rm(this.paths.pid, { force: true }).catch(() => {});
    if (this.phase === "failed") {
      this.deps.log?.(this.failure!);
      this.settle(new Error(`${this.failure}\n${this.lines.slice(-STATUS_LINES).join("\n")}`));
    }
    return ranFor;
  }

  /** A server left by a BB that didn't shut down cleanly: stop it if it's ours. */
  private async killStale(): Promise<void> {
    if (this.deps.spawn) return;
    const pid = Number(await readFile(this.paths.pid, "utf8").catch(() => ""));
    if (!Number.isInteger(pid) || pid <= 0) return;
    const command = await new Promise<string>((resolve) => execFile("ps", ["-o", "command=", "-p", String(pid)], (error, stdout) => resolve(error ? "" : stdout)));
    if (command.includes(this.paths.server)) {
      try { process.kill(pid, "SIGTERM"); } catch { /* Already gone. */ }
    }
    await rm(this.paths.pid, { force: true });
  }
}

function sleepUnlessWoken(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function spawnProcess(command: Command, onLine: (line: string) => void): LocalProcess {
  const child = spawnChild(command.command, command.args, {
    env: { ...process.env, ...command.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on("line", onLine);
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once("error", (error) => { onLine(String(error)); resolve({ code: -1, signal: null }); });
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { pid: child.pid, exited, kill: (signal) => { child.kill(signal); } };
}
