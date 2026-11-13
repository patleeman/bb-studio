// Which threads are a Bot's (its conversations and the workers they
// started), as far as this window has learned: the sidebar's lists and each
// thread header's owner lookup record what they load. A message's menu reads
// it synchronously while the message renders.
import { useSyncExternalStore } from "react";

const owned = new Map<string, boolean>();
const listeners = new Set<() => void>();

export function noteBotThread(threadId: string, isBots: boolean): void {
  if (owned.get(threadId) === isBots) return;
  owned.set(threadId, isBots);
  for (const listener of listeners) listener();
}

export function useIsBotThread(threadId: string): boolean {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => owned.get(threadId) === true, () => false);
}

/** True once the thread is known to be a Bot's; false while unknown. */
export function isBotThread(threadId: string): boolean {
  return owned.get(threadId) === true;
}

export function mayBeBotThread(threadId: string): boolean {
  return owned.get(threadId) !== false;
}

export function resetBotThreadsForTest(): void {
  owned.clear();
}
