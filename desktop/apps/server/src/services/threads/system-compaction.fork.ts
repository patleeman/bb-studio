import type { DbConnection } from "@bb/db";
import type { QueuedMessageSystemNotice } from "@bb/domain";
import {
  wasFailedTurnInputAccepted,
  type FailedTurnRecord,
} from "./turn-failed.js";

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

/**
 * A retry of a compaction bb ran on its own keeps its reason when it sends
 * the same /compact again (the failed input was never accepted). A retry
 * that continues an accepted turn sends a continuation, not a compaction,
 * so it carries no reason.
 */
export function retrySystemCompactionNotice(
  db: DbConnection,
  args: { threadId: string; failed: FailedTurnRecord },
): QueuedMessageSystemNotice | null {
  const { request } = args.failed;
  const subject = request.systemMessageSubject;
  if (request.initiator !== "system" || subject?.kind !== "compaction") {
    return null;
  }
  if (wasFailedTurnInputAccepted(db, args)) return null;
  return systemCompactionNotice(subject.reason);
}
