import {
  events,
  findLastRootStoredTurnStarted,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  type DbQueryConnection,
} from "@bb/db";
import {
  DEFAULT_SERVICE_TIER,
  THREAD_CONTEXT_CLEAR_OPERATION,
  isStandaloneBuiltinClearCommand,
  isStandaloneBuiltinCompactCommand,
  type PromptInput,
  type PermissionMode,
  type ReasoningLevel,
  type RecordedThreadExecutionOptions,
} from "@bb/domain";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { ApiError } from "../../errors.js";

// A thread moved to another provider (thread-provider-move.fork.ts) records
// a system/operation event whose operation is PROVIDER_MOVE_OPERATION and
// whose metadata is a ProviderMoveRecord. This file only reads the log, so
// the execution plan and the turn-context seam can import it without cycles.

export const PROVIDER_MOVE_OPERATION = "thread/provider-move";
export const DEFAULT_PROVIDER_MOVE_HISTORY_TOKENS = 150_000;

export interface ProviderMoveRecord {
  from: { providerId: string; model: string | null };
  to: {
    providerId: string;
    model: string;
    permissionMode: PermissionMode;
    reasoningLevel: ReasoningLevel;
  };
  historyTokens: number;
  at: string;
  by: string;
  /**
   * required: a plugin that handles provider moves rebuilds history on the
   * first turn, and the turn refuses to start without it. none: the move was
   * forced with no handler; the first turn starts with no history.
   */
  handoff: "required" | "none";
}

export interface StoredProviderMove extends ProviderMoveRecord {
  operationId: string;
  sequence: number;
}

let registeredDb: DbQueryConnection | null = null;
// Whether each thread looked up recently has a move, so the hot paths (every
// turn's execution plan and turn context) query at most once a minute per
// thread for threads that never moved. A committed move sets it at once; the
// expiry picks up events written another way (server move, import).
const MOVE_MEMO_LIMIT = 50_000;
const MOVE_MEMO_TTL_MS = 60_000;
const moveMemo = new Map<string, { moved: boolean; at: number }>();

/** Lets the turn-context seam read moves (server.ts). */
export function registerProviderMoveDb(db: DbQueryConnection | null): void {
  registeredDb = db;
  moveMemo.clear();
  finalStates.clear();
}

/** Called when a move is written. */
export function noteProviderMove(threadId: string): void {
  moveMemo.set(threadId, { moved: true, at: Date.now() });
}

function knownUnmoved(threadId: string): boolean {
  const entry = moveMemo.get(threadId);
  return (
    entry !== undefined &&
    !entry.moved &&
    Date.now() - entry.at < MOVE_MEMO_TTL_MS
  );
}

export function providerMoveDb(): DbQueryConnection | null {
  return registeredDb;
}

function parseRecord(
  data: string,
  sequence: number,
): StoredProviderMove | null {
  try {
    const parsed = JSON.parse(data) as {
      operationId?: unknown;
      metadata?: Partial<ProviderMoveRecord>;
    };
    const meta = parsed.metadata;
    if (
      typeof parsed.operationId !== "string" ||
      !meta ||
      typeof meta.to?.providerId !== "string" ||
      typeof meta.to.model !== "string" ||
      typeof meta.from?.providerId !== "string"
    ) {
      return null;
    }
    return {
      operationId: parsed.operationId,
      sequence,
      from: {
        providerId: meta.from.providerId,
        model: meta.from.model ?? null,
      },
      to: {
        providerId: meta.to.providerId,
        model: meta.to.model,
        permissionMode: meta.to.permissionMode ?? "accept-edits",
        reasoningLevel: meta.to.reasoningLevel ?? "medium",
      },
      historyTokens:
        typeof meta.historyTokens === "number"
          ? meta.historyTokens
          : DEFAULT_PROVIDER_MOVE_HISTORY_TOKENS,
      at: typeof meta.at === "string" ? meta.at : "",
      by: typeof meta.by === "string" ? meta.by : "",
      handoff: meta.handoff === "none" ? "none" : "required",
    };
  } catch {
    return null;
  }
}

