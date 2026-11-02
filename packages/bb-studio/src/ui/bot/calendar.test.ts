import { describe, expect, it } from "vitest";
import type { Schedule } from "../../schedule";
import { cadenceLabel, calendarDays, calendarWeek, chainGroups, groupName, isFrequent, isGroup, placeBlocks, windowStart, minuteOfDay, occurrences, pausedSources, sourceEvents, windowDays, zonedTime, type CalendarEvent, type CalendarGroup, type CalendarSource } from "./calendar";

const NY = "America/New_York";
const H = 3_600_000, M = 60_000;
/** Wall-clock text of an instant in a zone, for readable expectations. */
const wall = (at: number, zone = NY) => new Date(at).toLocaleString("en-US", { timeZone: zone, weekday: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" });
const source = (over: Partial<CalendarSource>): CalendarSource => ({
  id: "job", name: "Job", kind: "checkin", schedule: null, cron: null, state: "active", nextRunAt: null, threadId: null, scheduleText: "", runs: [], ...over,
});
// Monday 2 November 2026, midnight in New York (the day after DST ends).
const MON = zonedTime(2026, 11, 2, 0, NY);

describe("occurrences", () => {
  it("expands a cron in the window", () => {
    const at = occurrences(source({ cron: "0 13 * * *" }), MON, MON + 3 * 24 * H, NY);
    expect(at.map((each) => wall(each))).toEqual(["Mon 13:00", "Tue 13:00", "Wed 13:00"]);
    // Weekly: Mondays only.
    expect(occurrences(source({ schedule: { type: "cron", cron: "30 9 * * 1", timezone: NY } }), MON, MON + 7 * 24 * H, NY).map((each) => wall(each))).toEqual(["Mon 09:30"]);
  });

  it("expands every-N intervals and times on days", () => {
    const every2h = occurrences(source({ schedule: { type: "interval", every: 2, unit: "hours", days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59", timezone: NY } }), MON, MON + 24 * H, NY);
    expect(every2h).toHaveLength(12);
    expect(wall(every2h[1]!)).toBe("Mon 02:00");
    const every5 = occurrences(source({ schedule: { type: "interval", every: 5, unit: "minutes", days: [1], from: "09:00", to: "10:00", timezone: NY } }), MON, MON + 7 * 24 * H, NY);
    expect(every5).toHaveLength(13);
    const weekdays = occurrences(source({ schedule: { type: "times", days: [1, 2, 3, 4, 5], times: ["08:00", "18:30"], timezone: NY } }), MON, MON + 7 * 24 * H, NY);
    expect(weekdays).toHaveLength(10);
    expect(wall(weekdays.at(-1)!)).toBe("Fri 18:30");
  });

  it("keeps quiet hours and the end date", () => {
    const quiet = occurrences(source({ schedule: { type: "interval", every: 1, unit: "hours", days: [1], from: "00:00", to: "23:59", quiet: { from: "22:00", to: "07:00" }, timezone: NY } }), MON, MON + 24 * H, NY);
    expect(quiet.map((at) => minuteOfDay(at, NY) / 60)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    const until = occurrences(source({ schedule: { type: "times", days: [0, 1, 2, 3, 4, 5, 6], times: ["09:00"], until: "2026-11-03", timezone: NY } }), MON, MON + 7 * 24 * H, NY);
    expect(until.map((at) => wall(at))).toEqual(["Mon 09:00", "Tue 09:00"]);
  });

  it("gives a one-off its one time, and an unreadable schedule its next run", () => {
    expect(occurrences(source({ schedule: { type: "once", at: MON + 15 * H } }), MON, MON + 24 * H, NY)).toEqual([MON + 15 * H]);
    expect(occurrences(source({ schedule: { type: "once", at: MON - H } }), MON, MON + 24 * H, NY)).toEqual([]);
    expect(occurrences(source({ cron: "@weird", nextRunAt: MON + 5 * H }), MON, MON + 24 * H, NY)).toEqual([MON + 5 * H]);
  });

  it("expands in the schedule's own zone and shows it in the viewer's", () => {
    // 09:00 in London is 04:00 in New York.
    const london = occurrences(source({ schedule: { type: "times", days: [1], times: ["09:00"], timezone: "Europe/London" } }), MON, MON + 24 * H, NY);
    expect(wall(london[0]!)).toBe("Mon 04:00");
  });

  it("follows DST: a skipped time runs an hour later, a repeated time once, and wall-clock times stay put", () => {
    // 8 March 2026: New York skips 02:00–03:00.
    const spring = zonedTime(2026, 3, 8, 0, NY);
    const skipped = occurrences(source({ cron: "30 2 * * *" }), spring, spring + 24 * H, NY);
    expect(skipped.map((at) => wall(at))).toEqual(["Sun 03:30"]);
    const daily = occurrences(source({ cron: "0 9 * * *" }), spring - 24 * H, spring + 48 * H, NY);
    expect(daily.map((at) => wall(at))).toEqual(["Sat 09:00", "Sun 09:00", "Mon 09:00"]);
    expect(daily[2]! - daily[1]!).toBe(24 * H);
    expect(daily[1]! - daily[0]!).toBe(23 * H);
    // 1 November 2026: 01:00–02:00 happens twice; the run is the first.
    const fall = zonedTime(2026, 11, 1, 0, NY);
    const twice = occurrences(source({ cron: "30 1 * * *" }), fall, fall + 25 * H, NY);
    expect(twice).toHaveLength(1);
    expect(new Date(twice[0]!).toISOString()).toBe("2026-11-01T05:30:00.000Z");
    // That day has 25 hours.
    const [day] = windowDays(fall + H, 1, NY);
    expect(day!.end - day!.start).toBe(25 * H);
    // Europe too: 29 March 2026 skips 02:00–03:00 in Berlin.
    expect(wall(zonedTime(2026, 3, 29, 150, "Europe/Berlin"), "Europe/Berlin")).toBe("Sun 03:30");
  });
});

describe("events", () => {
  const now = MON + 12 * H;
  const daily: Schedule = { type: "times", days: [0, 1, 2, 3, 4, 5, 6], times: ["09:00", "13:00"], timezone: NY };

  it("links past runs to their thread and marks failed ones with the error", () => {
    const events = sourceEvents(source({ schedule: daily, threadId: "runner-thread", runs: [
      { id: "r1", at: MON + 9 * H + 4_000, status: "failed", outcome: "Failed: provider timed out", threadId: null },
      { id: "r0", at: MON - 15 * H, status: "succeeded", outcome: "Ran", threadId: "t0" },
    ] }), MON, MON + 24 * H, now, NY);
    expect(events.map((event) => [wall(event.at), event.status, event.threadId, event.error])).toEqual([
      ["Mon 09:00", "failed", "runner-thread", "It took too long"],
      ["Mon 13:00", "scheduled", null, null],
    ]);
    const ok = sourceEvents(source({ schedule: daily, runs: [{ id: "r", at: MON + 9 * H, status: "succeeded", outcome: "Woke it: build 418", threadId: "t9" }] }), MON, MON + 24 * H, now, NY)[0]!;
    expect(ok).toMatchObject({ status: "ok", threadId: "t9", outcome: "Woke it: build 418", error: null });
  });

  it("uses a runner's last run when the history doesn't have it, and shows a run going on now", () => {
    const events = sourceEvents(source({ kind: "runner", schedule: daily, threadId: "rt", runs: [], lastRun: { at: MON + 9 * H, status: "error" }, runningSince: now - 5 * M }), MON, MON + 24 * H, now, NY);
    expect(events.map((event) => [wall(event.at), event.status, event.threadId])).toEqual([
      ["Mon 09:00", "failed", "rt"], ["Mon 11:55", "running", "rt"], ["Mon 13:00", "scheduled", null],
    ]);
  });

  it("shows past occurrences as scheduled only without run history", () => {
    const events = sourceEvents(source({ kind: "automation", schedule: null, cron: "0 9,13 * * *", runs: null }), MON, MON + 24 * H, now, NY);
    expect(events.map((event) => [wall(event.at), event.status])).toEqual([["Mon 09:00", "scheduled"], ["Mon 13:00", "scheduled"]]);
  });

  it("drops a paused job's future runs, keeps its past ones, and lists it as paused", () => {
    const paused = source({ id: "p", name: "Release watch", state: "paused", schedule: daily, runs: [{ id: "r", at: MON + 9 * H, status: "succeeded", outcome: "Nothing new", threadId: null }] });
    expect(sourceEvents(paused, MON, MON + 7 * 24 * H, now, NY).map((event) => event.status)).toEqual(["ok"]);
    expect(pausedSources([source({ id: "a" }), paused]).map((each) => each.id)).toEqual(["p"]);
  });

  it("shows a reminder that already fired as its run, not as due again", () => {
    const at = MON + 10 * H;
    const events = sourceEvents(source({ kind: "reminder", state: "done", schedule: { type: "once", at }, runs: [{ id: "r", at: at + 2_000, status: "succeeded", outcome: "Ran", threadId: "bot" }] }), MON, MON + 24 * H, now, NY);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "ok", threadId: "bot" });
  });
});

describe("days", () => {
  it("collapses a job that runs more than eight times a day into a band with its cadence", () => {
    const days = windowDays(MON, 2, NY);
    const sources = [
      source({ id: "hb", schedule: { type: "interval", every: 2, unit: "hours", days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59", timezone: NY } }),
      source({ id: "lunch", cron: "0 13 * * *", schedule: null }),
    ];
    const [mon] = calendarDays(sources, days, MON - H, NY);
    expect(mon!.bands.map((band) => [band.sourceId, band.events.length, band.every])).toEqual([["hb", 12, "every 2 h"]]);
    expect(mon!.singles.map((event) => event.sourceId)).toEqual(["lunch"]);
    // Late in the day only a few runs are left, but its schedule is dense: still a band.
    const [late] = calendarDays(sources, days, MON + 17 * H, NY);
    expect(late!.bands.map((band) => [band.sourceId, band.events.length, band.every])).toEqual([["hb", 3, "every 2 h"]]);
    expect(late!.singles).toEqual([]);
    expect(cadenceLabel([0, 5 * M, 10 * M])).toBe("every 5 min");
    expect(cadenceLabel([0, H, 2 * H])).toBe("hourly");
  });

  const block = (minute: number, id: string, status: "scheduled" | "failed" | "running" | "ok" = "scheduled") => ({ key: id, sourceId: id, at: MON + minute * M, status, outcome: null, error: null, threadId: null, manual: false });
  it("puts blocks that would overlap side by side", () => {
    const { blocks, chips } = placeBlocks([block(540, "a"), block(560, "b"), block(700, "c")], NY, 45);
    expect(blocks.map((each) => [each.event.sourceId, each.lane, each.of, each.folded])).toEqual([["a", 0, 2, false], ["b", 1, 2, false], ["c", 0, 1, false]]);
    expect(chips).toEqual([]);
  });

  it("folds a cluster wider than the day into a +N chip, keeping the failure, then the live run", () => {
    const { blocks, chips } = placeBlocks([block(960, "digest", "ok"), block(974, "probe", "failed"), block(985, "live", "running")], NY, 30, 1);
    expect(blocks.map((each) => [each.event.sourceId, each.lane, each.of, each.folded])).toEqual([["probe", 0, 1, true]]);
    expect(chips.map((chip) => [chip.at, chip.events.map((each) => each.sourceId)])).toEqual([[MON + 960 * M, ["digest", "live"]]]);
    const two = placeBlocks([block(960, "digest", "ok"), block(974, "probe", "failed"), block(985, "live", "running")], NY, 30, 2);
    expect(two.blocks.map((each) => each.event.sourceId)).toEqual(["probe", "live"]);
    expect(two.chips[0]!.events.map((each) => each.sourceId)).toEqual(["digest"]);
  });

  it("pages by as many days as show", () => {
    expect(windowStart(MON, 1, 5) - MON).toBe(5 * 24 * H);
    expect(windowStart(MON, -1, 7) - MON).toBe(-7 * 24 * H);
  });
});

describe("frequent jobs", () => {
  const days = windowDays(MON, 7, NY);
  const ALL = [0, 1, 2, 3, 4, 5, 6] as const;
  it("every 2 hours or more often is frequent; twice a day, a daily or a weekly isn't", () => {
    const at = (job: Partial<CalendarSource>) => occurrences(source(job), MON, MON + 7 * 24 * H, NY);
    expect(isFrequent(at({ schedule: { type: "interval", every: 2, unit: "hours", days: [...ALL], from: "00:00", to: "23:59", timezone: NY } }), days)).toBe(true);
    expect(isFrequent(at({ schedule: { type: "interval", every: 1, unit: "hours", days: [...ALL], from: "00:00", to: "23:59", timezone: NY } }), days)).toBe(true);
    // Working hours only, every 2 hours (9, 11, 13, 15, 17): still frequent.
    expect(isFrequent(at({ cron: "0 9-17/2 * * 1-5" }), days)).toBe(true);
    expect(isFrequent(at({ schedule: { type: "times", days: [...ALL], times: ["08:00", "13:00"], timezone: NY } }), days)).toBe(false);
    expect(isFrequent(at({ cron: "0 13 * * *" }), days)).toBe(false);
    expect(isFrequent(at({ cron: "0 16 * * 5" }), days)).toBe(false);
    // Three a day but 3 hours apart: not frequent.
    expect(isFrequent(at({ schedule: { type: "times", days: [...ALL], times: ["09:00", "12:00", "15:00"], timezone: NY } }), days)).toBe(false);
  });

  it("hidden by default: no band and no block, but listed; shown: a band each day", () => {
    const heartbeat = source({ id: "beat", name: "Systems heartbeat", kind: "watcher", schedule: { type: "interval", every: 2, unit: "hours", days: [...ALL], from: "00:00", to: "23:59", timezone: NY } });
    const daily = source({ id: "daily", name: "Midday check", schedule: { type: "times", days: [...ALL], times: ["13:00"], timezone: NY } });
    const hidden = calendarWeek([heartbeat, daily], days, MON - H, NY, false);
    expect(hidden.frequent).toEqual([{ sourceId: "beat", every: "every 2 h" }]);
    expect(hidden.days.every((day) => !day.bands.length && day.singles.every((event) => event.sourceId === "daily"))).toBe(true);
    const shown = calendarWeek([heartbeat, daily], days, MON - H, NY, true);
    expect(shown.days.every((day) => day.bands.length === 1 && day.bands[0]!.sourceId === "beat")).toBe(true);
    expect(shown.frequent).toEqual(hidden.frequent);
  });
});

describe("15-minute chains", () => {
  const event = (minute: number, sourceId: string, status: CalendarEvent["status"] = "ok"): CalendarEvent => ({ key: `${sourceId}:${minute}`, sourceId, at: MON + minute * M, status, outcome: status === "failed" ? "Failed: couldn't sign in to Wyze" : "Ran", error: status === "failed" ? "couldn't sign in to Wyze" : null, threadId: null, manual: false });

  it("chains each run that starts within 15 minutes of the previous one, so 5:00 and 5:15 join through 5:05 and 5:10", () => {
    const items = chainGroups([event(300, "systems"), event(305, "comms"), event(310, "home"), event(315, "staff"), event(420, "card"), event(780, "staff"), event(780, "house"), event(780, "security")], NY);
    expect(items).toHaveLength(3);
    const [sweep, card, midday] = items as [CalendarGroup, CalendarEvent, CalendarGroup];
    expect(isGroup(sweep) && sweep.events.map((each) => each.sourceId)).toEqual(["systems", "comms", "home", "staff"]);
    expect(sweep.key).toBe("05:00-05:15|comms,home,staff,systems");
    expect(isGroup(card)).toBe(false);
    expect(isGroup(midday) && midday.sourceIds).toEqual(["house", "security", "staff"]);
    // Gaps over 15 minutes break the chain; exactly 15 joins it.
    expect(chainGroups([event(300, "a"), event(316, "b")], NY)).toHaveLength(2);
    expect(chainGroups([event(300, "a"), event(315, "b")], NY)).toHaveLength(1);
  });

  it("the same group on another day has the same key, so a name holds all week", () => {
    const tue = (minute: number, id: string) => ({ ...event(minute, id), at: MON + 24 * H + minute * M });
    const [mon] = chainGroups([event(300, "systems"), event(305, "comms")], NY) as CalendarGroup[];
    const [next] = chainGroups([tue(300, "comms"), tue(305, "systems")], NY) as CalendarGroup[];
    expect(next!.key).toBe(mon!.key);
  });

  it("a failure is never hidden: the group's status is failed, then running, then due", () => {
    const [failed] = chainGroups([event(780, "staff"), event(780, "house"), event(781, "security", "failed")], NY) as CalendarGroup[];
    expect(failed!.status).toBe("failed");
    expect(failed!.events.find((each) => each.status === "failed")!.error).toBe("couldn't sign in to Wyze");
    const [live] = chainGroups([event(780, "staff", "running"), event(785, "house")], NY) as CalendarGroup[];
    expect(live!.status).toBe("running");
    const [due] = chainGroups([event(780, "staff", "scheduled"), event(785, "house", "scheduled")], NY) as CalendarGroup[];
    expect(due!.status).toBe("scheduled");
  });

  it("names a group from its time until it's renamed", () => {
    const [sweep] = chainGroups([event(300, "systems"), event(305, "comms")], NY) as CalendarGroup[];
    expect(groupName(sweep!, NY)).toBe("5 AM checks");
    expect(groupName(sweep!, NY, { [sweep!.key]: "Area sweep" })).toBe("Area sweep");
    const [half] = chainGroups([event(810, "a"), event(815, "b")], NY) as CalendarGroup[];
    expect(groupName(half!, NY)).toBe("1:30 PM checks");
  });
});
