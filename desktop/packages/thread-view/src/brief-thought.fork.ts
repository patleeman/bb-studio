import type { EventProjectionOperationMessage } from "./event-projection-message.js";

export const BRIEF_THOUGHT_MS = 2_000;

export function isBriefThought(message: EventProjectionOperationMessage): boolean {
  if (message.opType !== "reasoning" || message.status !== "completed") return false;
  if (message.completedAt === null || message.startedAt === undefined) return false;
  return message.completedAt - message.startedAt < BRIEF_THOUGHT_MS;
}
