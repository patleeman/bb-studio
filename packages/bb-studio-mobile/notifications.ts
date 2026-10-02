import type { ExpoMessage } from "./apns.js";

/** A PASS-only completion is a quiet result, including case and Markdown variants. */
export function isQuietCompletion(message: Pick<ExpoMessage, "body" | "data">): boolean {
  if (message.data?.kind !== "turn-finished" || typeof message.body !== "string") return false;
  const text = message.body.trim().replace(/^[`*_~]+|[`*_~]+$/gu, "").trim();
  return /^\[pass\]$/iu.test(text);
}
