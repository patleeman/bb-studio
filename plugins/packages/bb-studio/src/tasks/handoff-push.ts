// The push for a to-do reminder (a loop that came due): BB_LOOP, with its actions.
import type { Loop } from "../loops/contract";
import { loopPushActions } from "../loops/register";
import type { Task } from "./contract";

export function loopPushInput(loop: Loop, bot: { id: string; threadId: string }, task: Pick<Task, "conversation" | "needs"> | null, projectId: string) {
  const body = task?.needs?.trim() || loop.why.trim() || "New on your list";
  return {
    title: loop.title, body, kind: "turn-finished" as const, threadId: bot.threadId, botId: bot.id, conversationId: task?.conversation ?? bot.threadId, projectId,
    category: "BB_LOOP", loopId: loop.id, loopKind: loop.kind, actions: loopPushActions(loop.kind),
    ...(loop.kind === "decide" && loop.options.length ? { options: loop.options.slice(0, 4).map((o) => o.slice(0, 120)) } : {}), coalesceKey: loop.id,
  };
}
