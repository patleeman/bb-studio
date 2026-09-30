// Which composer a reaction drafts into — shared, pure, unit-tested.
//
// More than one composer can be mounted at once (the main view plus a
// floating chat, a side chat, a split). A reaction belongs in the composer
// that writes to the thread whose message it came from. If none is mounted
// for that thread, the most recently mounted composer takes it, as before.

import type { PluginComposerScope } from "@bb/plugin-sdk/app";

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
 * Pick from `mounted` (oldest first) the composer for `threadId`: the newest
 * one writing to that thread, else the newest one of any kind.
 */
export function pickComposer<T extends { scope: PluginComposerScope }>(
  mounted: readonly T[],
  threadId: string,
): T | null {
  for (let index = mounted.length - 1; index >= 0; index -= 1) {
    if (scopeThread(mounted[index].scope) === threadId) return mounted[index];
  }
  return mounted.at(-1) ?? null;
}
