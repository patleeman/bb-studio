import type { ThreadTimelineViewRow } from "@bb/thread-view";

function readsWithItsReply(row: ThreadTimelineViewRow): boolean {
  switch (row.kind) {
    case "conversation":
      return row.role === "assistant";
    case "system":
      return row.systemKind === "operation" && row.operationKind === "reasoning";
    case "work":
    case "turn":
    case "step-summary":
    case "bundle-summary":
      return true;
    default:
      return false;
  }
}

export function unreadDividerTurnStart(
  rows: readonly ThreadTimelineViewRow[],
  index: number,
  cutoffAt: number,
): number {
  const turnId = rows[index]?.turnId ?? null;
  if (index <= 0 || turnId === null) return index;
  let start = index;
  while (start > 0) {
    const previous = rows[start - 1];
    if (previous === undefined || previous.turnId !== turnId) break;
    if (previous.startedAt <= cutoffAt || !readsWithItsReply(previous)) break;
    start -= 1;
  }
  return start;
}
