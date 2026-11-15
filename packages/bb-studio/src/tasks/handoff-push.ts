import type Database from "better-sqlite3";
import type { Loop } from "../loops/contract";
import { loopPushActions } from "../loops/register";
import { isClosed, needsYou, USER_OWNER, type Task } from "./contract";
import { TaskStore } from "./store";
import { toLoop } from "./views";

export type HandoffPushDeps = {
  db: Database.Database;
  enabled(): boolean;
  quiet(): boolean;
  push(loop: Loop): Promise<void>;
  log?(message: string): void;
};

export function handoffPush(deps: HandoffPushDeps): (task: Task) => void {
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
  return (task) => {
    try {
      if (task.owner !== USER_OWNER || isClosed(task) || !needsYou(task) || !deps.enabled()) return;
      const store = new TaskStore(deps.db);
      const current = store.get(task.id);
      if (deps.quiet() && current.priority !== "urgent") {
        if (!current.attention.push) store.save({ ...current, attention: { ...current.attention, push: true } });
        return;
      }
      store.event(task.id, "notified", { by: "handoff" });
      void deps.push(toLoop(current)).catch((error: unknown) => deps.log?.(`Task ${task.id}: hand-off push failed: ${message(error)}`));
    } catch (error) {
      deps.log?.(`Task ${task.id}: hand-off push failed: ${message(error)}`);
    }
  };
}

export function loopPushInput(loop: Loop, bot: { id: string; threadId: string }, conversation: string | null, projectId: string) {
  return {
    title: loop.title, body: loop.why, kind: "turn-finished" as const, threadId: bot.threadId, botId: bot.id, conversationId: conversation ?? bot.threadId, projectId,
    category: "BB_LOOP", loopId: loop.id, loopKind: loop.kind, actions: loopPushActions(loop.kind),
    ...(loop.kind === "decide" && loop.options.length ? { options: loop.options.slice(0, 4).map((o) => o.slice(0, 120)) } : {}), coalesceKey: loop.id,
  };
}
