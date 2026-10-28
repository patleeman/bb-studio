import { describe, expect, it } from "vitest";
import { transcribeOnServer, transcriptionsUrl } from "./call-stt";

describe("home server transcription", () => {
  it("finds the OpenAI-compatible endpoint from the URL in settings", () => {
    expect(transcriptionsUrl("http://red4:8000")).toBe("http://red4:8000/v1/audio/transcriptions");
    expect(transcriptionsUrl("http://red4:8000/")).toBe("http://red4:8000/v1/audio/transcriptions");
    expect(transcriptionsUrl("https://stt.example/v1")).toBe("https://stt.example/v1/audio/transcriptions");
    expect(transcriptionsUrl("http://red4:9000/v1/audio/transcriptions")).toBe("http://red4:9000/v1/audio/transcriptions");
    expect(() => transcriptionsUrl("")).toThrow(/home server URL/);
    expect(() => transcriptionsUrl("ftp://red4")).toThrow(/http/);
  });

  it("posts the piece with the model and hint, and reads the text", async () => {
    let seen: { url: string; form: FormData } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, form: init.body as FormData };
      return new Response(JSON.stringify({ text: "Hello from red4" }), { status: 200 });
    }) as unknown as typeof fetch;
    const audio = new File([new Uint8Array([1, 2])], "them-0.wav", { type: "audio/wav" });
    const text = await transcribeOnServer({ url: "http://red4:8000", model: "", audio, prompt: "earlier", signal: new AbortController().signal }, fetcher);
    expect(text).toBe("Hello from red4");
    expect(seen!.url).toBe("http://red4:8000/v1/audio/transcriptions");
    expect(seen!.form.get("model")).toBe("whisper-1");
    expect(seen!.form.get("prompt")).toBe("earlier");
    expect((seen!.form.get("file") as File).name).toBe("them-0.wav");
  });

  it("reports the server's error so the queue retries", async () => {
    const fetcher = (async () => new Response("model not loaded", { status: 503 })) as unknown as typeof fetch;
    const audio = new File([new Uint8Array([1])], "a.wav");
    await expect(transcribeOnServer({ url: "http://red4", model: "large", audio, signal: new AbortController().signal }, fetcher)).rejects.toThrow(/503: model not loaded/);
  });
});
