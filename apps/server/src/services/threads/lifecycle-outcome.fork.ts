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
  previousStatus: ThreadStatus | undefined;
  quietAttentionAt: number | null;
}

const READS_PREVIOUS_THREAD = new Set([
  "run.succeeded",
  "run.failed",
  "stop.settled",
]);

function isConnection(db: DbConnection | DbTransaction): db is DbConnection {
  return "$client" in db;
}

export function forkBeforeLifecycle(
  db: DbConnection | DbTransaction,
  args: ApplyThreadLifecycleEventArgs,
): ForkLifecycleBefore | null {
  if (!READS_PREVIOUS_THREAD.has(args.event.type)) return null;
  const thread = getThread(db, args.threadId);
  const quiet =
    args.event.type === "run.succeeded" &&
    isConnection(db) &&
    thread?.status === "active" &&
    isQuietTurn(db, { threadId: args.threadId });
  return {
    previousStatus: thread?.status,
    quietAttentionAt: quiet ? thread.latestAttentionAt : null,
  };
}

export function forkAfterLifecycle(
  deps: { db: DbConnection | DbTransaction },
  args: ApplyThreadLifecycleEventArgs,
  outcome: ApplyThreadLifecycleEventOutcome,
  before: ForkLifecycleBefore | null,
): void {
  if (
    before !== null &&
    before.quietAttentionAt !== null &&
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
  announceTurnInterrupted(args, outcome, before?.previousStatus);
  if (args.event.type === "run.succeeded" && outcome.applied) {
    scheduleQueuedTitleRetry(args.threadId);
  }
}
