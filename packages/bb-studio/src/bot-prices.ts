// A hand-maintained price table for the models Bots run on. BB has no price
// table, so Studio keeps its own for the prompt cache's estimates (src/bot-cache.ts):
// the cold-send banner's "~$X" and Bot info's "Warming ≈ $0.08/h".
//
// UPDATE HERE when prices change. Last checked 2026-10-13 against
//   - Claude: https://www.anthropic.com/pricing (cache writes are 1.25x input
//     for the 5-minute TTL and 2x for 1 hour; cache reads differ by model);
//   - OpenAI: https://developers.openai.com/api/docs/pricing (no cache-write
//     premium except where listed; its cache can't be kept warm for an hour,
//     so warming is Claude-only).
// Prices are US dollars per million tokens, standard tier, no batch discount.

export type ModelPrice = {
  vendor: "anthropic" | "openai";
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
  /** Whether a ping can keep the cache warm: a 1-hour cache whose reads refresh it (Claude Code writes 1h). */
  warmable: boolean;
};

const claude = (input: number, cacheRead: number, output: number): ModelPrice => ({ vendor: "anthropic", input, cacheRead, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, output, warmable: true });
const openai = (input: number, cacheRead: number, output: number, cacheWrite = input): ModelPrice => ({ vendor: "openai", input, cacheRead, cacheWrite5m: cacheWrite, cacheWrite1h: cacheWrite, output, warmable: false });

/** By model id, without date suffixes or context markers. */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": claude(10, 0.25, 50),
  "claude-mythos-5-1": claude(10, 0.25, 50),
  "claude-fable-5": claude(10, 1, 50),
  "claude-mythos-5": claude(10, 1, 50),
  "claude-opus-5-5": claude(4, 0.2, 20),
  "claude-opus-5": claude(5, 0.5, 25),
  "claude-opus-4-8": claude(5, 0.5, 25),
  "claude-opus-4-7": claude(5, 0.5, 25),
  "claude-opus-4-6": claude(5, 0.5, 25),
  "claude-opus-4-5": claude(5, 0.5, 25),
  "claude-opus-4-1": claude(15, 1.5, 75),
  "claude-opus-4": claude(15, 1.5, 75),
  "claude-sonnet-5-5": claude(2, 0.2, 10),
  "claude-sonnet-5": claude(2, 0.2, 10),
  "claude-sonnet-4-6": claude(3, 0.3, 15),
  "claude-sonnet-4-5": claude(3, 0.3, 15),
  "claude-sonnet-4": claude(3, 0.3, 15),
  "claude-haiku-5-5": claude(0.1, 0.01, 0.5),
  "claude-haiku-4-5": claude(1, 0.1, 5),
  "gpt-5.6-sol": openai(4, 0.4, 20, 5),
  "gpt-5.6-terra": openai(2, 0.2, 12, 2.5),
  "gpt-5.6-luna": openai(0.2, 0.02, 1.2, 0.25),
  "gpt-5.5": openai(5, 0.5, 30),
  "gpt-5.4": openai(2.5, 0.25, 15),
  "gpt-5.4-mini": openai(0.75, 0.075, 4.5),
  "gpt-5.3-codex": openai(1.75, 0.175, 14),
  "gpt-5.2": openai(1.75, 0.175, 14),
  "gpt-5.1": openai(1.25, 0.125, 10),
  "gpt-5": openai(1.25, 0.125, 10),
  "gpt-5-mini": openai(0.25, 0.025, 2),
};

/** Claude Code's short names, to the current model of each family. */
const ALIASES: Record<string, string> = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5", fable: "claude-fable-5-1" };

/**
 * A model's prices, or null when it isn't in the table. Ignores case, a
 * `[1m]` marker, a provider prefix and a date suffix; otherwise the longest
 * table id it starts with (`gpt-5.2-codex` is `gpt-5.2`). Pro tiers cost
 * far more than their base model, so they aren't guessed.
 */
export function priceFor(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  let id = model.trim().toLowerCase().replace(/\[[^\]]*\]$/, "").replace(/^(anthropic|openai)[./]/, "").replace(/@.*$/, "").replace(/-20\d{6}$/, "");
  id = ALIASES[id] ?? id;
  if (MODEL_PRICES[id]) return MODEL_PRICES[id]!;
  if (/-pro\b/.test(id)) return null;
  const base = Object.keys(MODEL_PRICES).filter((key) => id.startsWith(`${key}-`)).sort((a, b) => b.length - a.length)[0];
  return base ? MODEL_PRICES[base]! : null;
}

// ---------------------------------------------------------------------------
// Voice calls (src/voice/call): OpenAI's Realtime API
// ---------------------------------------------------------------------------
//
// UPDATE HERE when prices change. Last checked 2026-10-20 against
// https://developers.openai.com/api/docs/pricing ("Realtime and audio
// generation models" and "Transcription models"). US dollars per million
// tokens; transcription per minute where OpenAI bills it so.

export type RealtimePrice = {
  textInput: number;
  cachedTextInput: number;
  textOutput: number;
  audioInput: number;
  cachedAudioInput: number;
  audioOutput: number;
};

