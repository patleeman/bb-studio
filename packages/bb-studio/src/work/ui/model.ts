import { isFinished, type WorkKind, type WorkState } from "../shared";

export const KIND: Record<WorkKind, { label: string; icon: string }> = {
  worker: { label: "Worker", icon: "Bot" },
  lead: { label: "Lead", icon: "UserRound" },
  release: { label: "Release", icon: "PackageReceive" },
  todo: { label: "Todo", icon: "ListTodo" },
  task: { label: "Task", icon: "Workflow" },
};

export const STATE: Record<WorkState, string> = {
  running: "Running",
  waiting: "Waiting",
  "needs-you": "Needs you",
  done: "Done",
  failed: "Failed",
};

export function shownStep(card: { state: WorkState; step: string | null }): string | null {
  return isFinished(card) ? null : card.step;
}
