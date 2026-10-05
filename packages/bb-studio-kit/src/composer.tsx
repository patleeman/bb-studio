// Drafting into the right composer from outside one: message actions and
// message directives run with no composer of their own. Mount
// `ComposerBridge` as a bare composer banner; it registers each mounted
// composer, and `composerFor` picks the one for a message's thread. Each
// plugin bundles its own copy of the kit, so each has its own registry.
//
// More than one composer can be mounted at once (the main view plus a
// floating chat, a side chat, a split). A draft belongs in the composer that
// writes to the message's thread. Failing that, a new-thread composer takes
// it. A composer bound to another thread never does, since that would send
// the draft to the wrong conversation.
import { useComposer, type PluginComposerApi, type PluginComposerScope } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";

const mounted: PluginComposerApi[] = [];

/** Registers this composer while it's mounted. Renders nothing. */
export function ComposerBridge() {
  const composer = useComposer();
  useEffect(() => {
    mounted.push(composer);
    return () => {
      const index = mounted.indexOf(composer);
      if (index !== -1) mounted.splice(index, 1);
    };
  }, [composer]);
  return null;
}

/** The mounted composer a draft for `threadId` belongs in, or null. */
export function composerFor(threadId: string): PluginComposerApi | null {
  return pickComposer(mounted, threadId);
}

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

/** From `mounted` (oldest first), the newest composer writing to `threadId`, else the newest new-thread composer, else null. */
export function pickComposer<T extends { scope: PluginComposerScope }>(mounted: readonly T[], threadId: string): T | null {
  for (let index = mounted.length - 1; index >= 0; index -= 1) {
    if (scopeThread(mounted[index].scope) === threadId) return mounted[index];
  }
  for (let index = mounted.length - 1; index >= 0; index -= 1) {
    if (mounted[index].scope.kind === "new-thread") return mounted[index];
  }
  return null;
}
