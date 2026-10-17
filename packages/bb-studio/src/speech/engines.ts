// Speech engines: text in, audio out. Every engine speaks OpenAI's
// `POST /audio/speech` shape, which OpenRouter and self-hosted servers
// (mlx-audio, fish-speech and others) share, so one adapter covers them; each
// engine differs only in where it points, its key, and how it lists models.

export type SpeechEngineId = "openrouter" | "custom" | "local";

export interface SpeechModel {
  id: string;
  name: string;
  /** USD per million characters, when the engine says. */
  pricePerMillionChars?: number;
  /** The voices the engine lists for this model; null when it doesn't say (type one in). */
  voices: string[] | null;
  /** Display names for voices whose ids aren't readable. */
  voiceNames?: Record<string, string>;
}

export interface SpeechRequest {
  text: string;
  model: string;
  /** Empty lets the engine pick its default voice, where it has one. */
  voice: string;
  /** Delivery guidance ("calm, brief"); engines that don't take it ignore it. */
  instructions?: string;
}

export interface SpeechAudio {
  mimeType: string;
  body: ReadableStream<Uint8Array>;
}

export interface SpeechEngine {
  id: SpeechEngineId;
  label: string;
  models(signal?: AbortSignal): Promise<SpeechModel[]>;
  synthesize(request: SpeechRequest, signal?: AbortSignal): Promise<SpeechAudio>;
}

export class SpeechNotSetUpError extends Error {}

type Fetch = typeof fetch;

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

interface OpenAiCompatibleOptions {
  id: SpeechEngineId;
  label: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /** Models when the server has no list. */
  listModels(get: (path: string, signal?: AbortSignal) => Promise<unknown>, signal?: AbortSignal): Promise<SpeechModel[]>;
  /** Fields to add to or replace in the speech request's body, for servers that name them differently. */
  fields?(request: SpeechRequest): Record<string, unknown>;
  fetch?: Fetch;
}

function openAiCompatible(options: OpenAiCompatibleOptions): SpeechEngine {
  const base = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const headers = { ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}), ...options.headers };
  const get = async (path: string, signal?: AbortSignal) => {
    const response = await fetchImpl(`${base}${path}`, { headers, signal });
    if (!response.ok) throw new Error(`${options.label} answered ${response.status} for ${path}: ${await errorText(response)}`);
    return response.json() as Promise<unknown>;
  };
  return {
    id: options.id,
    label: options.label,
    models: (signal) => options.listModels(get, signal),
    async synthesize(request, signal) {
      const speak = (format: "mp3" | "pcm") => fetchImpl(`${base}/audio/speech`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          input: request.text,
          ...(request.voice ? { voice: request.voice } : {}),
          ...(request.instructions ? { instructions: request.instructions } : {}),
          response_format: format,
          ...options.fields?.(request),
        }),
        signal,
      });
      let response = await speak("mp3");
      if (!response.ok) {
        const message = await errorText(response);
        // Some models (Gemini's) make only raw PCM.
        if (response.status === 400 && /\bpcm\b/i.test(message)) response = await speak("pcm");
        if (!response.ok) throw new Error(`${options.label} couldn't speak with ${request.model}: ${response.status} ${response.bodyUsed ? message : await errorText(response)}`);
      }
      if (!response.body) throw new Error(`${options.label} returned no audio.`);
      const contentType = response.headers.get("content-type") ?? "audio/mpeg";
      const mimeType = contentType.split(";")[0]!.trim();
      if (!mimeType.startsWith("audio/")) throw new Error(`${options.label} returned ${mimeType}, not audio: ${await errorText(response)}`);
      // Some servers (mlx-audio) answer a bad voice or format with 200 and no audio.
      const body = await nonEmpty(response.body, `${options.label} returned no audio for ${request.model}${request.voice ? ` in voice ${request.voice}` : ""}; check the model and voice.`);
      if (mimeType === "audio/pcm" || mimeType === "audio/l16") return { mimeType: "audio/wav", body: pcmToWav(body, contentType) };
      return { mimeType, body };
    },
  };
}

