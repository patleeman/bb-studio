import { describe, expect, it } from "vitest";
import { ALL_DAYS, WEEKDAYS, type Schedule } from "../schedule";
import { nextRun, parseCron, zonedTimes } from "./next-run";

const NY = "America/New_York";
const at = (iso: string) => Date.parse(iso);
const next = (schedule: Schedule, after: string, zone = "UTC") => { const found = nextRun(schedule, at(after), zone); return found === null ? null : new Date(found).toISOString(); };

describe("nextRun", () => {
  it("keeps a daily time at the same wall-clock time across both daylight-saving changes", () => {
    const daily: Schedule = { type: "times", days: ALL_DAYS, times: ["09:00"] };
    // Clocks go forward on 8 March 2026: 9:00 is 14:00Z the day before, 13:00Z after.
    expect(next(daily, "2026-03-06T15:00:00Z", NY)).toBe("2026-03-07T14:00:00.000Z");
    expect(next(daily, "2026-03-07T15:00:00Z", NY)).toBe("2026-03-08T13:00:00.000Z");
    expect(next(daily, "2026-03-08T13:00:00Z", NY)).toBe("2026-03-09T13:00:00.000Z");
    // And back on 1 November 2026.
    expect(next(daily, "2026-10-30T14:00:00Z", NY)).toBe("2026-10-31T13:00:00.000Z");
    expect(next(daily, "2026-10-31T14:00:00Z", NY)).toBe("2026-11-01T14:00:00.000Z");
  });

  it("runs a time the clocks skip when the gap ends, and a time they repeat only once", () => {
    // 02:30 does not exist on 8 March in New York: it runs at 03:30 EDT.
    expect(next({ type: "times", days: ALL_DAYS, times: ["02:30"] }, "2026-03-08T05:00:00Z", NY)).toBe("2026-03-08T07:30:00.000Z");
    // 01:30 happens twice on 1 November: the first one runs, the second does not.
    const early: Schedule = { type: "times", days: ALL_DAYS, times: ["01:30"] };
    expect(next(early, "2026-11-01T04:00:00Z", NY)).toBe("2026-11-01T05:30:00.000Z");
    expect(next(early, "2026-11-01T05:30:00Z", NY)).toBe("2026-11-02T06:30:00.000Z");
    expect(zonedTimes(2026, 11, 1, 1, 30, NY).map((each) => new Date(each).toISOString())).toEqual(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]);
  });

  it("runs only on the chosen days, at each time in order", () => {
    const weekdays: Schedule = { type: "times", days: WEEKDAYS, times: ["18:30", "08:00"] };
    // 10 November 2026 is a Tuesday.
    expect(next(weekdays, "2026-11-10T07:00:00Z")).toBe("2026-11-10T08:00:00.000Z");
    expect(next(weekdays, "2026-11-10T08:00:00Z")).toBe("2026-11-10T18:30:00.000Z");
    expect(next(weekdays, "2026-11-13T18:30:00Z")).toBe("2026-11-16T08:00:00.000Z");
    expect(next({ type: "times", days: [0], times: ["09:00"] }, "2026-11-15T09:00:00Z")).toBe("2026-11-22T09:00:00.000Z");
  });

  it("uses the schedule's own time zone before the default one", () => {
    expect(next({ type: "times", days: ALL_DAYS, times: ["09:00"], timezone: "Asia/Tokyo" }, "2026-11-10T12:00:00Z", NY)).toBe("2026-11-11T00:00:00.000Z");
  });

  it("runs an interval only inside its window and on its days", () => {
    const working: Schedule = { type: "interval", every: 2, unit: "hours", days: WEEKDAYS, from: "09:00", to: "17:00" };
    expect(next(working, "2026-11-10T12:00:00Z")).toBe("2026-11-10T13:00:00.000Z");
    expect(next(working, "2026-11-10T17:00:00Z")).toBe("2026-11-11T09:00:00.000Z");
    expect(next(working, "2026-11-13T17:00:00Z")).toBe("2026-11-16T09:00:00.000Z");
    const odd: Schedule = { type: "interval", every: 45, unit: "minutes", days: ALL_DAYS, from: "09:00", to: "11:00" };
    expect(next(odd, "2026-11-10T09:45:00Z")).toBe("2026-11-10T10:30:00.000Z");
    expect(next(odd, "2026-11-10T10:30:00Z")).toBe("2026-11-11T09:00:00.000Z");
  });

  it("skips quiet hours, also when they wrap midnight", () => {
    const quiet: Schedule = { type: "interval", every: 15, unit: "minutes", days: ALL_DAYS, from: "00:00", to: "23:59", quiet: { from: "22:00", to: "07:00" } };
    expect(next(quiet, "2026-11-10T21:40:00Z")).toBe("2026-11-10T21:45:00.000Z");
    expect(next(quiet, "2026-11-10T21:50:00Z")).toBe("2026-11-11T07:00:00.000Z");
    expect(next({ type: "times", days: ALL_DAYS, times: ["23:00"], quiet: { from: "22:00", to: "07:00" } }, "2026-11-10T21:50:00Z")).toBeNull();
  });

  it("stops after the end date, through the end of that day in the zone", () => {
    const ending: Schedule = { type: "times", days: ALL_DAYS, times: ["23:00"], until: "2026-11-10" };
    expect(next(ending, "2026-11-10T12:00:00Z")).toBe("2026-11-10T23:00:00.000Z");
    expect(next(ending, "2026-11-10T23:00:00Z")).toBeNull();
    expect(next({ ...ending, until: "2026-11-09" }, "2026-11-10T12:00:00Z")).toBeNull();
    // 23:00 on the 10th in New York is 04:00Z on the 11th: still inside the end date there.
    expect(next(ending, "2026-11-11T01:00:00Z", NY)).toBe("2026-11-11T04:00:00.000Z");
    expect(next({ type: "cron", cron: "0 9 * * *", until: "2026-11-09" }, "2026-11-10T12:00:00Z")).toBeNull();
  });

  it("runs a one-time schedule at its time if that is still ahead", () => {
    const once: Schedule = { type: "once", at: at("2026-11-10T15:00:00Z") };
    expect(next(once, "2026-11-10T12:00:00Z")).toBe("2026-11-10T15:00:00.000Z");
    expect(next(once, "2026-11-10T15:00:00Z")).toBeNull();
    expect(next(once, "2026-11-11T00:00:00Z")).toBeNull();
  });

  it("runs */15 * * * * on the quarter hours, and through a repeated hour", () => {
    const quarter: Schedule = { type: "cron", cron: "*/15 * * * *" };
    expect(next(quarter, "2026-11-10T12:07:30Z")).toBe("2026-11-10T12:15:00.000Z");
    expect(next(quarter, "2026-11-10T12:15:00Z")).toBe("2026-11-10T12:30:00.000Z");
    expect(next(quarter, "2026-11-10T23:50:00Z")).toBe("2026-11-11T00:00:00.000Z");
    // 01:50 EDT on the fall-back night: the next quarter hour is 01:00 EST, ten minutes later.
    expect(next(quarter, "2026-11-01T05:50:00Z", NY)).toBe("2026-11-01T06:00:00.000Z");
    // And the hour the clocks skip in spring is not waited for.
    expect(next(quarter, "2026-03-08T06:50:00Z", NY)).toBe("2026-03-08T07:00:00.000Z");
  });

  it("runs 0 9 * * 1-5 on weekday mornings in the zone", () => {
    const mornings: Schedule = { type: "cron", cron: "0 9 * * 1-5" };
    expect(next(mornings, "2026-11-10T12:00:00Z", NY)).toBe("2026-11-10T14:00:00.000Z");
    expect(next(mornings, "2026-11-13T15:00:00Z", NY)).toBe("2026-11-16T14:00:00.000Z");
    expect(next({ type: "cron", cron: "0 9 * * MON-FRI" }, "2026-11-13T15:00:00Z", NY)).toBe("2026-11-16T14:00:00.000Z");
    expect(next({ type: "cron", cron: "0 9 * * 7" }, "2026-11-10T12:00:00Z")).toBe("2026-11-15T09:00:00.000Z");
  });

  it("matches the day of month and the weekday as cron does: either when both are set, each alone otherwise", () => {
    const either: Schedule = { type: "cron", cron: "0 0 13 * 5" };
    // The 13th or a Friday: Friday 11 December, then Sunday the 13th.
    expect(next(either, "2026-12-05T00:00:00Z")).toBe("2026-12-11T00:00:00.000Z");
    expect(next(either, "2026-12-11T00:00:00Z")).toBe("2026-12-13T00:00:00.000Z");
    expect(next({ type: "cron", cron: "0 0 13 * *" }, "2026-11-13T00:00:00Z")).toBe("2026-12-13T00:00:00.000Z");
    expect(next({ type: "cron", cron: "30 6 1 JAN,JUL *" }, "2026-11-10T00:00:00Z")).toBe("2027-01-01T06:30:00.000Z");
    expect(next({ type: "cron", cron: "0 12 29 2 *" }, "2026-11-10T00:00:00Z")).toBe("2028-02-29T12:00:00.000Z");
  });

  it("has no next time for a cron that never matches or isn't one", () => {
    expect(next({ type: "cron", cron: "0 0 31 2 *" }, "2026-11-10T00:00:00Z")).toBeNull();
    expect(next({ type: "cron", cron: "0 9 * * 1#2" }, "2026-11-10T00:00:00Z")).toBeNull();
    expect(parseCron("0 9 * *")).toBeNull();
    expect(parseCron("61 9 * * *")).toBeNull();
  });
});
