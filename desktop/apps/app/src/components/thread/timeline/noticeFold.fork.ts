import {
  buildTimelineRowTitle,
  type ThreadTimelineViewRow,
} from "@bb/thread-view";

export interface QuietFoldDetails {
  text: string;
  steps: string[];
  reply: string | null;
  full?: boolean;
}

export interface NoticeFold {
  label: string;
  state: "running" | "done" | "notice" | "failed" | "alert";
  details: QuietFoldDetails;
  hidden: string[];
  hideRow: boolean;
}

const SOURCE_TITLES: Record<string, string> = {
  watcher: "Watcher",
  runner: "Runner",
  "check-in": "Check-in",
  reminder: "Reminder",
  maintenance: "Maintenance",
  resume: "Resume",
  schedule: "Schedule",
  handoff: "Handoff",
  keepalive: "Keepalive",
};

const BB_HEADER = /^(?:\[bb [^\]\n]*\][ \t]*(?:\r?\n)*)+/u;
const LEAD_IN =
  /^(?:⚠️?\s*)?(?:Watcher [^:\n]+: |From runner [^:\n]+: |(?:Check-in|Reminder) "[^"\n]*"(?: \([^)\n]*\))?: )/u;
const URGENT = /^(?:[^\n:]{0,80}:\s*)?⚠/u;
const CRITICAL = /\bCRITICAL\b|\[critical\]/u;
const SUMMARY_LIMIT = 100;

export function noticeOf(
  row: ThreadTimelineViewRow,
): { source: string; label: string } | null {
  if (row.kind !== "conversation" || row.role !== "user") return null;
  if (row.initiator !== "system" && row.initiator !== "agent") return null;
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

function firstLine(text: string): string {
  const line =
    text
      .replace(LEAD_IN, "")
      .split(/\r?\n/u)
      .find((each) => each.trim().length > 0)
      ?.replace(/\s+/gu, " ")
      .trim() ?? "";
  return line.length > SUMMARY_LIMIT
    ? `${line.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`
    : line;
}

/** "Watcher Kensico health · 2 warnings on red4": the source, the label and the input's first line. */
export function noticeHeadline(
  notice: { source: string; label: string },
  text: string,
  withLine = true,
): string {
  const title = SOURCE_TITLES[notice.source] ?? notice.source;
  const name =
    notice.label === ""
      ? title
      : notice.label.toLowerCase().includes(title.toLowerCase())
        ? notice.label
        : `${title} ${notice.label}`;
  const summary = withLine ? firstLine(text) : "";
  return summary ? `${name} · ${summary}` : name;
}

/**
 * An automated input (a system or agent row with an automation subject) and
 * the Bot's turn on it.
 * - An urgent (⚠) or critical input, or a failed turn, draws in full and
 *   folds nothing.
 * - A quiet reply folds the input, the work and the reply into one
 *   "<source> <label> · <first line> · handled" row; a quiet keepalive
 *   leaves no row at all.
 * - A real reply, a turn that ended with no text, or an input steered into
 *   another turn draws one quiet row and hides nothing.
 * - The latest turn of an active thread with no reply yet is running.
 */
export function noticeFoldOf(
  rows: readonly ThreadTimelineViewRow[],
  index: number,
  isQuiet: (row: ThreadTimelineViewRow) => boolean,
  streamingAssistantMessageId: string | null,
  active: boolean,
): NoticeFold | null {
  const message = rows[index];
  if (message === undefined || message.kind !== "conversation") return null;
  const notice = noticeOf(message);
  if (notice === null) return null;
  const text = message.text.replace(BB_HEADER, "").trim();
  const headline = noticeHeadline(notice, text);
  const quietRow = (
    state: NoticeFold["state"],
    details: Partial<QuietFoldDetails> = {},
  ): NoticeFold => ({
    label: details.full ? noticeHeadline(notice, text, false) : headline,
    state,
    details: { text, steps: [], reply: null, ...details },
    hidden: [],
    hideRow: false,
  });
  const turn: ThreadTimelineViewRow[] = [];
  let later = index + 1;
  if (message.turnId !== null) {
    for (; later < rows.length; later += 1) {
      const row = rows[later]!;
      if (row.kind === "conversation" && row.role === "user") break;
      if (row.turnId === message.turnId) turn.push(row);
    }
  }
  if (URGENT.test(text) || CRITICAL.test(text.split("\n")[0] ?? "")) {
    return quietRow("alert", { full: true });
  }
  if (turn.some(broken)) return quietRow("failed", { full: true });
  if (message.turnRequest?.kind === "steer") return quietRow("notice");
  const replies = turn.filter(
    (row) => row.kind === "conversation" && row.role === "assistant",
  );
  const last = replies.at(-1);
  const latest = later >= rows.length;
  if (
    (last === undefined && active && latest) ||
    (last !== undefined && last.id === streamingAssistantMessageId)
  ) {
    return quietRow("running");
  }
  if (last === undefined || !replies.every(isQuiet)) return quietRow("notice");
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
  const hiddenIds = hidden.map((row) => row.id);
  if (notice.source === "keepalive") {
    return { ...quietRow("done"), hidden: hiddenIds, hideRow: true };
  }
  return {
    ...quietRow("done", {
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
    }),
    label: `${headline} · handled`,
    hidden: hiddenIds,
  };
}