/** The stream unchanged, once it has shown a first non-empty chunk; throws if it ends without one. */
async function nonEmpty(stream: ReadableStream<Uint8Array>, message: string): Promise<ReadableStream<Uint8Array>> {
  const reader = stream.getReader();
  let first: Uint8Array | undefined;
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (done) throw new Error(message);
    if (value?.length) { first = value; break; }
  }
  let sentFirst = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentFirst) {
        sentFirst = true;
        controller.enqueue(first!);
        return;
      }
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

/** Raw 16-bit PCM as a streaming WAV: a header with an open-ended length, then the samples as they come. */
export function pcmToWav(pcm: ReadableStream<Uint8Array>, contentType: string): ReadableStream<Uint8Array> {
  const param = (name: string, fallback: number) => Number(new RegExp(`${name}=(\\d+)`).exec(contentType)?.[1] ?? fallback);
  const rate = param("rate", 24000);
  const channels = param("channels", 1);
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (offset: number, text: string) => [...text].forEach((char, index) => header.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, "RIFF");
  header.setUint32(4, 0xffffffff, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, channels, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * channels * 2, true);
  header.setUint16(32, channels * 2, true);
  header.setUint16(34, 16, true);
  ascii(36, "data");
  header.setUint32(40, 0xffffffff - 36, true);
  const reader = pcm.getReader();
  let sentHeader = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentHeader) {
        sentHeader = true;
        controller.enqueue(new Uint8Array(header.buffer));
        return;
      }
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; detail?: unknown };
    const message = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? (typeof parsed.detail === "string" ? parsed.detail : undefined);
    if (message) return message.slice(0, 300);
  } catch { /* Not JSON. */ }
  return text.slice(0, 300) || response.statusText;
}

interface OpenRouterModel {
  id: string;
  name?: string;
  pricing?: { prompt?: string };
  supported_voices?: unknown;
}

/**
 * Fish Audio's own stock voices (fish.audio's public library). OpenRouter
 * lists no voices for Fish models, and without one Fish picks a voice per
 * request, so a reply spoken in pieces changed voice midway. Studio always
 * sends one of these.
 */
export const FISH_VOICES: readonly { id: string; name: string }[] = [
  { id: "9a9cf47702da476aa4629e2506d4a857", name: "Hannah · friendly, clear" },
  { id: "933563129e564b19a115bedd57b7406a", name: "Sarah · soft, conversational" },
  { id: "b347db033a6549378b48d00acb0d06cd", name: "Selene · calm, gentle" },
  { id: "536d3a5e000945adb7038665781a4aca", name: "Ethan · clear explainer" },
  { id: "bf322df2096a46f18c579d0baa36f41d", name: "Adrian · steady narrator" },
  { id: "79d0bd3e4e5444b18f7b6d89b5927bf1", name: "Jordan · measured, confident" },
];

/** The voice to send when none is chosen: a fixed one for models that would otherwise pick one per request. */
export function defaultVoice(model: string): string {
  return model.startsWith("fish-audio/") ? FISH_VOICES[0]!.id : "";
}

export function openRouterEngine(apiKey: string, fetchImpl?: Fetch): SpeechEngine {
  return openAiCompatible({
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: OPENROUTER_BASE_URL,
    apiKey,
    headers: { "x-title": "BB Studio" },
    fetch: fetchImpl,
    async listModels(get, signal) {
      const body = (await get("/models?output_modalities=speech", signal)) as { data?: OpenRouterModel[] };
      return (body.data ?? []).map((model) => {
        // Speech models are priced per input character.
        const perChar = Number(model.pricing?.prompt);
        return {
          id: model.id,
          name: model.name ?? model.id,
          ...(Number.isFinite(perChar) && perChar > 0 ? { pricePerMillionChars: Math.round(perChar * 1e6 * 100) / 100 } : {}),
          voices: Array.isArray(model.supported_voices) ? model.supported_voices.filter((voice): voice is string => typeof voice === "string") : model.id.startsWith("fish-audio/") ? FISH_VOICES.map((voice) => voice.id) : null,
          ...(model.id.startsWith("fish-audio/") ? { voiceNames: Object.fromEntries(FISH_VOICES.map((voice) => [voice.id, voice.name])) } : {}),
        };
      });
    },
  });
}

