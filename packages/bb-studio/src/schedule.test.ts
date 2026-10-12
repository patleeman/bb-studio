import { describe, expect, it } from "vitest";
import { compileSchedule, cronField, describeSchedule, endOfDay, fromHeartbeat, runMinutes, WEEKDAYS, ALL_DAYS, type Schedule } from "./schedule";

const crons = (schedule: Schedule) => compileSchedule(schedule, { defaultTimezone: "America/New_York" }).map((t) => (t.triggerType === "schedule" ? t.cron : t.runAt));

describe("compileSchedule", () => {
  it("compiles one time on weekdays to one cron", () => {
    expect(crons({ type: "times", days: WEEKDAYS, times: ["08:00"] })).toEqual(["0 8 * * 1-5"]);
  });
  it("merges times that share a minute; splits ones that don't", () => {
    expect(crons({ type: "times", days: ALL_DAYS, times: ["08:00", "18:00"] })).toEqual(["0 8,18 * * *"]);
    expect(crons({ type: "times", days: [1, 3, 5], times: ["08:00", "18:30"] })).toEqual(["0 8 * * 1,3,5", "30 18 * * 1,3,5"]);
  });
  it("runs an interval within the active window, ends included", () => {
    expect(crons({ type: "interval", every: 2, unit: "hours", days: WEEKDAYS, from: "09:00", to: "17:00" })).toEqual(["0 9,11,13,15,17 * * 1-5"]);
    expect(crons({ type: "interval", every: 15, unit: "minutes", days: ALL_DAYS })).toEqual(["*/15 * * * *"]);
  });
  it("skips quiet hours, across midnight too", () => {
    expect(crons({ type: "interval", every: 30, unit: "minutes", days: ALL_DAYS, quiet: { from: "22:00", to: "07:00" } })).toEqual(["*/30 7-21 * * *"]);
    expect(crons({ type: "times", days: ALL_DAYS, times: ["06:00", "12:00", "23:00"], quiet: { from: "22:00", to: "07:00" } })).toEqual(["0 12 * * *"]);
    expect(crons({ type: "interval", every: 1, unit: "hours", days: ALL_DAYS, quiet: { from: "12:30", to: "13:30" } })).toEqual(["0 0-12,14-23 * * *"]);
  });
  it("splits an interval that doesn't divide the hour into crons that share hours", () => {
    const out = crons({ type: "interval", every: 45, unit: "minutes", days: ALL_DAYS, from: "09:00", to: "12:00" });
    // 9:00 9:45 10:30 11:15 12:00
    expect(out).toEqual(["0 9,12 * * *", "45 9 * * *", "30 10 * * *", "15 11 * * *"]);
  });
  it("refuses empty, impossible and over-split schedules", () => {
    expect(() => crons({ type: "times", days: ALL_DAYS, times: ["23:00"], quiet: { from: "22:00", to: "07:00" } })).toThrow(/Quiet hours cover/);
    expect(() => crons({ type: "times", days: [], times: ["08:00"] })).toThrow(/at least one day/);
    expect(() => crons({ type: "interval", every: 11, unit: "minutes", days: ALL_DAYS })).toThrow(/separate schedules/);
    expect(() => crons({ type: "cron", cron: "0 9 * *" })).toThrow(/five fields/);
    expect(() => compileSchedule({ type: "once", at: 1 })).toThrow(/future/);
  });
  it("passes a raw cron and a one-shot through", () => {
    expect(compileSchedule({ type: "cron", cron: "5  4 * * 0", timezone: "Europe/Paris" })).toEqual([{ triggerType: "schedule", cron: "5 4 * * 0", timezone: "Europe/Paris" }]);
    expect(compileSchedule({ type: "once", at: 2_000 }, { now: 1_000 })).toEqual([{ triggerType: "once", runAt: 2_000 }]);
  });
});

describe("fields and words", () => {
  it("compresses cron fields", () => {
    expect(cronField([0, 1, 2, 3, 4, 5, 6], 0, 6)).toBe("*");
    expect(cronField([0, 20, 40], 0, 59)).toBe("*/20");
    expect(cronField([1, 2, 3, 5], 0, 6)).toBe("1-3,5");
  });
  it("lists the minutes an interval runs", () => {
    expect(runMinutes({ type: "interval", every: 4, unit: "hours", days: ALL_DAYS, from: "08:15", to: "20:00" })).toEqual([495, 735, 975]);
  });
  it("describes schedules", () => {
    expect(describeSchedule({ type: "times", days: WEEKDAYS, times: ["18:00", "08:00"] })).toBe("Weekdays 8:00, 18:00");
    expect(describeSchedule({ type: "interval", every: 30, unit: "minutes", days: ALL_DAYS, quiet: { from: "22:00", to: "07:00" }, until: "2026-12-31" })).toBe("Every 30 min, every day · quiet 22:00–7:00 · until 2026-12-31");
  });
  it("ends a day at midnight in its timezone", () => {
    expect(new Date(endOfDay("2026-10-12", "America/New_York") + 1).toISOString()).toBe("2026-10-13T04:00:00.000Z");
    expect(new Date(endOfDay("2026-01-05", "Asia/Tokyo") + 1).toISOString()).toBe("2026-01-05T15:00:00.000Z");
  });
  it("turns a heartbeat into the same schedule", () => {
    for (const run of [{ cadence: "weekdays", time: "08:00" }, { cadence: "every2hours", time: "09:30" }, { cadence: "custom", time: "09:00", cron: "0 9-17/2 * * 1-5" }, { cadence: "every15minutes", time: "09:00" }]) {
      const expected = { weekdays: "0 8 * * 1-5", every2hours: "30 */2 * * *", custom: "0 9-17/2 * * 1-5", every15minutes: "*/15 * * * *" }[run.cadence];
      expect(crons(fromHeartbeat(run))).toEqual([expected]);
    }
  });
});
