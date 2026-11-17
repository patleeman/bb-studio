import type {
  QueuedMessageSystemNotice,
  ThreadTurnInitiator,
} from "@bb/domain";
import type { SendMessageRequest } from "@bb/server-contract";

type ThreadNotice = NonNullable<SendMessageRequest["experimental_notice"]>;

/**
 * The notice an automated input (`experimental_notice` on send) dispatches
 * with: the turn is the system's (resolveDispatchAuthor) and its request
 * carries `{ kind: "automation", source, label }` for the thread view's quiet
 * row. Null keeps an ordinary send.
 */
export function automationNotice(
  notice: ThreadNotice | undefined,
): QueuedMessageSystemNotice | null {
  if (notice === undefined) return null;
  return {
    kind: "unlabeled",
    subject: { kind: "automation", source: notice.source, label: notice.label },
  };
}

/**
 * An automated input was the user's turn before it was drawn as a quiet row,
 * and it may still ask for approvals as one: its permission escalation stays
 * the user's. Every other system turn keeps upstream's.
 */
export function escalationInitiator(
  initiator: ThreadTurnInitiator,
  notice: QueuedMessageSystemNotice | undefined,
): ThreadTurnInitiator {
  return notice?.subject?.kind === "automation" ? "user" : initiator;
}
