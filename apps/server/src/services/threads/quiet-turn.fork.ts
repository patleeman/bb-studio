import type { ForkThreadIdlePayload } from "@get-bb/plugin-sdk";
import type { AppDeps } from "../../types.js";
import { getLatestTurnFinalOutput, getTurnFinalOutput } from "./thread-data.js";
import { classifyTurn } from "./turn-classifiers.fork.js";

export function isQuietTurn(
  db: AppDeps["db"],
  args: { threadId: string; turnId?: string },
): boolean {
  try {
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
