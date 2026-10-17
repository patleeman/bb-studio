import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { localEngine, type LocalSpeechServer } from "./engines";
import {
  DEFAULT_LOCAL_MODEL, findUv, freePort, installCommands, LOCAL_MODELS, LOCAL_PACKAGES, localPaths, localSupport,
  LocalVoice, restartDelay, serverCommand, UV_MISSING, type Command, type LocalProcess,
} from "./local";
import { modelForEngine } from "./settings";

const until = async (check: () => boolean, ms = 3000) => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error("Timed out waiting.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/** Processes that exit when killed or when the test says, and a server that answers once spawned. */
function fakeHost(options: { installExit?: number } = {}) {
  const spawned: { command: Command; exit(code: number | null, signal?: string | null): void; killed: string[] }[] = [];
  const requests: { url: string; method: string }[] = [];
  let serverUp = false;
  const spawn = (command: Command, onLine: (line: string) => void): LocalProcess => {
    let exit!: (result: { code: number | null; signal: string | null }) => void;
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => { exit = resolve; });
    const entry = { command, killed: [] as string[], exit: (code: number | null, signal: string | null = null) => { serverUp = false; exit({ code, signal }); } };
    spawned.push(entry);
    if (command.command.endsWith("mlx_audio.server")) {
      onLine("INFO: Uvicorn running");
      serverUp = true;
    } else {
      onLine(`ran ${command.args[0]}`);
      queueMicrotask(() => entry.exit(options.installExit ?? 0));
    }
    return { pid: undefined, exited, kill: (signal = "SIGTERM") => { entry.killed.push(signal); entry.exit(null, signal); } };
  };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? "GET" });
    if (!serverUp) throw new Error("ECONNREFUSED");
    if (url.includes("/audio/voices")) return Response.json({ data: [{ id: "af_heart" }, { id: "bm_george" }] });
    return Response.json({ data: [] });
  }) as typeof fetch;
  return { spawned, requests, spawn, fetchImpl };
}

