import type { BotAutomationView, RunnerView } from "../../contract";

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

export function sidebarAgenda(items: BotAutomationView[]) {
  const done = (item: BotAutomationView) => item.kind === "reminder" && item.schedule.type === "once" && item.state !== "active";
  return {
    upcoming: items.filter(item => !done(item)).sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name)),
    done: items.filter(done).sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0)),
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
