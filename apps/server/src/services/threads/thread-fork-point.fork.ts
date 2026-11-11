import { events, getThread, type DbConnection } from "@bb/db";
import type { ExperimentalThreadForkPoint } from "@get-bb/plugin-sdk";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

export function readThreadForkPoint(
  db: DbConnection,
  threadId: string,
): ExperimentalThreadForkPoint | null {
  const thread = getThread(db, threadId);
  if (
    thread === null ||
    thread.originKind !== "fork" ||
    thread.sourceThreadId === null
  ) {
    return null;
  }
  const sourceThreadId = thread.sourceThreadId;
  const sourceEvents = alias(events, "source_events");
  const shared = db
    .select({ turnId: events.turnId, sourceSequence: sourceEvents.sequence })
    .from(events)
    .innerJoin(
      sourceEvents,
      and(
        eq(sourceEvents.threadId, sourceThreadId),
        eq(sourceEvents.turnId, events.turnId),
        eq(sourceEvents.type, "turn/completed"),
      ),
    )
    .where(
      and(eq(events.threadId, threadId), eq(events.type, "turn/completed")),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  if (shared === undefined || shared.turnId === null) {
    return { sourceThreadId, sourceTurnId: null, sourceSequence: null };
  }
  return {
    sourceThreadId,
    sourceTurnId: shared.turnId,
    sourceSequence: shared.sourceSequence,
  };
}
