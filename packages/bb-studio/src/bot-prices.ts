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
