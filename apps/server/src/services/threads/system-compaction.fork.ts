import type { QueuedMessageSystemNotice } from "@bb/domain";

/**
 * The notice a compaction with a reason dispatches with: the turn is the
 * system's (resolveDispatchAuthor), and its request carries the reason for
 * the thread view's quiet row. Null keeps the user's own compaction.
 */
export function systemCompactionNotice(
  reason: string | null | undefined,
): QueuedMessageSystemNotice | null {
  if (reason === null || reason === undefined) return null;
  return { kind: "unlabeled", subject: { kind: "compaction", reason } };
}
