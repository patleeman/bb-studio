import type { ExpoMessage } from "./apns.js";

// Mobile has its own copy of Studio's silent-output rule; notifications.test.ts
// checks they agree. See docs/silent-output.md.
const SILENT = /^[\s`*_~]*(?:\[pass\][\s`*_~]*)?$/iu;

/** A finished turn whose text is empty or exactly [PASS] has nothing to say: no push. */
export function isQuietCompletion(message: Pick<ExpoMessage, "body" | "data">): boolean {
  return message.data?.kind === "turn-finished" && SILENT.test(message.body ?? "");
}
