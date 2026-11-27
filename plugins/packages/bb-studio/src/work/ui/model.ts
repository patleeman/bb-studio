import type { WorkKind } from "../shared";

export const KIND: Record<WorkKind, { label: string; icon: string }> = {
  worker: { label: "Worker", icon: "Bot" },
  lead: { label: "Lead", icon: "UserRound" },
  release: { label: "Release", icon: "PackageReceive" },
  todo: { label: "Task", icon: "ListTodo" },
  task: { label: "Task", icon: "Workflow" },
};
