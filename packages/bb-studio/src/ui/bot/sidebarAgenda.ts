import type { BotAutomationView, BotScheduledView, RunnerView } from "../../contract";

/** Only the owning Bot's exact prefix is redundant in its sidebar. */
export function botItemName(name: string, botName: string): string {
  const prefix = `${botName} · `;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

export function sidebarTime(at: number, now = Date.now()): string {
  const date = new Date(at);
  return date.toLocaleString(undefined, {
    ...(date.toDateString() === new Date(now).toDateString() ? {} : { weekday: "short" as const }),
    hour: "numeric", minute: "2-digit",
  });
}

export type SidebarAgendaItem = Pick<BotAutomationView, "id" | "name" | "nextRunAt" | "state" | "lastRunAt" | "scheduleText"> & {
  kind: BotAutomationView["kind"] | BotScheduledView["kind"];
  schedule: BotAutomationView["schedule"] | null;
};

/** Studio schedules can own several BB automations. Prefer the Studio row,
 * then retain plain BB jobs targeting the Bot or its owned threads. */
export function sidebarAgenda(items: BotAutomationView[], scheduled: BotScheduledView[] = []) {
  const represented = new Set(items.flatMap(item => [item.id, ...(item.bbIds ?? [])]));
  const merged: SidebarAgendaItem[] = [...items];
  for (const item of scheduled) {
    if (represented.has(item.id) || (item.kind === "heartbeat" && items.some(studio => studio.original))) continue;
    represented.add(item.id);
    merged.push({
      id: item.id, kind: item.kind, name: item.name,
      nextRunAt: item.enabled ? item.nextRunAt : null,
      state: item.enabled ? "active" : "paused", lastRunAt: null,
      schedule: null, scheduleText: item.cron ?? "",
    });
  }
  const done = (item: SidebarAgendaItem) => item.kind === "reminder" && item.schedule?.type === "once" && item.state !== "active";
  return {
    upcoming: merged.filter(item => !done(item)).sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name)),
    done: merged.filter(done).sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0)),
  };
}

export function runnerLastRun(runner: RunnerView): { text: string; failed: boolean } {
  if (runner.state === "paused") return { text: "paused", failed: false };
  const failed = /fail|error/i.test(runner.lastRunStatus ?? "");
  if (!runner.lastRunAt) return { text: failed ? "failed" : "", failed };
  // A previous report does not describe a later silent run.
  const reported = (runner.lastReportAt ?? 0) >= runner.lastRunAt && (runner.lastLevel === "tell" || runner.lastLevel === "urgent");
  return { text: `${sidebarTime(runner.lastRunAt)} ${failed ? "failed" : reported ? "reported" : "quiet"}`, failed };
}
