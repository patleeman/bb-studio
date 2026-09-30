// Small pieces the board, the task view and the reply card share.
import { Badge, Icon, cn } from "@bb-studio/kit/app";
import { HANDOFF_SHORT, HANDOFF_TONES, formatDue, isOpenHandoff, isOverdue, type Assignee, type TaskStatus } from "../src/shared";
import type { Handoff } from "./types";

/** The handed-off thread's state, while it can still change the task. */
export function HandoffBadge({ handoff, status, className }: { handoff: Handoff | null; status: TaskStatus; className?: string }) {
  if (!handoff || status === "done" || !isOpenHandoff(handoff.state)) return null;
  return <Badge label={HANDOFF_SHORT[handoff.state]} tone={HANDOFF_TONES[handoff.state]} className={className} />;
}

export function DueChip({ due, status, className }: { due: string | null; status: TaskStatus; className?: string }) {
  if (!due) return null;
  const late = isOverdue(due, status);
  return (
    <span
      title={late ? `Overdue: due ${due}` : `Due ${due}`}
      className={cn("inline-flex items-center gap-1 text-xs", late ? "font-medium text-destructive" : "text-muted-foreground", className)}
    >
      <Icon name="Calendar" className="size-3.5" />
      {formatDue(due)}
    </span>
  );
}

export function AssigneeChip({ assignee, className }: { assignee: Assignee; className?: string }) {
  if (!assignee) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)} title={assignee === "me" ? "Assigned to you" : "Assigned to an agent"}>
      <Icon name={assignee === "me" ? "UserRound" : "Bot"} className="size-3.5" />
      {assignee === "me" ? "Me" : "Agent"}
    </span>
  );
}

export const ASSIGNEE_OPTIONS: { value: Assignee; label: string; icon: string }[] = [
  { value: null, label: "Unassigned", icon: "Circle" },
  { value: "me", label: "Me", icon: "UserRound" },
  { value: "agent", label: "Agent", icon: "Bot" },
];

export const STATUS_ICONS: Record<TaskStatus, string> = {
  todo: "Circle",
  in_progress: "Clock",
  review: "Eye",
  done: "CircleCheck",
};
