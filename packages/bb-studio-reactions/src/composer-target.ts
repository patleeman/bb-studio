// Which composer a reaction drafts into — shared, pure, unit-tested.
//
// More than one composer can be mounted at once (the main view plus a
// floating chat, a side chat, a split). A reaction belongs in the composer
// that writes to the thread whose message it came from. Failing that, a
// new-thread composer takes it. A composer bound to another thread never
// does, since that would send the reaction to the wrong conversation.

import type { PluginComposerScope } from "@get-bb/plugin-sdk/app";

/** The thread a composer scope sends to, or null for a new thread. */
function scopeThread(scope: PluginComposerScope): string | null {
  switch (scope.kind) {
    case "thread":
    case "queued-message":
      return scope.threadId;
    case "side-chat":
      return scope.childThreadId;
    default:
      return null;
  }
}

/**
 * Pick from `mounted` (oldest first) the newest composer writing to
 * `threadId`, else the newest new-thread composer, else null.
 */
export function pickComposer<T extends { scope: PluginComposerScope }>(
  mounted: readonly T[],
  threadId: string,
): T | null {
  for (let index = mounted.length - 1; index >= 0; index -= 1) {
    if (scopeThread(mounted[index].scope) === threadId) return mounted[index];
  }
  for (let index = mounted.length - 1; index >= 0; index -= 1) {
    if (mounted[index].scope.kind === "new-thread") return mounted[index];
  }
  return null;
}
