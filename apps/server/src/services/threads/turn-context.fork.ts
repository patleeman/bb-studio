import {
  isStandaloneBuiltinClearCommand,
  isStandaloneBuiltinCompactCommand,
  type PromptInput,
} from "@bb/domain";
import type {
  ExperimentalTurnContextProvider,
  ExperimentalTurnContextProviderMove,
} from "@get-bb/plugin-sdk";
import {
  getActiveStoredTurnId,
  getThread,
  type DbQueryConnection,
} from "@bb/db";
import { ApiError } from "../../errors.js";
import {
  getPendingProviderMove,
  providerMoveDb,
} from "./provider-move-state.fork.js";

export const TURN_CONTEXT_TIMEOUT_MS = 500;
export const TURN_CONTEXT_MAX_CHARS = 8000;
// The first turn after a provider move carries rebuilt history: a larger
// budget (about 4 characters per history token) and more time to answer.
export const TURN_CONTEXT_MOVE_TIMEOUT_MS = 5000;
export const TURN_CONTEXT_MOVE_MAX_CHARS_CEILING = 1_200_000;

function moveMaxCharsCeiling(): number {
  const raw = Number(process.env.BB_PROVIDER_MOVE_CONTEXT_MAX_CHARS);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : TURN_CONTEXT_MOVE_MAX_CHARS_CEILING;
}

export function turnContextMoveMaxChars(historyTokens: number): number {
  return Math.min(
    Math.max(
      TURN_CONTEXT_MAX_CHARS,
      Math.ceil(historyTokens * 4) + TURN_CONTEXT_MAX_CHARS,
    ),
    moveMaxCharsCeiling(),
  );
}

interface PendingTurnContextMove extends ExperimentalTurnContextProviderMove {
  handoff: "required" | "none";
}

/** The pending provider move for this thread, if any (provider-move-state.fork.ts). */
export function pendingTurnContextMove(
  threadId: string,
): PendingTurnContextMove | null {
  const db = providerMoveDb();
  if (db === null) return null;
  const move = getPendingProviderMove(db, threadId);
  if (move === null) return null;
  return {
    operationId: move.operationId,
    from: move.from,
    to: {
      providerId: move.to.providerId,
      model: move.to.model,
      permissionMode: move.to.permissionMode,
    },
    historyTokens: move.historyTokens,
    at: move.at,
    handoff: move.handoff,
  };
}

export interface TurnContextProviderOptions {
  /**
   * The plugin rebuilds history after a provider move. Only these providers
   * get `providerMove`, the larger budget and the longer wait; a move is
   * refused unless one is registered (or forced).
   */
  providerMove?: boolean;
}

interface RegisteredProvider {
  provider: ExperimentalTurnContextProvider;
  providerMove: boolean;
}

const providers = new Map<string, RegisteredProvider>();

export function registerTurnContextProvider(
  pluginId: string,
  provider: ExperimentalTurnContextProvider,
  options: TurnContextProviderOptions = {},
): () => void {
  const entry = { provider, providerMove: options.providerMove === true };
  providers.set(pluginId, entry);
  return () => {
    if (providers.get(pluginId) === entry) providers.delete(pluginId);
  };
}

/** Whether any plugin has said it rebuilds history after a provider move. */
export function hasProviderMoveHandler(): boolean {
  for (const entry of providers.values()) {
    if (entry.providerMove) return true;
  }
  return false;
}

function bounded(text: unknown, maxChars: number): string | null {
  if (typeof text !== "string" || maxChars <= 0) return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return trimmed.length > maxChars
    ? `${trimmed.slice(0, maxChars - 1)}…`
    : trimmed;
}

async function withDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function contextItem(pluginId: string, text: string): PromptInput {
  return {
    type: "text",
    text: `Context from the ${pluginId} plugin at the start of this turn:\n\n${text}`,
    mentions: [],
    visibility: "agent-only",
  };
}

export interface CollectedTurnContext {
  /** History rebuilt by providers that handle moves: goes before the input. */
  move: PromptInput[];
  /**
   * A move handler answered with a string, even an empty one ("delivered,
   * nothing to add": an empty or just-cleared thread). null, undefined, a
   * throw or a timeout are not an answer.
   */
  moveAnswered: boolean;
  /** Everyone else's per-turn context: goes after the input. */
  other: PromptInput[];
}

/**
 * Asks every provider for this turn's context. Ordinary providers get 500 ms
 * and 8000 characters. On a turn with a pending provider move, providers
 * registered with { providerMove: true } also get `providerMove`, 5 s, and
 * share one budget of about historyTokens × 4 characters (plugin-id order).
 */