export const REALTIME_PRICES: Record<string, RealtimePrice> = {
  "gpt-realtime-2.1": { textInput: 4, cachedTextInput: 0.4, textOutput: 24, audioInput: 32, cachedAudioInput: 0.4, audioOutput: 64 },
  "gpt-realtime-2.1-mini": { textInput: 0.6, cachedTextInput: 0.06, textOutput: 2.4, audioInput: 10, cachedAudioInput: 0.3, audioOutput: 20 },
  "gpt-realtime-2": { textInput: 4, cachedTextInput: 0.4, textOutput: 24, audioInput: 32, cachedAudioInput: 0.4, audioOutput: 64 },
  "gpt-realtime-1.5": { textInput: 4, cachedTextInput: 0.4, textOutput: 16, audioInput: 32, cachedAudioInput: 0.4, audioOutput: 64 },
};

/** Input transcription: by token (input, output per million) or by minute. */
export const TRANSCRIBE_PRICES: Record<string, { input: number; output: number } | { perMinute: number }> = {
  "gpt-4o-mini-transcribe": { input: 1.25, output: 5 },
  "gpt-4o-transcribe": { input: 2.5, output: 10 },
  "gpt-realtime-whisper": { perMinute: 0.017 },
  "gpt-live-transcribe": { perMinute: 0.017 },
};

/** A realtime model's prices: an exact id, or a dated snapshot of one (`gpt-realtime-2.1-2026-09-01`). Null when unknown. */
export function realtimePriceFor(model: string | null | undefined): RealtimePrice | null {
  if (!model) return null;
  const id = model.trim().toLowerCase().replace(/-20\d{2}-\d{2}-\d{2}$/, "");
  return REALTIME_PRICES[id] ?? null;
}

/** A `response.done` event's usage, as OpenAI sends it; every field optional. */
export type RealtimeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens?: number; cached_tokens_details?: { text_tokens?: number; audio_tokens?: number } };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
};

/** Token counts a call adds up, for its record and its cost. */
export type RealtimeTally = { textIn: number; cachedTextIn: number; audioIn: number; cachedAudioIn: number; textOut: number; audioOut: number; transcribeIn: number; transcribeOut: number; transcribeSeconds: number };

export const EMPTY_TALLY: RealtimeTally = { textIn: 0, cachedTextIn: 0, audioIn: 0, cachedAudioIn: 0, textOut: 0, audioOut: 0, transcribeIn: 0, transcribeOut: 0, transcribeSeconds: 0 };

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** Adds one response's usage. Cached tokens are part of the input counts, so they're split out. */
export function addRealtimeUsage(tally: RealtimeTally, usage: RealtimeUsage): RealtimeTally {
  const input = usage.input_token_details ?? {};
  const cached = input.cached_tokens_details ?? {};
  const output = usage.output_token_details ?? {};
  const textIn = count(input.text_tokens);
  const audioIn = count(input.audio_tokens);
  const cachedText = Math.min(textIn, count(cached.text_tokens));
  const cachedAudio = Math.min(audioIn, count(cached.audio_tokens));
  return {
    ...tally,
    textIn: tally.textIn + textIn - cachedText,
    cachedTextIn: tally.cachedTextIn + cachedText,
    audioIn: tally.audioIn + audioIn - cachedAudio,
    cachedAudioIn: tally.cachedAudioIn + cachedAudio,
    textOut: tally.textOut + count(output.text_tokens),
    audioOut: tally.audioOut + count(output.audio_tokens),
  };
}

/** Adds one transcription's usage: tokens (`type: "tokens"`) or seconds (`type: "duration"`). */
export function addTranscriptionUsage(tally: RealtimeTally, usage: { type?: string; input_tokens?: number; output_tokens?: number; seconds?: number } | null | undefined): RealtimeTally {
  if (!usage) return tally;
  if (usage.type === "duration") return { ...tally, transcribeSeconds: tally.transcribeSeconds + count(usage.seconds) };
  return { ...tally, transcribeIn: tally.transcribeIn + count(usage.input_tokens), transcribeOut: tally.transcribeOut + count(usage.output_tokens) };
}

/** What a call's tokens cost in US dollars; null when the model isn't in the table. */
export function realtimeCost(model: string, tally: RealtimeTally, transcribeModel?: string | null): number | null {
  const price = realtimePriceFor(model);
  if (!price) return null;
  const perM = (tokens: number, usd: number) => (tokens * usd) / 1_000_000;
  let usd = perM(tally.textIn, price.textInput) + perM(tally.cachedTextIn, price.cachedTextInput) + perM(tally.textOut, price.textOutput)
    + perM(tally.audioIn, price.audioInput) + perM(tally.cachedAudioIn, price.cachedAudioInput) + perM(tally.audioOut, price.audioOutput);
  const transcribe = transcribeModel ? TRANSCRIBE_PRICES[transcribeModel] : undefined;
  if (transcribe && "perMinute" in transcribe) usd += (tally.transcribeSeconds / 60) * transcribe.perMinute;
  else if (transcribe) usd += perM(tally.transcribeIn, transcribe.input) + perM(tally.transcribeOut, transcribe.output);
  return usd;
}
