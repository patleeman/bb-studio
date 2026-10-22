import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeechConfig, SpeechEngine, SpeechRequest } from "./engines";
import { SpeechService } from "./service";

const config: SpeechConfig = { engine: "openrouter", model: "m1", voice: "v1", instructions: "", speed: 1, openRouterApiKey: "sk", endpoint: "", endpointApiKey: "" };
const text = (stream: ReadableStream<Uint8Array>) => new Response(stream).text();

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "speech-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function setup(options: { fail?: boolean } = {}) {
  const requests: SpeechRequest[] = [];
  let current = config;
  const engine: SpeechEngine = {
    id: "openrouter",
    label: "Fake",
    models: async () => [],
    async synthesize(request) {
      requests.push(request);
      if (options.fail) throw new Error("engine down");
      return { mimeType: "audio/mpeg", body: new Response(`audio:${request.text}`).body! };
    },
  };
  const service = new SpeechService({ config: () => current, cacheDir: dir, engineFor: () => engine, warn: () => {} });
  return { service, requests, setConfig: (next: Partial<SpeechConfig>) => { current = { ...current, ...next }; } };
}

describe("SpeechService", () => {
  it("makes prepared audio once, streams it, and serves the cached copy after", async () => {
    const { service, requests } = setup();
    const key = service.prepare("Hello there.", { instructions: "calm" });
    expect(key).toMatch(/^[a-f0-9]{40}$/);
    expect(await text((await service.audio(key))!.body)).toBe("audio:Hello there.");
    expect(requests).toEqual([{ text: "Hello there.", model: "m1", voice: "v1", instructions: "calm" }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const again = await service.audio(key);
    expect(await text(again!.body)).toBe("audio:Hello there.");
    expect(again!.size).toBe("audio:Hello there.".length);
    expect(requests).toHaveLength(1);
  });

  it("gives a Fish model a fixed voice when none is chosen, so a reply keeps one voice", async () => {
    const { service, requests, setConfig } = setup();
    setConfig({ model: "fish-audio/drama-3", voice: "" });
    await service.speak("First piece.");
    await service.speak("Second piece.");
    expect(requests.map((request) => request.voice)).toEqual(["9a9cf47702da476aa4629e2506d4a857", "9a9cf47702da476aa4629e2506d4a857"]);
    setConfig({ model: "elevenlabs/eleven-v4", voice: "" });
    await service.speak("Third piece.");
    expect(requests.at(-1)!.voice).toBe("");
  });

  it("knows nothing of a key nobody prepared", async () => {
    expect(await setup().service.audio("0".repeat(40))).toBeNull();
  });

  it("keys audio by everything that shapes it", () => {
    const { service, setConfig } = setup();
    const first = service.prepare("Hi.");
    expect(service.prepare("Hi.")).toBe(first);
    expect(service.prepare("Hi.", { voice: "v2" })).not.toBe(first);
    setConfig({ model: "m2" });
    expect(service.prepare("Hi.")).not.toBe(first);
  });

  it("binds prepared audio and warming to the custom endpoint", async () => {
    let current: SpeechConfig = { ...config, engine: "custom", endpoint: "http://a.test/v1" };
    const synthesized: string[] = [];
    const warnings: string[] = [];
    const service = new SpeechService({
      config: () => current,
      cacheDir: dir,
      warn: (warning) => warnings.push(warning),
      engineFor: (next) => ({
        id: "custom",
        label: "Custom",
        models: async () => [],
        synthesize: async () => {
          synthesized.push(next.endpoint);
          return { mimeType: "audio/mpeg", body: new Response("audio").body! };
        },
      }),
    });

    const prepared = service.prepare("Prepared for A");
    current = { ...current, endpoint: "http://b.test/v1" };
    await expect(service.audio(prepared)).rejects.toThrow(/settings changed/);
    expect(synthesized).toEqual([]);

    service.warm("Warm for B");
    current = { ...current, endpoint: "http://c.test/v1" };
    await vi.waitFor(() => expect(warnings.join(" ")).toMatch(/settings changed/));
    expect(synthesized).toEqual([]);
  });

  it("refuses empty or over-long text and an engine that isn't set up", () => {
    const { service } = setup();
    expect(() => service.prepare("   ")).toThrow(/Nothing/);
    expect(() => service.prepare("x".repeat(4001))).toThrow(/at most/);
    const bare = new SpeechService({ config: () => ({ ...config, openRouterApiKey: "" }), cacheDir: dir, warn: () => {} });
    expect(() => bare.prepare("Hi.")).toThrow(/OpenRouter API key/);
    expect(bare.problem()).toMatch(/OpenRouter API key/);
    expect(setup().service.problem()).toBeNull();
  });

  it("returns the whole audio for the CLI and caches it", async () => {
    const { service } = setup();
    const audio = await service.speak("Saved.");
    expect(new TextDecoder().decode(audio.bytes)).toBe("audio:Saved.");
    expect((await readdir(dir)).filter((name) => name.endsWith(".mp3"))).toHaveLength(1);
  });

  it("writes a streamed WAV's real length into the cached file", async () => {
    const header = new Uint8Array(44);
    header.set(new TextEncoder().encode("RIFF"), 0);
    header.set(new TextEncoder().encode("WAVEfmt "), 8);
    header.set(new TextEncoder().encode("data"), 36);
    new DataView(header.buffer).setUint32(4, 0xffffffff, true);
    const engineWav = new SpeechService({
      config: () => config, cacheDir: dir, warn: () => {},
      engineFor: () => ({ id: "openrouter", label: "Fake", models: async () => [], synthesize: async () => ({ mimeType: "audio/wav", body: new Response(new Uint8Array([...header, 1, 2, 3, 4])).body! }) }),
    });
    await engineWav.speak("Wave.");
    const name = (await readdir(dir)).find((file) => file.endsWith(".wav"))!;
    const saved = new DataView((await readFile(join(dir, name))).buffer);
    expect(saved.getUint32(4, true)).toBe(48 - 8);
    expect(saved.getUint32(40, true)).toBe(4);
  });

  it("warms audio ahead of a player, once, and serves it from the cache", async () => {
    const { service, requests } = setup();
    const key = service.warm("Ready soon.");
    expect(service.warm("Ready soon.")).toBe(key);
    expect(await text((await service.audio(key))!.body)).toBe("audio:Ready soon.");
    expect(requests).toHaveLength(1);
  });

  it("says when the engine fails, and keeps no partial file", async () => {
    const { service } = setup({ fail: true });
    await expect(service.audio(service.prepare("Hi."))).rejects.toThrow(/engine down/);
    expect(await readdir(dir).catch(() => [])).toEqual([]);
  });
});
