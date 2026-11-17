import { z } from "zod";

export const THREAD_COMPACT_REASON_MAX = 200;

/**
 * `POST /threads/:id/compact?reason=…`: a compaction bb runs on its own
 * (a plugin's cache warmer, say) rather than one the user asked for. With a
 * reason the turn is the system's, its request carries the subject
 * `{ kind: "compaction", reason }`, and the thread view draws it as one quiet
 * row. Without one it is the user's, as before. The reason is one line of
 * plain text, at most 200 characters: no line breaks, control, format or
 * bidi characters.
 */
export const threadCompactQuerySchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(THREAD_COMPACT_REASON_MAX)
    .regex(/^[^\p{Cc}\p{Cf}\u2028\u2029]+$/u, {
      message: "reason must be one line of plain text",
    })
    .optional(),
});
export type ThreadCompactQuery = z.infer<typeof threadCompactQuerySchema>;
