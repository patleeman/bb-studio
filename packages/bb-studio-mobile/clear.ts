// Clearing read notifications. The relay remembers which threads it notified
// the app about; once a thread is read, answered, archived, or deleted (on any
// device), a silent push tells the app to remove that thread's notifications.

/** Thread ids the app has notifications for, with when the latest was sent. */
export type Notified = Record<string, number>;

/** Stop tracking a thread after this long; iOS has usually dropped it by then. */
export const NOTIFIED_TTL_MS = 3 * 86_400_000;
/** Thread ids per clear push, well under APNs' 4 KB payload limit. */
export const CLEAR_BATCH = 100;

export type ThreadReadState = {
  hasPendingInteraction: boolean;
  lastReadAt: number | null;
  latestAttentionAt: number;
  archivedAt: number | null;
  deletedAt: number | null;
};

/** Nothing left to see: read with no open question, or gone. A thread that can't be loaded counts as gone. */
export function settled(thread: ThreadReadState | null): boolean {
  if (!thread || thread.archivedAt !== null || thread.deletedAt !== null) return true;
  return !thread.hasPendingInteraction && (thread.lastReadAt ?? 0) >= thread.latestAttentionAt;
}

/** Adds the threads just notified about. */
export function noteNotified(notified: Notified, threadIds: string[], now: number): Notified {
  const next = { ...notified };
  for (const threadId of threadIds) next[threadId] = now;
  return next;
}

/** Splits tracked threads into those to clear now and those to keep watching. */
export function partition(
  notified: Notified,
  states: Record<string, ThreadReadState | null>,
  now: number,
): { clear: string[]; keep: Notified } {
  const clear: string[] = [];
  const keep: Notified = {};
  for (const [threadId, sentAt] of Object.entries(notified)) {
    if (now - sentAt > NOTIFIED_TTL_MS) continue;
    if (settled(states[threadId] ?? null)) clear.push(threadId);
    else keep[threadId] = sentAt;
  }
  return { clear, keep };
}

/** A silent push: the app removes delivered notifications for these threads. */
export function clearPayload(threadIds: string[]): string {
  return JSON.stringify({ aps: { "content-available": 1 }, clearThreadIds: threadIds });
}
