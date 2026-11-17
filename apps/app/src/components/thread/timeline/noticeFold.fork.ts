import {
  buildTimelineRowTitle,
  type ThreadTimelineViewRow,
} from "@bb/thread-view";

export interface QuietFoldDetails {
  text: string;
  steps: string[];
  reply: string | null;
}

export interface NoticeFold {
  label: string;
  state: "running" | "done" | "notice" | "failed";
  details: QuietFoldDetails;
  hidden: string[];
}

const BB_HEADER = /^(?:\[bb [^\]\n]*\][ \t]*(?:\r?\n)*)+/u;
const URGENT = /^(?:[^\n:]{0,80}:\s*)?⚠/u;

export function noticeOf(
  row: ThreadTimelineViewRow,
): { source: string; label: string } | null {
  if (row.kind !== "conversation" || row.role !== "user") return null;
  if (row.initiator !== "system") return null;
  const subject = row.systemMessageSubject;
  return subject?.kind === "automation"
    ? { source: subject.source, label: subject.label.trim() }
    : null;
}

function status(row: ThreadTimelineViewRow): string | null {
  return "status" in row && typeof row.status === "string" ? row.status : null;
}

function broken(row: ThreadTimelineViewRow): boolean {
  if (
    row.kind === "system" &&
    (row.systemKind === "error" || row.systemKind === "reconnect")
  ) {
    return true;
  }
  const value = status(row);
  return value === "error" || value === "interrupted";
}

function stepTitle(row: ThreadTimelineViewRow): string | null {
  try {
    const plain = buildTimelineRowTitle(row, {
      summaryStyle: "bundle",
      workStyle: "default",
    }).plain.trim();
    return plain.length > 0 ? plain : null;
  } catch {
    return null;
  }
}

/**
 * An automated input (a system row with an automation subject) and the
 * Bot's turn on it. A quiet reply folds the input, the work and the reply
 * into one "✓ <label> · handled" row; a real reply leaves the turn as it is
 * under a quiet row for the input; a failed or interrupted turn, or an
 * urgent (⚠) input, is never folded.
 */
export function noticeFoldOf(
  rows: readonly ThreadTimelineViewRow[],
  index: number,
  isQuiet: (row: ThreadTimelineViewRow) => boolean,
  streamingAssistantMessageId: string | null,
): NoticeFold | null {
  const message = rows[index];
  if (message === undefined || message.kind !== "conversation") return null;
  const notice = noticeOf(message);
  if (notice === null) return null;
  const text = message.text.replace(BB_HEADER, "").trim();
  const turn: ThreadTimelineViewRow[] = [];
  if (message.turnId !== null) {
    for (let later = index + 1; later < rows.length; later += 1) {
      const row = rows[later]!;
      if (row.kind === "conversation" && row.role === "user") break;
      if (row.turnId === message.turnId) turn.push(row);
    }
  }
  const replies = turn.filter(
    (row) => row.kind === "conversation" && row.role === "assistant",
  );
  const last = replies.at(-1);
  const details: QuietFoldDetails = { text, steps: [], reply: null };
  const base = { details, hidden: [] as string[] };
  if (turn.some(broken))
    return { ...base, label: notice.label, state: "failed" };
  if (last === undefined || last.id === streamingAssistantMessageId) {
    return { ...base, label: notice.label, state: "running" };
  }
  if (URGENT.test(text) || !replies.every(isQuiet)) {
    return { ...base, label: notice.label, state: "notice" };
  }
  const hidden = turn.filter(
    (row) =>
      !(
        row.kind === "system" &&
        row.systemKind === "operation" &&
        (row.operationKind === "warning" ||
          row.operationKind === "deprecation" ||
          row.operationKind === "provider-unhandled" ||
          row.operationKind === "thread-interrupted")
      ),
  );
  return {
    label: `${notice.label} · handled`,
    state: "done",
    details: {
      ...details,
      reply: last.kind === "conversation" ? last.text.trim() : null,
      steps: hidden
        .filter(
          (row) =>
            row.kind !== "conversation" &&
            !(
              row.kind === "system" &&
              row.systemKind === "operation" &&
              row.operationKind === "reasoning"
            ),
        )
        .flatMap((row) => stepTitle(row) ?? []),
    },
    hidden: hidden.map((row) => row.id),
  };
}