/** The thread's newest provider move, or null when it never moved. */
export function getLatestProviderMove(
  db: DbQueryConnection,
  threadId: string,
): StoredProviderMove | null {
  if (knownUnmoved(threadId)) return null;
  const row = db
    .select({ data: events.data, sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "system/operation"),
        sql`json_extract(${events.data}, '$.operation') = ${PROVIDER_MOVE_OPERATION}`,
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  if (moveMemo.size >= MOVE_MEMO_LIMIT) moveMemo.clear();
  moveMemo.set(threadId, { moved: row !== undefined, at: Date.now() });
  return row ? parseRecord(row.data, row.sequence) : null;
}

function hasEventAfter(
  db: DbQueryConnection,
  threadId: string,
  sequence: number,
  types: readonly string[],
): boolean {
  const row = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        gt(events.sequence, sequence),
        sql`${events.type} IN (${sql.join(
          types.map((type) => sql`${type}`),
          sql`, `,
        )})`,
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

export type ProviderMoveState = "pending" | "rebuilt" | "started" | "cleared";
function listRowsAfter(
  db: DbQueryConnection,
  threadId: string,
  sequence: number,
  type: string,
) {
  return db
    .select({
      data: events.data,
      sequence: events.sequence,
      turnId: events.turnId,
    })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, type as "turn/started"),
        gt(events.sequence, sequence),
      ),
    )
    .orderBy(events.sequence)
    .all();
}

function isRealTurnInput(data: string): boolean {
  try {
    const input = (JSON.parse(data) as { input?: unknown }).input;
    if (!Array.isArray(input)) return true;
    const items = input.map((item: PromptInput) =>
      item.type === "text" && !Array.isArray(item.mentions)
        ? { ...item, mentions: [] }
        : item,
    );
    return !(
      isStandaloneBuiltinCompactCommand(items) ||
      isStandaloneBuiltinClearCommand(items)
    );
  } catch {
    return true;
  }
}

/**
 * pending: the provider has not yet accepted a request with real input (not
 * a bare /compact or /clear) made after the newest move. A failed dispatch,
 * a turn the provider never accepted, or a start refused for a missing
 * handoff keep it pending, so the next turn start gets the move again. Once
 * accepted, that request carried the handoff (a required handoff that
 * delivered nothing never starts), so an interrupted turn does not get the
 * history a second time. rebuilt: accepted with a required handoff.
 * started: accepted after a move forced with no handoff. cleared: the user
 * cleared context again after the move.
 */
// rebuilt, started and cleared never go back to pending (edits and forks
// that would cut the accepted turn away are refused), so they are kept per
// move operation and the requests after the move are not read again.
const FINAL_STATE_LIMIT = 50_000;
const finalStates = new Map<string, ProviderMoveState>();

export function providerMoveState(
  db: DbQueryConnection,
  threadId: string,
  move: StoredProviderMove,
): ProviderMoveState {
  const known = finalStates.get(move.operationId);
  if (known !== undefined) return known;
  const state = computeProviderMoveState(db, threadId, move);
  if (state !== "pending") {
    if (finalStates.size >= FINAL_STATE_LIMIT) finalStates.clear();
    finalStates.set(move.operationId, state);
  }
  return state;
}

function computeProviderMoveState(
  db: DbQueryConnection,
  threadId: string,
  move: StoredProviderMove,
): ProviderMoveState {
  // The move and its own clear marker are written in one transaction, so the
  // first clear after the move is the move's; a second one is the user's.
  const clears = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "system/operation"),
        gt(events.sequence, move.sequence),
        sql`json_extract(${events.data}, '$.operation') = ${THREAD_CONTEXT_CLEAR_OPERATION}`,
      ),
    )
    .limit(2)
    .all();
  if (clears.length > 1) return "cleared";
  const realRequestIds = [
    ...listRowsAfter(db, threadId, move.sequence, "client/turn/requested"),
    ...listRowsAfter(db, threadId, move.sequence, "client/thread/start"),
  ]
    .filter((row) => isRealTurnInput(row.data))
    .map((row) => {
      try {
        return (JSON.parse(row.data) as { requestId?: unknown }).requestId;
      } catch {
        return undefined;
      }
    })
    .filter((id): id is string => typeof id === "string");
  if (realRequestIds.length === 0) return "pending";
  const accepted =
    listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
      threadId,
      clientRequestIds: realRequestIds,
      afterSequence: move.sequence,
    }).length > 0;
  if (!accepted) return "pending";
  return move.handoff === "none" ? "started" : "rebuilt";
}

