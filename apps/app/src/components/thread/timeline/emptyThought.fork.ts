import type { ThreadTimelineViewRow } from "@bb/thread-view";

export function isEmptyThought(row: ThreadTimelineViewRow): boolean {
  if (row.kind !== "system" || row.systemKind !== "operation") return false;
  if (row.operationKind !== "reasoning" || row.status === "pending") return false;
  if (row.contentDeferred === true) return false;
  return (row.detail ?? "").trim().length === 0;
}
