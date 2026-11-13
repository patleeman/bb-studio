import {
  getThread,
  threads,
  type ApplyThreadLifecycleEventArgs,
  type ApplyThreadLifecycleEventOutcome,
  type DbConnection,
  type DbTransaction,
} from "@bb/db";
import type { ThreadStatus } from "@bb/domain";
import { eq } from "drizzle-orm";
import { announceTurnInterrupted } from "../plugins/fork-plugin-events.js";
import { isQuietTurn } from "./quiet-turn.fork.js";
import { scheduleQueuedTitleRetry } from "./title-retry-queue.fork.js";

export interface ForkLifecycleBefore {
  quietAttentionAt: number;
}

function isConnection(db: DbConnection | DbTransaction): db is DbConnection {
  return "$client" in db;
}

export function forkBeforeLifecycle(
  db: DbConnection | DbTransaction,
  args: ApplyThreadLifecycleEventArgs,
): ForkLifecycleBefore | null {
  if (args.event.type !== "run.succeeded" || !isConnection(db)) return null;
  const thread = getThread(db, args.threadId);
  if (thread === null || thread.status !== "active") return null;
  if (!isQuietTurn(db, { threadId: args.threadId })) return null;
  return { quietAttentionAt: thread.latestAttentionAt };
}

export function forkAfterLifecycle(
  deps: { db: DbConnection | DbTransaction },
  args: ApplyThreadLifecycleEventArgs,
  outcome: ApplyThreadLifecycleEventOutcome,
  previousStatus: ThreadStatus | undefined,
  before: ForkLifecycleBefore | null,
): void {
  if (
    before !== null &&
    outcome.applied &&
    outcome.thread.latestAttentionAt !== before.quietAttentionAt &&
    isConnection(deps.db)
  ) {
    deps.db
      .update(threads)
      .set({ latestAttentionAt: before.quietAttentionAt })
      .where(eq(threads.id, args.threadId))
      .run();
  }
  announceTurnInterrupted(args, outcome, previousStatus);
  if (args.event.type === "run.succeeded" && outcome.applied) {
    scheduleQueuedTitleRetry(args.threadId);
  }
}
