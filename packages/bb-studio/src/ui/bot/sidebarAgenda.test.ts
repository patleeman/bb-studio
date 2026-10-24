import { expect, it } from "vitest";
import type { BotAutomationView, BotScheduledView, RunnerView } from "../../contract";
import { botItemName, runnerLastRun, sidebarAgenda, sidebarTime } from "./sidebarAgenda";

it("strips only the exact owning Bot prefix", () => {
  expect(botItemName("Dot · Inbox", "Dot")).toBe("Inbox");
  for (const name of ["Scout · Inbox", "Dot· Inbox", "Dot ·Inbox", "dot · Inbox", "Inbox · Dot"]) expect(botItemName(name, "Dot")).toBe(name);
});

const item = (id: string, kind: BotAutomationView["kind"], nextRunAt: number | null, state: BotAutomationView["state"] = "active") => ({
  id, name: id, kind, nextRunAt, state, schedule: { type: "once", at: 1 }, lastRunAt: null,
}) as BotAutomationView;
it("sorts all four kinds together and separates off or finished one-off reminders", () => {
  const agenda = sidebarAgenda([
    item("runner", "runner", 20), item("checkin", "checkin", 10), item("watcher", "watcher", 30), item("reminder", "reminder", 15),
    item("paused", "checkin", null, "paused"), item("off", "reminder", null, "paused"), item("finished", "reminder", null, "done"),
  ]);
  expect(agenda.upcoming.map(x => x.id)).toEqual(["checkin", "reminder", "runner", "watcher", "paused"]);
  expect(agenda.done.map(x => x.id)).toEqual(["off", "finished"]);
});

it("uses time today and weekday plus time on another date", () => {
  const now = new Date(2026, 9, 21, 12).getTime();
  expect(sidebarTime(now, now)).toBe(new Date(now).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" }));
  const tomorrow = now + 86400_000;
  expect(sidebarTime(tomorrow, now)).toBe(new Date(tomorrow).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }));
});

it("describes the last run, including silent runs after an older report and failures", () => {
  const runner = { state: "active", lastRunAt: 200, lastReportAt: 200, lastLevel: "tell" } as RunnerView;
  expect(runnerLastRun(runner).text).toMatch(/reported$/);
  expect(runnerLastRun({ ...runner, lastLevel: "urgent" }).text).toMatch(/reported$/);
  expect(runnerLastRun({ ...runner, lastReportAt: 100 }).text).toMatch(/quiet$/);
  expect(runnerLastRun({ ...runner, lastLevel: "log" }).text).toMatch(/quiet$/);
  expect(runnerLastRun({ ...runner, lastRunStatus: "failed" })).toMatchObject({ text: expect.stringMatching(/failed$/), failed: true });
  expect(runnerLastRun({ ...runner, state: "paused" })).toMatchObject({ text: "paused", failed: false });
  expect(runnerLastRun({ ...runner, lastRunAt: null }).text).toBe("");
});


it("merges plain BB schedules and deduplicates every BB id of a Studio job without comparing names", () => {
  const studio = { ...item("studio-check", "checkin", 20), bbIds: ["bb-am", "bb-pm"] };
  const heartbeat = { ...item("heartbeat", "checkin", 5), original: true, bbIds: ["bb-heartbeat"] };
  const scheduled = (id: string, nextRunAt: number | null, enabled = true, name = id): BotScheduledView => ({ id, kind: "automation", name, cron: "0 * * * *", enabled, nextRunAt });
  const agenda = sidebarAgenda([studio, heartbeat, item("runner", "runner", 30)], [
    scheduled("bb-am", 20), scheduled("bb-pm", 40), scheduled("bb-heartbeat", 5),
    { ...scheduled("heartbeat", null), kind: "heartbeat" },
    scheduled("bb-inbox", 10, true, "Inbox sweep"), scheduled("bb-child", 25),
    scheduled("bb-same-name", 15, true, "studio-check"), scheduled("bb-off", 1, false),
  ]);
  expect(agenda.upcoming.map(each => each.id)).toEqual(["heartbeat", "bb-inbox", "bb-same-name", "studio-check", "bb-child", "runner", "bb-off"]);
  expect(agenda.upcoming.at(-1)).toMatchObject({ state: "paused", nextRunAt: null });
  expect(agenda.done).toEqual([]);
  // Plain BB schedules still render while Studio's separate request is loading.
  expect(sidebarAgenda([], [scheduled("bb-inbox", 10)]).upcoming.map(each => each.name)).toEqual(["bb-inbox"]);
});


it("preserves runner machine metadata in the Schedule agenda", () => {
  const remote = { ...item("remote", "runner", 20), machineName: "red4", machineOffline: true };
  const server = { ...item("server", "runner", 10), machineName: null, machineOffline: false };
  expect(sidebarAgenda([remote, server]).upcoming).toEqual([server, remote]);
});