export async function collectTurnContextParts(
  threadId: string,
  providerMove: ExperimentalTurnContextProviderMove | null = null,
  moveOnly = false,
): Promise<CollectedTurnContext> {
  if (providers.size === 0) return { move: [], other: [], moveAnswered: false };
  const entries = [...providers.entries()]
    .filter(([, entry]) => !moveOnly || entry.providerMove)
    .sort(([a], [b]) => a.localeCompare(b));
  const raw = await Promise.all(
    entries.map(async ([pluginId, entry]) => {
      const handlesMove = providerMove !== null && entry.providerMove;
      try {
        const answer = await withDeadline(
          Promise.resolve(
            entry.provider(
              handlesMove ? { threadId, providerMove } : { threadId },
            ),
          ),
          handlesMove ? TURN_CONTEXT_MOVE_TIMEOUT_MS : TURN_CONTEXT_TIMEOUT_MS,
        );
        return { pluginId, handlesMove, answer };
      } catch {
        return { pluginId, handlesMove, answer: undefined };
      }
    }),
  );
  let moveBudget =
    providerMove === null
      ? 0
      : turnContextMoveMaxChars(providerMove.historyTokens);
  const result: CollectedTurnContext = {
    move: [],
    other: [],
    moveAnswered: false,
  };
  for (const { pluginId, handlesMove, answer } of raw) {
    if (handlesMove) {
      if (typeof answer === "string") result.moveAnswered = true;
      const text = bounded(answer, moveBudget);
      if (text === null) continue;
      moveBudget -= text.length;
      result.move.push(contextItem(pluginId, text));
    } else {
      const text = bounded(answer, TURN_CONTEXT_MAX_CHARS);
      if (text !== null) result.other.push(contextItem(pluginId, text));
    }
  }
  return result;
}

/** All context items in delivery order (move history first). */
export async function collectTurnContext(
  threadId: string,
  providerMove: ExperimentalTurnContextProviderMove | null = null,
): Promise<PromptInput[]> {
  const parts = await collectTurnContextParts(threadId, providerMove);
  return [...parts.move, ...parts.other];
}

/**
 * Whether a turn submit gets turn context. "start": yes, from every plugin.
 * A steer: never. "auto" (the composer's steer-if-active on an existing
 * session): only "move-only", and only while a provider move is pending, the
 * thread is not active and no turn is running, so it will start the turn
 * that must carry the history; then only move handlers are asked. Ordinary
 * per-turn context stays start-only, and an auto send racing a just
 * dispatched first turn (active, no turn/started yet) gets nothing.
 */
export function startsTurnForTurnContext(
  db: DbQueryConnection,
  threadId: string,
  mode: string,
): boolean | "move-only" {
  if (mode === "start") return true;
  if (mode !== "auto") return false;
  if (getThread(db, threadId)?.status === "active") return false;
  if (getActiveStoredTurnId(db, threadId) !== null) return false;
  return pendingTurnContextMove(threadId) !== null ? "move-only" : false;
}

// Handoff refusals per move operation, to point at the waiver once the
// history plugin keeps failing. In memory: a restart starts the count over.
const HANDOFF_FAILURE_HINT_AFTER = 3;
const handoffFailures = new Map<string, number>();

interface TurnPrompt {
  input: PromptInput[];
  inputGroups?: PromptInput[][];
}

export async function withTurnContext<T extends TurnPrompt>(
  threadId: string,
  prompt: T,
  startsTurn: boolean | "move-only" = true,
): Promise<T> {
  if (!startsTurn || prompt.input.length === 0) return prompt;
  if (
    isStandaloneBuiltinCompactCommand(prompt.input) ||
    isStandaloneBuiltinClearCommand(prompt.input)
  ) {
    return prompt;
  }
  const move = pendingTurnContextMove(threadId);
  const {
    move: history,
    other,
    moveAnswered,
  } = await collectTurnContextParts(threadId, move, startsTurn === "move-only");
  if (move !== null && move.handoff === "required" && !moveAnswered) {
    // Starting now would run the new provider with no history and could mark
    // the move done. Fail this start; the move stays pending for the retry.
    const failures = (handoffFailures.get(move.operationId) ?? 0) + 1;
    if (handoffFailures.size > 10_000) handoffFailures.clear();
    handoffFailures.set(move.operationId, failures);
    const waive = `\`bbs thread move-provider ${threadId} --to ${move.to.providerId} --model ${move.to.model} --force\``;
    throw new ApiError(
      503,
      "handoff_unavailable",
      failures >= HANDOFF_FAILURE_HINT_AFTER
        ? `Thread ${threadId} moved to ${move.to.providerId}, and its history has not been delivered ${String(failures)} times in a row; the plugin that rebuilds it may be down. Start without the history with ${waive} (keeps the move, waives the history) or \`bbs thread clear ${threadId}\`, or fix the plugin and try again.`
        : `Thread ${threadId} moved to ${move.to.providerId} and no plugin delivered its history for this turn. Try again; or start without the history: ${waive} (keeps the move, waives the history) or \`bbs thread clear ${threadId}\`.`,
      { retryable: true },
    );
  }
  if (history.length === 0 && other.length === 0) return prompt;
  const groups = prompt.inputGroups;
  return {
    ...prompt,
    input: [...history, ...prompt.input, ...other],
    ...(groups !== undefined && groups.length > 0
      ? {
          inputGroups: groups.map((group, index) => [
            ...(index === 0 ? history : []),
            ...group,
            ...(index === groups.length - 1 ? other : []),
          ]),
        }
      : {}),
  };
}
