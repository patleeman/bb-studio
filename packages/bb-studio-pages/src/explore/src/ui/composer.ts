// Drafting a Next suggestion into the right composer. Message directives run
// outside any composer, so a bare banner registers each mounted composer's
// API here. The picking rule matches Studio Reactions': the composer writing
// to the message's thread, else a new-thread composer, never another thread's.
import type { PluginComposerApi, PluginComposerScope } from "@get-bb/plugin-sdk/app";

export const mountedComposers: PluginComposerApi[] = [];

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

/** The newest composer writing to `threadId`, else the newest new-thread composer, else null. */
export function pickComposer<T extends { scope: PluginComposerScope }>(mounted: readonly T[], threadId: string): T | null {
  for (let index = mounted.length - 1; index >= 0; index -= 1) {
    if (scopeThread(mounted[index].scope) === threadId) return mounted[index];
  }
  for (let index = mounted.length - 1; index >= 0; index -= 1) {
    if (mounted[index].scope.kind === "new-thread") return mounted[index];
  }
  return null;
}

/** Adds `text` to the draft, after anything already there. */
export function appendDraft(current: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return current;
  return current.trim() ? `${current.trimEnd()}\n\n${trimmed}` : trimmed;
}
