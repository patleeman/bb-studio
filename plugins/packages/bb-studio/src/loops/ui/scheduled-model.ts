import type { ScheduledItem } from "../scheduled";
import { shortWhen } from "./model";

export const SCHEDULED_ICON: Record<ScheduledItem["kind"], string> = { todo: "ListTodo", checkin: "Clock", reminder: "Bell", watcher: "Eye", runner: "Repeat", schedule: "Calendar", bb: "Workflow" };

export function scheduledMeta(item: Pick<ScheduledItem, "state" | "nextAt" | "scheduleText">, now = Date.now(), zone?: string): string {
  if (item.state === "paused") return "Paused";
  return item.nextAt !== null ? shortWhen(item.nextAt, now, zone) : item.scheduleText;
}
