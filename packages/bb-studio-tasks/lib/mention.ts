import { untitled } from "@bb-studio/kit/format";
// Pure helper: the agent-visible context for a task mention. Kept free of bb
// imports so it can be unit-tested standalone.
import { HANDOFF_LABELS, STATUS_LABELS, formatDue, taskHref, type Assignee, type HandoffState, type TaskStatus } from "../src/shared";

export interface MentionTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  due: string | null;
  assignee: Assignee;
  priority?: string;
  labels?: string[];
  recurrence?: string | null;
  parentId?: string | null;
  subtasks?: { total: number; done: number };
  reminderAt?: number | null;
  handoff: { state: HandoffState; note: string | null } | null;
  /** Labels of what the task links to. */
  links: string[];
}

export function mentionContext(task: MentionTask, now = new Date()): string {
  const title = untitled(task.title);
  const facts = [STATUS_LABELS[task.status]];
  if (task.assignee) facts.push(task.assignee === "me" ? "assigned to the user" : "assigned to an agent");
  if (task.due) facts.push(`due ${formatDue(task.due, now)} (${task.due})`);
  if (task.priority && task.priority !== "none") facts.push(`${task.priority} priority`);
  if (task.labels?.length) facts.push(`labels ${task.labels.join(", ")}`);
  if (task.recurrence) facts.push(`repeats ${task.recurrence}`);
  if (task.parentId) facts.push(`subtask of ${task.parentId}`);
  if (task.subtasks?.total) facts.push(`${task.subtasks.done}/${task.subtasks.total} subtasks done`);
  if (task.reminderAt) facts.push(`reminder ${new Date(task.reminderAt).toISOString()}`);
  const lines = [
    `Studio task "${title}" (id ${task.id}): ${facts.join(", ")}.`,
    `Link to it in replies as [${title.replace(/[[\]]/g, "")}](${taskHref(task.id)}).`,
  ];
  if (task.description) lines.push(`Description:\n${task.description}`);
  if (task.links.length) lines.push(`Linked: ${task.links.join(", ")}`);
  if (task.handoff) lines.push(`Its thread: ${HANDOFF_LABELS[task.handoff.state]}${task.handoff.note ? `. ${task.handoff.note}` : ""}`);
  lines.push(`Read more with tasks_get, and change it with tasks_update (id "${task.id}").`);
  return lines.join("\n\n");
}