describe("local voices", () => {
  const roots: string[] = [];
  const aborts: AbortController[] = [];
  afterEach(async () => {
    for (const abort of aborts.splice(0)) abort.abort();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  async function voice(options: { selected?: () => boolean; installExit?: number; installed?: boolean; uv?: boolean } = {}) {
    const root = await mkdtemp(join(tmpdir(), "studio-local-voice-"));
    roots.push(root);
    const host = fakeHost(options);
    const paths = localPaths(root);
    let serverInstalled = options.installed ?? false;
    const local = new LocalVoice({
      root,
      platform: "darwin",
      arch: "arm64",
      env: { PATH: "/nowhere" },
      home: "/Users/test",
      exists: (path) => path === "/Users/test/.local/bin/uv" ? options.uv !== false
        : path === paths.server ? serverInstalled
        : path === paths.marker ? serverInstalled : false,
      spawn: (command, onLine) => {
        if (command.args[0] === "pip" && (options.installExit ?? 0) === 0) serverInstalled = true;
        return host.spawn(command, onLine);
      },
      fetch: host.fetchImpl,
      freePort: async () => 40123,
      sleep: (ms, signal) => new Promise((resolve) => {
        const timer = setTimeout(resolve, Math.min(ms, 20));
        signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
      }),
      selected: options.selected ?? (() => true),
    });
    const abort = new AbortController();
    aborts.push(abort);
    const running = local.run(abort.signal);
    return { local, host, abort, running, paths };
  }

  it("runs only on Apple silicon Macs", () => {
    expect(localSupport("darwin", "arm64")).toBeNull();
    expect(localSupport("darwin", "x64")).toMatch(/Apple silicon.*darwin\/x64/);
    expect(localSupport("linux", "arm64")).toMatch(/linux\/arm64/);
    const local = new LocalVoice({ root: "/tmp/x", platform: "linux", arch: "x64", selected: () => true });
    expect(local.status()).toMatchObject({ state: "unsupported", installed: false });
    expect(local.problem()).toMatch(/Apple silicon/);
  });

  it("finds uv on PATH first, then where its installers put it", () => {
    const has = (...paths: string[]) => (path: string) => paths.includes(path);
    expect(findUv({ PATH: "/a:/b" }, "/Users/me", has("/b/uv", "/Users/me/.local/bin/uv"))).toBe("/b/uv");
    expect(findUv({ PATH: "/a" }, "/Users/me", has("/Users/me/.local/bin/uv", "/opt/homebrew/bin/uv"))).toBe("/Users/me/.local/bin/uv");
    expect(findUv({ PATH: "" }, "/Users/me", has("/opt/homebrew/bin/uv"))).toBe("/opt/homebrew/bin/uv");
    expect(findUv({ PATH: "/a" }, "/Users/me", has())).toBeNull();
  });

  it("installs pinned packages into its own venv and serves on loopback with models in its own folder", () => {
    const paths = localPaths("/data/speech-local");
    const [venv, pip] = installCommands("/bin/uv", paths);
    expect(venv!.args).toEqual(["venv", "--clear", "--python", "3.12", "/data/speech-local/venv"]);
    expect(pip!.args.slice(0, 4)).toEqual(["pip", "install", "--python", "/data/speech-local/venv/bin/python"]);
    expect(pip!.args.slice(4)).toEqual(LOCAL_PACKAGES);
    expect(LOCAL_PACKAGES[0]).toBe("mlx-audio[tts,server]==0.5.9");
    const server = serverCommand(paths, 40123);
    expect(server.command).toBe("/data/speech-local/venv/bin/mlx_audio.server");
    expect(server.args).toEqual(["--host", "127.0.0.1", "--port", "40123", "--log-dir", "/data/speech-local/logs"]);
    expect(server.env?.HF_HOME).toBe("/data/speech-local/hf");
  });

  it("backs off restarts up to a minute", () => {
    expect([1, 2, 3, 4, 7, 20].map(restartDelay)).toEqual([1000, 2000, 4000, 8000, 60_000, 60_000]);
  });

  it("gets a port nothing listens on", async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(0);
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    await new Promise((resolve) => server.close(resolve));
  });

  it("offers Kokoro, Qwen3-TTS and Chatterbox, Kokoro and af_heart first", () => {
    expect(LOCAL_MODELS.map((model) => model.id)).toEqual([
      "mlx-community/Kokoro-82M-bf16",
      "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
      "mlx-community/chatterbox-turbo-fp16",
    ]);
    expect(DEFAULT_LOCAL_MODEL.defaultVoice).toBe("af_heart");
    expect(modelForEngine("local", "fish-audio/drama-3")).toEqual({ model: DEFAULT_LOCAL_MODEL.id, voice: "af_heart" });
    expect(modelForEngine("local", LOCAL_MODELS[1]!.id)).toBeNull();
    expect(modelForEngine("openrouter", DEFAULT_LOCAL_MODEL.id)).toEqual({ model: "fish-audio/drama-3", voice: "" });
    expect(modelForEngine("custom", DEFAULT_LOCAL_MODEL.id)).toBeNull();
  });

  it("says how to get uv when it's missing", async () => {
    const { local } = await voice({ uv: false });
    await expect(local.install()).rejects.toThrow(UV_MISSING);
    expect(local.status()).toMatchObject({ state: "failed", installed: false, detail: UV_MISSING });
  });

  it("installs, starts while chosen, and becomes ready", async () => {
    const { local, host } = await voice();
    expect(local.status().state).toBe("not-installed");
    expect(local.problem()).toMatch(/Install local voices first/);
    const installing = local.install();
    expect(local.status().state).toBe("installing");
    await installing;
    expect(host.spawned.map((each) => each.command.args[0])).toEqual(["venv", "pip"]);
    expect(local.status().log).toContain("ran pip");
    await expect(local.ready()).resolves.toBe("http://127.0.0.1:40123/v1");
    expect(local.status()).toMatchObject({ state: "ready", installed: true, url: "http://127.0.0.1:40123/v1" });
  });

  it("reports a failed install with its output", async () => {
    const { local } = await voice({ installExit: 1 });
    await expect(local.install()).rejects.toThrow(/venv --clear failed \(exit 1\)/);
    expect(local.status()).toMatchObject({ state: "failed", installed: false });
    expect(local.status().detail).toMatch(/^Install failed/);
  });

  it("restarts a crashed server with backoff, failing waiting speech with the log tail", async () => {
    const { local, host } = await voice({ installed: true });
    await local.ready();
    host.spawned[0]!.exit(1);
    await until(() => local.status().state === "failed");
    expect(local.status().detail).toMatch(/stopped \(exit 1\)/);
    await until(() => local.status().state === "ready");
    expect(host.spawned).toHaveLength(2);
  });

  it("stops when the engine changes or by hand, and starts again on use", async () => {
    let chosen = true;
    const { local, host } = await voice({ installed: true, selected: () => chosen });
    await local.ready();
    local.stop();
    await until(() => local.status().state === "stopped");
    expect(host.spawned[0]!.killed).toEqual(["SIGTERM"]);
    await local.ready();
    expect(host.spawned).toHaveLength(2);
    chosen = false;
    local.release();
    await until(() => local.status().state === "stopped");
    expect(local.status().detail).toMatch(/starts when it speaks/);
  });

  it("waits while not chosen, then starts lazily on first use", async () => {
    const { local, host } = await voice({ installed: true, selected: () => false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.spawned).toHaveLength(0);
    await local.ready();
    expect(host.spawned).toHaveLength(1);
  });

  it("unloads the previous model when the model changes", async () => {
    const { local, host } = await voice({ installed: true });
    await local.ready();
    await local.useModel("a");
    await local.useModel("a");
    await local.useModel("b");
    const deletes = host.requests.filter((request) => request.method === "DELETE");
    expect(deletes.map((request) => request.url)).toEqual(["http://127.0.0.1:40123/v1/models?model_name=a"]);
    expect(await local.voices(DEFAULT_LOCAL_MODEL.id)).toEqual(["af_heart", "bm_george"]);
  });
});

describe("local engine", () => {
  type Call = { url: string; body?: Record<string, unknown> };
  function server(voices: string[] | null = null) {
    const calls: Call[] = [];
    const used: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined });
      return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mp3" } });
    }) as typeof fetch;
    const local: LocalSpeechServer = {
      problem: () => null,
      ready: async () => "http://127.0.0.1:40123/v1",
      useModel: async (model) => { used.push(model); },
      models: () => new LocalVoice({ root: "/tmp/x", selected: () => true }).models(),
      voices: async () => voices,
    };
    return { calls, used, engine: localEngine(local, fetchImpl) };
  }

  it("speaks through the managed server, with mlx-audio's names for delivery and accent", async () => {
    const { calls, used, engine } = server();
    await engine.synthesize({ text: "Hi.", model: DEFAULT_LOCAL_MODEL.id, voice: "bf_emma", instructions: "calm" });
    expect(calls[0]!.url).toBe("http://127.0.0.1:40123/v1/audio/speech");
    expect(calls[0]!.body).toEqual({ model: DEFAULT_LOCAL_MODEL.id, input: "Hi.", voice: "bf_emma", lang_code: "b", instruct: "calm", response_format: "mp3" });
    expect(used).toEqual([DEFAULT_LOCAL_MODEL.id]);
  });

  it("clones the voice in a recording given as a path", async () => {
    const { calls, engine } = server();
    await engine.synthesize({ text: "Hi.", model: "mlx-community/chatterbox-turbo-fp16", voice: "/Users/me/me.wav" });
    expect(calls[0]!.body).toEqual({ model: "mlx-community/chatterbox-turbo-fp16", input: "Hi.", ref_audio: "/Users/me/me.wav", response_format: "mp3" });
  });

  it("lists the curated models, with the server's voices when it has them", async () => {
    expect((await server().engine.models()).map((model) => model.voices?.[0] ?? null)).toEqual(["af_heart", "ryan", null]);
    expect((await server(["zz"]).engine.models())[0]!.voices).toEqual(["zz"]);
  });
});
