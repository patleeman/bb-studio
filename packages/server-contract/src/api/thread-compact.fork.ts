import { z } from "zod";

/**
 * `POST /threads/:id/compact?reason=…`: a compaction bb runs on its own
 * (a plugin's cache warmer, say) rather than one the user asked for. With a
 * reason the turn is the system's, its request carries the subject
 * `{ kind: "compaction", reason }`, and the thread view draws it as one quiet
 * row. Without one it is the user's, as before.
 */
export const threadCompactQuerySchema = z.object({
  reason: z.string().trim().min(1).max(200).optional(),
});
export type ThreadCompactQuery = z.infer<typeof threadCompactQuerySchema>;