/** The newest move while it is pending, else null. */
export function getPendingProviderMove(
  db: DbQueryConnection,
  threadId: string,
): StoredProviderMove | null {
  const move = getLatestProviderMove(db, threadId);
  if (move === null) return null;
  return providerMoveState(db, threadId, move) === "pending" ? move : null;
}

/**
 * The execution a thread inherits when a turn names none. Turns recorded
 * before the newest move ran on the old provider; their permission mode and
 * reasoning may not exist on the new one, and inheriting them could widen
 * access. Until a turn is requested after the move, the move's own target
 * stands in for the last execution.
 */
export function inheritedExecutionAfterProviderMove(
  db: DbQueryConnection,
  threadId: string,
  last: RecordedThreadExecutionOptions | null,
): RecordedThreadExecutionOptions | null {
  const move = getLatestProviderMove(db, threadId);
  if (move === null) return last;
  if (
    hasEventAfter(db, threadId, move.sequence, [
      "client/turn/requested",
      "client/thread/start",
    ])
  ) {
    return last;
  }
  return {
    model: move.to.model,
    permissionMode: move.to.permissionMode,
    reasoningLevel: move.to.reasoningLevel,
    serviceTier: last?.serviceTier ?? DEFAULT_SERVICE_TIER,
    source: last?.source ?? "client/turn/requested",
  };
}

function refuseCrossing(move: StoredProviderMove, what: string): never {
  throw new ApiError(
    409,
    "crosses_provider_move",
    `${what} reaches back before the thread moved to ${move.to.providerId}; use a point after the first turn on the new provider.`,
    { details: { moveSequence: move.sequence } },
  );
}

/**
 * A fork point (or the end of the thread, when none is named) whose anchor
 * turn is at or before the newest move would fork the old provider's
 * session on the new provider. Refuse it with 409 crosses_provider_move.
 */
export function assertNotBeforeProviderMove(
  db: DbQueryConnection,
  threadId: string,
  sourceSeqEnd: number | undefined,
): void {
  const move = getLatestProviderMove(db, threadId);
  if (move === null) return;
  if (sourceSeqEnd !== undefined && sourceSeqEnd <= move.sequence) {
    refuseCrossing(move, "This fork point");
  }
  const anchor = findLastRootStoredTurnStarted(db, {
    threadId,
    ...(sourceSeqEnd === undefined ? {} : { atOrBeforeSequence: sourceSeqEnd }),
  });
  if (anchor !== null && anchor.sequence <= move.sequence) {
    refuseCrossing(move, "This fork point");
  }
}

/**
 * The edit-message form, on the request the edit resolved to: refuse when
 * that request, or the turn the rewind would return to, is at or before the
 * newest move (it would rewind the old provider's session on the new one
 * and cut the move record away).
 */
export function assertEditTargetAfterProviderMove(
  db: DbQueryConnection,
  threadId: string,
  requestSequence: number,
): void {
  const move = getLatestProviderMove(db, threadId);
  if (move === null) return;
  if (requestSequence <= move.sequence) refuseCrossing(move, "This edit");
  const preceding = findLastRootStoredTurnStarted(db, {
    threadId,
    atOrBeforeSequence: requestSequence - 1,
  });
  if (preceding !== null && preceding.sequence <= move.sequence) {
    refuseCrossing(move, "This edit");
  }
}

/** A restart resume of a request made before the newest move is refused. */
export function assertRequestAfterProviderMove(
  db: DbQueryConnection,
  threadId: string,
  requestSequence: number,
): void {
  const move = getLatestProviderMove(db, threadId);
  if (move !== null && requestSequence <= move.sequence) {
    refuseCrossing(move, "This resume");
  }
}
