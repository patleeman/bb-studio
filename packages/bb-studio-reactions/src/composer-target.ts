// Which composer a reaction drafts into — shared, pure, unit-tested.
//
// More than one composer can be mounted at once (the main view plus a
// floating chat, a side chat, a split). A reaction belongs in the composer
// that writes to the thread whose message it came from. If none is mounted
// for that thread, there is no target: drafting into another thread's
// composer would send the reaction to the wrong conversation.

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
 * `threadId`, or null when none does.
 */
export function pickComposer<T extends { scope: PluginComposerScope }>(
  mounted: readonly T[],
  threadId: string,
): T | null {
  for (let index = mounted.length - 1; index >= 0; index -= 1) {
    if (scopeThread(mounted[index].scope) === threadId) return mounted[index];
  }
  return null;
}
