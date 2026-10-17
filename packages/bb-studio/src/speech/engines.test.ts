import { describe, expect, it } from "vitest";
import { customEngine, engineFor, openRouterEngine, SpeechNotSetUpError, type SpeechConfig } from "./engines";

type Call = { url: string; init?: RequestInit };
function fakeFetch(respond: (call: Call, index: number) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond({ url, init }, calls.length - 1);
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const body = (call: Call) => JSON.parse(String(call.init?.body)) as Record<string, unknown>;
const bytes = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());

const config: SpeechConfig = { engine: "openrouter", model: "fish-audio/drama-3", voice: "", instructions: "", openRouterApiKey: "", endpoint: "", endpointApiKey: "" };

describe("speech engines", () => {
  it("sends OpenAI's speech request to OpenRouter with the key, leaving out an empty voice", async () => {
    const { calls, fetchImpl } = fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }));
    const audio = await openRouterEngine("sk-test", fetchImpl).synthesize({ text: "Hello.", model: "fish-audio/drama-3", voice: "", instructions: "calm" });
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect((calls[0]!.init?.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(body(calls[0]!)).toEqual({ model: "fish-audio/drama-3", input: "Hello.", instructions: "calm", response_format: "mp3" });
    expect(audio.mimeType).toBe("audio/mpeg");
    expect([...await bytes(audio.body)]).toEqual([1, 2, 3]);
  });

  it("asks again for PCM when a model makes only PCM, and streams it as WAV", async () => {
    const { calls, fetchImpl } = fakeFetch((_call, index) => index === 0
      ? Response.json({ error: { message: "Gemini TTS only supports response_format=\"pcm\"." } }, { status: 400 })
      : new Response(new Uint8Array([9, 9, 9, 9]), { headers: { "content-type": "audio/pcm;rate=16000;channels=1" } }));
    const audio = await openRouterEngine("sk", fetchImpl).synthesize({ text: "Hi.", model: "google/gemini-3.8-flash-tts", voice: "Kore" });
    expect(body(calls[1]!).response_format).toBe("pcm");
    expect(audio.mimeType).toBe("audio/wav");
    const wav = await bytes(audio.body);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16000);
    expect([...wav.slice(44)]).toEqual([9, 9, 9, 9]);
  });

  it("reports the engine's error message", async () => {
    const { fetchImpl } = fakeFetch(() => Response.json({ error: { message: "voice not found" } }, { status: 404 }));
    await expect(openRouterEngine("sk", fetchImpl).synthesize({ text: "Hi.", model: "x", voice: "nobody" })).rejects.toThrow(/404 voice not found/);
  });

  it("treats a 200 with no audio as a failure, as mlx-audio answers a bad voice", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(new Uint8Array([]), { headers: { "content-type": "audio/mp3" } }));
    await expect(customEngine("http://127.0.0.1:8000/v1", undefined, fetchImpl).synthesize({ text: "Hi.", model: "kokoro", voice: "alloy" })).rejects.toThrow(/no audio for kokoro in voice alloy/);
  });

  it("refuses a response that isn't audio", async () => {
    const { fetchImpl } = fakeFetch(() => Response.json({ ok: true }));
    await expect(openRouterEngine("sk", fetchImpl).synthesize({ text: "Hi.", model: "x", voice: "" })).rejects.toThrow(/not audio/);
  });

  it("lists OpenRouter's speech models with prices per million characters and voices", async () => {
    const { calls, fetchImpl } = fakeFetch(() => Response.json({ data: [
      { id: "elevenlabs/eleven-v4", name: "Eleven v4", pricing: { prompt: "0.00004" }, supported_voices: ["george", "sarah"] },
      { id: "fish-audio/drama-3", name: "Drama 3", pricing: { prompt: "0.000002" }, supported_voices: null },
    ] }));
    const models = await openRouterEngine("sk", fetchImpl).models();
    expect(calls[0]!.url).toContain("/models?output_modalities=speech");
    expect(models).toEqual([
      { id: "elevenlabs/eleven-v4", name: "Eleven v4", pricePerMillionChars: 40, voices: ["george", "sarah"] },
      { id: "fish-audio/drama-3", name: "Drama 3", pricePerMillionChars: 2, voices: null },
    ]);
  });

  it("points a custom engine at its own server, with no key when none is set, and tolerates a missing model list", async () => {
    const { calls, fetchImpl } = fakeFetch((call) => call.url.endsWith("/models")
      ? new Response("nope", { status: 404 })
      : new Response(new Uint8Array([1]), { headers: { "content-type": "audio/wav" } }));
    const engine = customEngine("http://127.0.0.1:8000/v1/", undefined, fetchImpl);
    expect(await engine.models()).toEqual([]);
    await engine.synthesize({ text: "Hi.", model: "kokoro", voice: "af_heart" });
    expect(calls[1]!.url).toBe("http://127.0.0.1:8000/v1/audio/speech");
    expect((calls[1]!.init?.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("says what's missing before any request", () => {
    expect(() => engineFor(config)).toThrow(SpeechNotSetUpError);
    expect(() => engineFor({ ...config, engine: "custom" })).toThrow(/custom speech endpoint/);
    expect(() => engineFor({ ...config, engine: "custom", endpoint: "localhost:8000" })).toThrow(/http/);
    expect(engineFor({ ...config, openRouterApiKey: "sk" }).id).toBe("openrouter");
    expect(engineFor({ ...config, engine: "custom", endpoint: "http://localhost:8000/v1" }).id).toBe("custom");
  });
});
