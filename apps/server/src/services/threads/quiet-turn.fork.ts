import {
  findLastRootStoredTurnStarted,
  getStoredTurnRequestEventForTurn,
} from "@bb/db";
import type { ForkThreadIdlePayload } from "@get-bb/plugin-sdk";
import type { AppDeps } from "../../types.js";
import { getLatestTurnFinalOutput, getTurnFinalOutput } from "./thread-data.js";
import { parseStoredTurnRequestEvent } from "./thread-events.js";
import { classifyTurn } from "./turn-classifiers.fork.js";

function isSystemCompactionTurn(
  db: AppDeps["db"],
  args: { threadId: string; turnId?: string },
): boolean {
  const turnId =
    args.turnId ??
    findLastRootStoredTurnStarted(db, { threadId: args.threadId })?.turnId;
  if (turnId === undefined) return false;
  const row = getStoredTurnRequestEventForTurn(db, {
    threadId: args.threadId,
    turnId,
  });
  if (row === null) return false;
  const request = parseStoredTurnRequestEvent(row);
  return (
    request.initiator === "system" &&
    request.systemMessageSubject?.kind === "compaction"
  );
}

export function isQuietTurn(
  db: AppDeps["db"],
  args: { threadId: string; turnId?: string },
): boolean {
  try {
    if (isSystemCompactionTurn(db, args)) return true;
    return classifyTurn({
      threadId: args.threadId,
      finalOutput:
        args.turnId === undefined
          ? getLatestTurnFinalOutput(db, args.threadId)
          : getTurnFinalOutput(db, {
              threadId: args.threadId,
              turnId: args.turnId,
            }),
    }).quiet;
  } catch {
    return false;
  }
}

export function forkIdleFields(
  db: AppDeps["db"],
  threadId: string,
): ForkThreadIdlePayload {
  return { experimental_quiet: isQuietTurn(db, { threadId }) };
}
