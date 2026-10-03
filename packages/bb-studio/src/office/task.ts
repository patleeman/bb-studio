import type { z } from "zod";
import type { taskList } from "./module-sources";
import type { workingTaskSchema } from "./contract";

type Task = z.infer<typeof taskList>["tasks"][number];

/** Translate the task engine's handoff states into the office's four states.
 * A pending question must never appear as continuing work. */
export function officeTask(task: Task): z.infer<typeof workingTaskSchema> {
  const state = task.handoff?.state;
  const status = task.status === "done" ? "done"
    : state === "needs-input" || state === "failed" || state === "archived" || state === "deleted" ? "waiting"
    : task.status === "review" || /review/i.test(task.statusLabel) || state === "ready" || state === "replied" ? "review"
    : /wait|block|fail/i.test(state ?? task.status) ? "waiting" : "working";
  return {
    id: task.id, botId: task.assignee?.startsWith("bot:") ? task.assignee.slice(4) : null,
    title: task.title, status, note: task.handoff?.note ?? null,
    recurring: task.recurrence, href: `/plugins/studio/tasks/${task.id}`, updatedAt: task.updatedAt,
  };
}
