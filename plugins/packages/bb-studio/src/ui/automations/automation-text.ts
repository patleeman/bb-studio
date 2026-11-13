import { relativeTime } from "../../kit/format";
import type { AutomationTableKind, AutomationTableRow } from "../../automation-table-contract";

export const KIND_LABEL: Record<AutomationTableKind, string> = { watcher: "Watcher", checkin: "Check-in", schedule: "Schedule", reminder: "Reminder", runner: "Runner", bb: "Automation" };

/** "Active", "Paused", "Paused · in bb" or "Off". */
export function statusText(row: Pick<AutomationTableRow, "status" | "inBb">): string {
  if (row.status === "active") return "Active";
  if (row.status === "off") return "Off";
  return row.inBb ? "Paused · in bb" : "Paused";
}

/** "2h ago", or "Never". */
export const lastRunText = (row: Pick<AutomationTableRow, "lastRunAt">, now = Date.now()) => (row.lastRunAt ? relativeTime(row.lastRunAt, now) : "Never");

/** bb's own page for one of its automations (its automations plugin's detail route). */
export const bbDetailPath = (bb: { id: string; projectId: string }) => `/plugins/automations/automations/${encodeURIComponent(bb.projectId)}/${encodeURIComponent(bb.id)}`;
