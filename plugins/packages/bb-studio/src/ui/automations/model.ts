import type { ScheduledItem } from "../../loops/scheduled";

export const AUTOMATIONS_TAB = "thread-automations";

export const KIND_LABEL: Record<ScheduledItem["kind"], string> = { todo: "Todo", checkin: "Check-in", reminder: "Reminder", watcher: "Watcher", runner: "Runner", schedule: "Schedule", bb: "bb automation" };

export function wakeLabel(items: readonly Pick<ScheduledItem, "state">[]): string {
  const active = items.filter((item) => item.state === "active").length;
  return `${items.length} scheduled item${items.length === 1 ? "" : "s"} for this thread${active < items.length ? ` (${active} on)` : ""}`;
}
