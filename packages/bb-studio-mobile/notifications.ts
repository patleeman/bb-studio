import type { ExpoMessage } from "./apns.js";

/** An empty completion has nothing to report. Older bot prompts still answer exactly [PASS], which counts as empty. */
export function isQuietCompletion(message: Pick<ExpoMessage, "body" | "data">): boolean {
  return message.data?.kind === "turn-finished" && /^[\s`*_~]*(?:\[pass\][\s`*_~]*)?$/iu.test(message.body ?? "");
}
