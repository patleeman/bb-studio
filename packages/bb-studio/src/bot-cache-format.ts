// Formatting for the prompt cache's estimates (src/bot-cache.ts), shared by the server and the UI.

export function formatUsd(value: number): string {
  if (value < 0.01) return "<$0.01";
  return `$${value < 10 ? value.toFixed(2) : value.toFixed(0)}`;
}

export function formatTokens(tokens: number): string {
  return tokens >= 1_000_000 ? `${(tokens / 1e6).toFixed(1)}M` : tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

/** Waking hours as "7:00–23:00"; minutes after midnight. */
export function formatWake(start: number, end: number): string {
  const clock = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  return `${clock(start)}–${clock(end)}`;
}