/** Any server with OpenAI's speech API, such as a self-hosted mlx-audio or fish-speech. */
export function customEngine(baseUrl: string, apiKey: string | undefined, fetchImpl?: Fetch): SpeechEngine {
  return openAiCompatible({
    id: "custom",
    label: "Custom endpoint",
    baseUrl,
    apiKey,
    fetch: fetchImpl,
    async listModels(get, signal) {
      // Most servers list models at /models; some don't, and then the user types one.
      const body = (await get("/models", signal).catch(() => null)) as { data?: { id?: unknown }[] } | null;
      return (body?.data ?? [])
        .filter((model): model is { id: string } => typeof model.id === "string")
        .map((model) => ({ id: model.id, name: model.id, voices: null }));
    },
  });
}

/** Studio's own mlx-audio server (see local.ts), as the local engine needs it. */
export interface LocalSpeechServer {
  /** Why the server can't run here or yet (unsupported, not installed), or null. */
  problem(): string | null;
  /** The server's base URL once it's ready, starting it if it isn't running. */
  ready(signal?: AbortSignal): Promise<string>;
  /** Unload the model spoken with before, when it differs: the server keeps every model it loads. */
  useModel(model: string): Promise<void>;
  models(): SpeechModel[];
  /** The model's voices as the server lists them, or null when it lists none. */
  voices(model: string, signal?: AbortSignal): Promise<string[] | null>;
}

/** Speech on this Mac, through the mlx-audio server Studio installs and runs. */
export function localEngine(server: LocalSpeechServer, fetchImpl?: Fetch): SpeechEngine {
  const engine = (baseUrl: string) => openAiCompatible({
    id: "local",
    label: "On this Mac",
    baseUrl,
    fetch: fetchImpl,
    listModels: async () => server.models(),
    fields(request) {
      // A voice that's a path to a recording is a voice to clone (Chatterbox).
      const clone = request.voice.startsWith("/");
      // Kokoro's American (a_) and British (b_) voices need their accent's phonemes.
      const accent = /kokoro/i.test(request.model) ? /^([ab])[fm]_/.exec(request.voice)?.[1] : undefined;
      return {
        ...(clone ? { voice: undefined, ref_audio: request.voice } : {}),
        ...(accent ? { lang_code: accent } : {}),
        // mlx-audio takes delivery as `instruct` (Qwen3-TTS follows it).
        ...(request.instructions ? { instructions: undefined, instruct: request.instructions } : {}),
      };
    },
  });
  return {
    id: "local",
    label: "On this Mac",
    async models(signal) {
      // Voices come from the server when it lists them, else the model's known ones.
      return Promise.all(server.models().map(async (model) => {
        const listed = await server.voices(model.id, signal).catch(() => null);
        return listed?.length ? { ...model, voices: listed } : model;
      }));
    },
    async synthesize(request, signal) {
      const url = await server.ready(signal);
      await server.useModel(request.model);
      return engine(url).synthesize(request, signal);
    },
  };
}

export interface SpeechConfig {
  engine: SpeechEngineId;
  model: string;
  voice: string;
  instructions: string;
  /** How fast the player plays speech, 0.5 to 2.5; the audio itself is made at the model's pace. */
  speed: number;
  openRouterApiKey: string;
  endpoint: string;
  endpointApiKey: string;
}

/** The configured engine, or SpeechNotSetUpError saying what's missing. */
export function engineFor(config: SpeechConfig, fetchImpl?: Fetch, local?: LocalSpeechServer): SpeechEngine {
  if (config.engine === "local") {
    if (!local) throw new SpeechNotSetUpError("Local voices run only inside Studio's server.");
    const problem = local.problem();
    if (problem) throw new SpeechNotSetUpError(problem);
    return localEngine(local, fetchImpl);
  }
  if (config.engine === "custom") {
    const url = config.endpoint.trim();
    if (!url) throw new SpeechNotSetUpError("Set the custom speech endpoint in Studio's settings (Speech: custom endpoint), such as http://127.0.0.1:8000/v1.");
    if (!/^https?:\/\//.test(url)) throw new SpeechNotSetUpError(`The custom speech endpoint must start with http:// or https://, not ${JSON.stringify(url)}.`);
    return customEngine(url, config.endpointApiKey.trim() || undefined, fetchImpl);
  }
  const key = config.openRouterApiKey.trim();
  if (!key) throw new SpeechNotSetUpError("Add an OpenRouter API key in Studio's settings, or set OPENROUTER_API_KEY on the BB host.");
  return openRouterEngine(key, fetchImpl);
}
