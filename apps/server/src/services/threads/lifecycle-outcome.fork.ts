import {
  getThread,
  threads,
  type DbConnection,
  type DbTransaction,
} from "@bb/db";
import { eq } from "drizzle-orm";
import { announceTurnInterrupted } from "../plugins/fork-plugin-events.js";
import type { ThreadLifecycleEffect } from "./lifecycle/machine.js";
import { isQuietTurn } from "./quiet-turn.fork.js";
import { scheduleQueuedTitleRetry } from "./title-retry-queue.fork.js";

type ThreadRow = NonNullable<ReturnType<typeof getThread>>;

function completedTurnId(
  effects: readonly ThreadLifecycleEffect[],
): string | null {
  for (const effect of effects) {
    if (
      effect.kind === "turn-ended" &&
      effect.status === "completed" &&
      (effect.disposition === "applied" || effect.disposition === "released")
    ) {
      return effect.turnId;
    }
  }
  return null;
}

function keepQuietTurnRead(
  db: DbTransaction,
  before: ThreadRow,
  after: ThreadRow,
  turnId: string,
): ThreadRow {
  if (
    before.status !== "active" ||
    after.latestAttentionAt === before.latestAttentionAt ||
    !isQuietTurn(db as unknown as DbConnection, {
      threadId: after.id,
      turnId,
    })
  ) {
    return after;
  }
  db.update(threads)
    .set({ latestAttentionAt: before.latestAttentionAt })
    .where(eq(threads.id, after.id))
    .run();
  return { ...after, latestAttentionAt: before.latestAttentionAt };
}

export function forkAfterLifecycle(
  db: DbTransaction,
  before: ThreadRow,
  after: ThreadRow,
  effects: readonly ThreadLifecycleEffect[],
): ThreadRow {
  const turnId = completedTurnId(effects);
  announceTurnInterrupted(before, after, turnId !== null);
  if (turnId === null) return after;
  scheduleQueuedTitleRetry(after.id);
  return keepQuietTurnRead(db, before, after, turnId);
}
