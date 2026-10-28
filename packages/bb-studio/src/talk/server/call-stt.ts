// Speech to text on the home server (red4): an OpenAI-compatible
// /v1/audio/transcriptions endpoint, such as faster-whisper-server or
// whisper.cpp's server. The URL is a setting with no default.

/** `http://red4:8000` → `http://red4:8000/v1/audio/transcriptions`; a full endpoint URL is kept. */
export function transcriptionsUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Set Call transcription: home server URL in Studio's settings, or choose another call transcription.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`The home server URL isn't a URL: ${trimmed}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The home server URL must start with http:// or https://.");
  if (/\/audio\/transcriptions$/.test(url.pathname)) return url.toString();
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = /\/v1$/.test(path) ? `${path}/audio/transcriptions` : `${path}/v1/audio/transcriptions`;
  return url.toString();
}

export async function transcribeOnServer(
  input: { url: string; model?: string; audio: File; prompt?: string; signal: AbortSignal },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const form = new FormData();
  form.set("file", input.audio, input.audio.name);
  form.set("model", input.model?.trim() || "whisper-1");
  form.set("response_format", "json");
  if (input.prompt) form.set("prompt", input.prompt);
  const response = await fetcher(transcriptionsUrl(input.url), { method: "POST", body: form, signal: input.signal });
  const body = await response.text();
  if (!response.ok) throw new Error(`The home server answered ${response.status}: ${body.slice(0, 200)}`);
  try {
    const parsed = JSON.parse(body) as { text?: unknown };
    if (typeof parsed.text === "string") return parsed.text;
  } catch {
    // Some servers answer plain text.
    return body;
  }
  throw new Error("The home server's answer had no text.");
}
