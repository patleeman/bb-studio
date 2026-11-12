import { expect, it, vi } from "vitest";
vi.mock("../live", () => ({ useLive: () => ({ data: null }), useCall: () => async () => ({}) }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_Icon: () => null }));
const { calendarSources, plainSchedule } = await import("./AutomationsCalendar");

const job = (id: string, kind: string, name: string, extra: Record<string, unknown> = {}) => ({ id, kind, name, original: false, instruction: "", schedule: { type: "times", days: [0], times: ["05:05"] }, scheduleText: "Every day 5:05 AM", state: "active", nextRunAt: null, lastRunAt: null, lastOutcome: null, model: null, script: null, target: "main", targetName: "Dot", threadId: null, ...extra }) as never;

it("a runner is its own area, a watcher that wakes it is the runner's, the Bot's jobs have none; a runner's report is its run's outcome", () => {
  const sources = calendarSources(
    [job("comms", "runner", "Comms", { target: "own" }), job("beat", "watcher", "Comms heartbeat", { target: "comms", targetName: "Comms" }), job("card", "checkin", "Morning card")],
    [],
    { comms: [{ id: "r1", at: 1_000, status: "succeeded", manual: false, outcome: "Ran", threadId: "t" }, { id: "r0", at: -86_400_000, status: "succeeded", manual: false, outcome: "Ran", threadId: "t" }] },
    [{ id: "comms", name: "Comms", threadId: "thr_comms", lastRunAt: 1_000, lastReport: "2 new emails", lastReportAt: 61_000 }],
  );
  expect(sources.map((source) => source.area?.name ?? null)).toEqual(["Comms", "Comms", null]);
  const runs = sources.find((source) => source.id === "comms")!.runs!;
  expect(runs.find((run) => run.id === "r1")!.outcome).toBe("Woke it: 2 new emails");
  expect(runs.find((run) => run.id === "r0")!.outcome).toBe("Ran");
});

it("never shows a raw cron", () => {
  expect(plainSchedule("Custom: 0 9 1-7 * 6")).toBe("Custom schedule");
  expect(plainSchedule("Weekdays 11:00 AM")).toBe("Weekdays 11:00 AM");
});
