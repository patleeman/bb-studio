import { z } from "zod";

const ONE_LINE = /^[^\p{Cc}\p{Cf}\u2028\u2029]+$/u;

/**
 * `experimental_notice` on `POST /threads/:id/send`: the message is an
 * automated input (a watcher, a runner report, a check-in, a keepalive),
 * not something the user typed. The turn is the system's, its request
 * carries the subject `{ kind: "automation", source, label }`, and the thread
 * view draws the message as one quiet row named by `label`, with the reply
 * folded in when it is quiet. The input reaches the model unchanged.
 * `source` is one of THREAD_NOTICE_SOURCES; `label` is one line of plain
 * text, at most 120 characters. A notice from another thread
 * (`senderThreadId`) stays that thread's turn; a notice to a thread that
 * hasn't started is sent as an ordinary message, which starts it.
 */
/** Where an automated input comes from; the thread view shows it on the row. */
export const THREAD_NOTICE_SOURCES = [
  "watcher",
  "runner",
  "check-in",
  "reminder",
  "maintenance",
  "resume",
  "schedule",
  "handoff",
  "keepalive",
] as const;

export const threadNoticeSchema = z.object({
  source: z.enum(THREAD_NOTICE_SOURCES),
  label: z.string().trim().min(1).max(120).regex(ONE_LINE),
});
export type ThreadNotice = z.infer<typeof threadNoticeSchema>;

export const forkSendMessageFields = {
  experimental_notice: threadNoticeSchema.optional(),
};
