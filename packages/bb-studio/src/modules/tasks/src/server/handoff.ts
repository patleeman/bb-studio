// How a handed-off thread moves its task. Pure, so every rule is tested
// without BB: the server turns BB's thread events into signals and applies
// what this returns.
import type { HandoffState, TaskStatus } from "../shared";

export type ThreadSignal =
  /** The thread started working (`thread.active`). */
  | { type: "active" }
  /** The agent asked a question or needs a permission (`interaction.pending`). */
  | { type: "needs-input" }
  /** The thread is working and nothing is pending any more. */
  | { type: "input-resolved" }
  /** The agent's turn ended (`thread.idle`). */
  | { type: "idle"; text: string | null }
  | { type: "failed"; error: string | null }
  /** The agent called `tasks_update` with status "review". */
  | { type: "ready"; note: string | null }
  | { type: "archived" }
  | { type: "unarchived" }
  | { type: "deleted" };

export interface Transition {
  state: HandoffState;
  note: string | null;
  /** The task's new status, or null to leave it. */
  status: TaskStatus | null;
}

const NOTE_CHARS = 160;

/**
 * The handoff's next state, and where its task moves, or null when nothing
 * changes. Only the task's latest handoff moves it, and only between In
 * progress and Review: a task you moved to To do or Done yourself stays there.
 */
export function nextHandoff(
  handoff: { state: HandoffState; note: string | null },
  task: { status: TaskStatus },
  latest: boolean,
  signal: ThreadSignal,
): Transition | null {
  const working = latest && (task.status === "in_progress" || task.status === "review");
  const to = (state: HandoffState, note: string | null, status: TaskStatus | null): Transition | null => {
    const moves = status !== null && status !== task.status ? status : null;
    if (state === handoff.state && note === handoff.note && moves === null) return null;
    return { state, note, status: moves };
  };

  switch (signal.type) {
    case "active":
      return to("working", null, working ? "in_progress" : null);
    case "needs-input":
      return to("needs-input", null, null);
    case "input-resolved":
      return handoff.state === "needs-input" ? to("working", null, null) : null;
    case "idle":
      // "Ready" is the agent's own word; ending its turn afterwards doesn't undo it.
      if (handoff.state === "ready") return to("ready", handoff.note, working ? "review" : null);
      return to("replied", firstLine(signal.text), working ? "review" : null);
    case "failed":
      return to("failed", firstLine(signal.error), null);
    case "ready":
      return to("ready", firstLine(signal.note), working ? "review" : null);
    case "archived":
      return to("archived", handoff.note, null);
    case "deleted":
      return to("deleted", handoff.note, null);
    case "unarchived":
      return handoff.state === "archived" ? to("replied", handoff.note, null) : null;
  }
}

/** The first line with words in it, shortened for a card. */
export function firstLine(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const line of text.split("\n")) {
    const clean = line
      .replace(/^[#>*\-\s`]+/, "")
      .replace(/\*\*|__|`/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .trim();
    if (clean) return clean.length > NOTE_CHARS ? `${clean.slice(0, NOTE_CHARS - 1).trimEnd()}…` : clean;
  }
  return null;
}
