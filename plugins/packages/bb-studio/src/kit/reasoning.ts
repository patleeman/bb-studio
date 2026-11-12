// Reasoning levels. SDK 0.6.104 types a thread's reasoning level as BB's
// fixed ladder instead of any string, while pickers and provider model lists
// still hand Studio plain strings. toReasoningLevel maps those onto the ladder.
import type { PluginProviderReasoningLevel } from "@get-bb/plugin-sdk";

export type ReasoningLevel = PluginProviderReasoningLevel;

/** BB's ladder, lowest to highest. */
export const REASONING_LEVELS = ["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"] as const satisfies readonly ReasoningLevel[];

/** Other names providers and older Studio settings use, by the nearest rung. */
const ALIASES: Record<string, ReasoningLevel> = {
  off: "none",
  minimal: "low",
  min: "low",
  normal: "medium",
  default: "medium",
  "extra-high": "xhigh",
  extra_high: "xhigh",
  "x-high": "xhigh",
  maximum: "max",
};

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === "string" && (REASONING_LEVELS as readonly string[]).includes(value);
}

/** `value` on BB's ladder: as is, by alias, else `fallback`. */
export function toReasoningLevel(value: string | null | undefined, fallback: ReasoningLevel = "medium"): ReasoningLevel {
  if (value == null) return fallback;
  const key = value.trim().toLowerCase();
  if (isReasoningLevel(key)) return key;
  return ALIASES[key] ?? fallback;
}

/** Like toReasoningLevel, but null stays null (the provider's default). */
export function toReasoningLevelOrNull(value: string | null | undefined): ReasoningLevel | null {
  return value == null ? null : toReasoningLevel(value);
}
