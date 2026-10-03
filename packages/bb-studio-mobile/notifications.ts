import type { ExpoMessage } from "./apns.js";

/** An empty completion has nothing to report. */
export function isQuietCompletion(message: Pick<ExpoMessage, "body" | "data">): boolean {
  return message.data?.kind === "turn-finished" && !message.body?.trim();
}
