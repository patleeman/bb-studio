import { z } from "zod";

const ONE_LINE = /^[^\p{Cc}\p{Cf}\u2028\u2029]+$/u;

/**
 * `experimental_notice` on `POST /threads/:id/send`: the message is an
 * automated input (a watcher, a runner report, a check-in, a keepalive),
 * not something the user typed. The turn is the system's, its request
 * carries the subject `{ kind: "automation", source, label }`, and the thread
 * view draws the message as one quiet row named by `label`, with the reply
 * folded in when it is quiet. The input reaches the model unchanged. Each
 * field is one line of plain text: `source` at most 40 characters, `label`
 * at most 120.
 */
export const threadNoticeSchema = z.object({
  source: z.string().trim().min(1).max(40).regex(ONE_LINE),
  label: z.string().trim().min(1).max(120).regex(ONE_LINE),
});
export type ThreadNotice = z.infer<typeof threadNoticeSchema>;

export const forkSendMessageFields = {
  experimental_notice: threadNoticeSchema.optional(),
};
