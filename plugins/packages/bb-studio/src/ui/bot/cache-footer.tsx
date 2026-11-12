// The prompt-cache chip under the composer's input, in the row with the
// machine and permission controls, on a BB whose composer takes footer items
// (`experimental_footer`). There the chip leaves the context row above the
// composer, and its details open as a small popover on the chip itself, so
// nothing is drawn above the input; where BB's context popover takes the
// "Prompt cache" row, the chip opens that card instead (BotCacheChip). A BB
// without the footer never mounts this, and the context row keeps the chip
// and its details.
import { useEffect, useSyncExternalStore } from "react";
import { useBbContext } from "@get-bb/plugin-sdk/app";
import { BotCacheChip } from "./BotCache";

const mounted = new Map<string, number>();
const subscribers = new Set<() => void>();
const changed = () => { for (const notify of subscribers) notify(); };
const subscribe = (notify: () => void) => { subscribers.add(notify); return () => { subscribers.delete(notify); }; };

/** Whether the footer shows `threadId`'s chip (and so owns its details). */
export function useCacheFooter(threadId: string): { active: boolean } {
  return { active: useSyncExternalStore(subscribe, () => (mounted.get(threadId) ?? 0) > 0, () => false) };
}

export function BotCacheFooter() {
  const { threadId } = useBbContext();
  return threadId ? <Chip threadId={threadId} /> : null;
}

function Chip({ threadId }: { threadId: string }) {
  useEffect(() => {
    mounted.set(threadId, (mounted.get(threadId) ?? 0) + 1);
    changed();
    return () => {
      const left = (mounted.get(threadId) ?? 1) - 1;
      if (left > 0) mounted.set(threadId, left);
      else mounted.delete(threadId);
      changed();
    };
  }, [threadId]);
  return <BotCacheChip threadId={threadId} />;
}
