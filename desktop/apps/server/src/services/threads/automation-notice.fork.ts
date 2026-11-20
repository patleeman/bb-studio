import type {
  QueuedMessageSystemNotice,
  Thread,
  ThreadTurnInitiator,
} from "@bb/domain";
import type { SendMessageRequest } from "@bb/server-contract";

type ThreadNotice = NonNullable<SendMessageRequest["experimental_notice"]>;

/** Where an automated input comes from; the thread view shows it on the row. */
export const THREAD_NOTICE_SOURCES: readonly string[] = [
  "watcher",
  "runner",
  "check-in",
  "reminder",
  "maintenance",
  "resume",
  "schedule",
  "handoff",
  "keepalive",
];

/**
 * The notice an automated input (`experimental_notice` on send) dispatches
 * with: its request carries `{ kind: "automation", source, label }` for the
 * thread view's quiet row. Null keeps an ordinary send, and so does a thread
 * that hasn't started yet (pending, or with no environment): its first
 * message goes as before, which starts it, instead of waiting for one. A
 * source BB doesn't know (a newer or older plugin's) drops the notice too:
 * the message still arrives, as an ordinary one.
 */
export function automationNotice(
  notice: ThreadNotice | undefined,
  thread: Pick<Thread, "status" | "environmentId">,
): QueuedMessageSystemNotice | null {
  if (notice === undefined) return null;
  if (!THREAD_NOTICE_SOURCES.includes(notice.source)) return null;
  if (thread.status === "pending" || thread.environmentId === null) return null;
  return {
    kind: "unlabeled",
    subject: { kind: "automation", source: notice.source, label: notice.label },
  };
}

function isAutomation(
  notice: QueuedMessageSystemNotice | null | undefined,
): boolean {
  return notice?.subject?.kind === "automation";
}

/**
 * Whether a send's notice makes its author the system. An automated input
 * another thread sent (a runner's report) stays that thread's: the agent's
 * turn, with its sender, as without the notice. Every other notice is the
 * system's.
 */
export function systemAuthored(
  notice: QueuedMessageSystemNotice | null | undefined,
  senderThreadId: string | null | undefined,
): boolean {
  if (notice === null || notice === undefined) return false;
  return !(isAutomation(notice) && senderThreadId);
}

/**
 * A queued row goes out as the message it was (its sender, model and
 * settings) unless it is one of core's own notices: an automated input is a
 * message with a notice, not a core notice.
 */
export function sendsAsQueuedMessage(
  notice: QueuedMessageSystemNotice | null,
): boolean {
  return notice === null || isAutomation(notice);
}

/**
 * Studio's own automated input (no sender) was the user's turn before it was
 * drawn as a quiet row, and may still ask for approvals as one. Another
 * thread's input stays the agent's (deny). Every other system turn keeps
 * upstream's.
 */
export function escalationInitiator(
  initiator: ThreadTurnInitiator,
  notice: QueuedMessageSystemNotice | undefined,
): ThreadTurnInitiator {
  return initiator === "system" && isAutomation(notice) ? "user" : initiator;
}
