import type { Thread } from "@bb/domain";
import { ApiError } from "../../errors.js";

export const THREAD_READ_ONLY_ERROR_CODE = "thread_read_only";

export interface ForkThreadWriteRefusal {
  reason: string;
  message: string;
}

export type ForkThreadWriteGuard = (
  thread: Thread,
) => ForkThreadWriteRefusal | null;

const guards = new Set<ForkThreadWriteGuard>();

export function registerForkThreadWriteGuard(
  guard: ForkThreadWriteGuard,
): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

export function ensureForkThreadWritable(thread: Thread): void {
  for (const guard of guards) {
    const refusal = guard(thread);
    if (refusal === null) continue;
    throw new ApiError(409, THREAD_READ_ONLY_ERROR_CODE, refusal.message, {
      details: { reason: refusal.reason, threadId: thread.id },
    });
  }
}
