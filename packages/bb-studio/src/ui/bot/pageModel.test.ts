import { describe, expect, it } from "vitest";
import { zonedTime, type CalendarEvent, type CalendarSource } from "./calendar";
import { areaColors, BOT_AREA_COLOR, dismissKey, failedRuns, failedTitle, outcomeWords, recentEntries, statusSentence, upNext } from "./pageModel";

const NY = "America/New_York";
const H = 3_600_000;
// Sunday 1 November 2026, 2:20 PM in New York: the mockups' "now".
const NOW = zonedTime(2026, 11, 1, 14 * 60 + 20, NY);
const TODAY = zonedTime(2026, 11, 1, 0, NY);
/** A wall-clock minute `days` after Sunday (Nov 1 is the day the clocks go back, so hours can't be added). */
const wall = (minute: number, days = 0) => zonedTime(2026, 11, 1 + days, minute, NY);
const source = (over: Partial<CalendarSource>): CalendarSource => ({ id: "job", name: "Job", kind: "checkin", schedule: null, cron: null, state: "active", nextRunAt: null, threadId: null, scheduleText: "", runs: [], ...over });
const run = (id: string, minute: number, status: string, outcome = status === "failed" ? "Failed: couldn't sign in to Wyze" : "Ran") => ({ id, at: wall(minute), status, outcome, threadId: `thr_${id}` });
const event = (sourceId: string, minute: number, status: CalendarEvent["status"], outcome: string | null = "Ran", day = 0): CalendarEvent => ({ key: `${sourceId}:${minute}:${day}`, sourceId, at: wall(minute, day), status, outcome, error: status === "failed" ? (outcome ?? "").replace(/^Failed:?\s*/, "") : null, threadId: null, manual: false });

describe("the status sentence", () => {
  const base = { state: "active" as const, working: 0, needs: 0, next: { name: "Evening wrap-up", at: wall(18 * 60) }, lastRunAt: wall(13 * 60), now: NOW, zone: NY };
  it("busy: what it's working on, what needs you, and the next run", () => {
    expect(statusSentence({ ...base, working: 3, needs: 5 })).toBe("Working on 3 things. 5 things need you. Next: evening wrap-up at 6:00 PM.");
    expect(statusSentence({ ...base, working: 1, needs: 1 })).toBe("Working on 1 thing. 1 thing needs you. Next: evening wrap-up at 6:00 PM.");
  });
  it("quiet: idle since the last run", () => {
    expect(statusSentence(base)).toBe("Idle. All quiet since 1:00 PM. Next: evening wrap-up at 6:00 PM.");
  });
  it("the next run on a later day, and a name that keeps its capitals", () => {
    expect(statusSentence({ ...base, next: { name: "Area sweep", at: wall(5 * 60, 1) } })).toBe("Idle. All quiet since 1:00 PM. Next: area sweep tomorrow at 5:00 AM.");
    expect(statusSentence({ ...base, next: { name: "GB Studio build", at: wall(21 * 60) } })).toContain("Next: GB Studio build at 9:00 PM.");
  });
  it("paused and stopped say so, without a next run", () => {
    expect(statusSentence({ ...base, state: "paused", needs: 2 })).toBe("Paused. Nothing runs until you resume it. 2 things need you.");
    expect(statusSentence({ ...base, state: "stopped" })).toMatch(/^Stopped\./);
  });
});

describe("failed runs in Needs you", () => {
  const security = source({ id: "security", name: "Security", kind: "runner", runs: [run("r2", 13 * 60, "failed"), run("r1", 8 * 60, "succeeded")] });
  it("a job whose latest finished run failed is listed with the failure in plain words", () => {
    const [failed] = failedRuns([security], new Set());
    expect(failed).toMatchObject({ sourceId: "security", runId: "r2", error: "couldn't sign in to Wyze", threadId: "thr_r2" });
    expect(failedTitle(failed!, NOW, NY)).toBe("Security check failed at 1:00 PM");
  });
  it("stays until a later run succeeds; a live or skipped run doesn't clear it", () => {
    expect(failedRuns([{ ...security, runs: [run("r3", 14 * 60, "running"), ...security.runs!] }], new Set())).toHaveLength(1);
    expect(failedRuns([{ ...security, runs: [run("r3", 14 * 60, "skipped"), ...security.runs!] }], new Set())).toHaveLength(1);
    expect(failedRuns([{ ...security, runs: [run("r3", 14 * 60, "succeeded"), ...security.runs!] }], new Set())).toEqual([]);
  });
  it("Patrick's dismissal hides that run only: the next failure shows again", () => {
    expect(failedRuns([security], new Set([dismissKey("security", "r2")]))).toEqual([]);
    expect(failedRuns([{ ...security, runs: [run("r4", 14 * 60, "failed"), ...security.runs!] }], new Set([dismissKey("security", "r2")]))).toHaveLength(1);
  });
});

describe("area colours", () => {
  it("one colour per runner in its order, grey for the Bot's own jobs", () => {
    const colors = areaColors(Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` })));
    expect(new Set([...colors.values()]).size).toBe(9);
    expect(colors.get("")).toBe(BOT_AREA_COLOR);
  });
});

describe("Up next and Recent", () => {
  const sources = [
    source({ id: "systems", name: "Systems", kind: "runner", area: { id: "systems", name: "Systems" } }),
    source({ id: "comms", name: "Comms", kind: "runner", area: { id: "comms", name: "Comms" } }),
    source({ id: "staff", name: "Staff", kind: "runner", area: { id: "staff", name: "Staff" } }),
    source({ id: "house", name: "House", kind: "runner", area: { id: "house", name: "House" } }),
    source({ id: "security", name: "Security", kind: "runner", area: { id: "security", name: "Security" } }),
    source({ id: "wrap", name: "Evening wrap-up" }),
    source({ id: "beat", name: "Systems heartbeat", kind: "watcher", area: { id: "systems", name: "Systems" } }),
  ];
  it("Up next: three rows, frequent jobs skipped, a chain as one row", () => {
    const tomorrow = 1;
    const events = [event("beat", 16 * 60, "scheduled"), event("wrap", 18 * 60, "scheduled"), event("systems", 300, "scheduled", null, tomorrow), event("comms", 305, "scheduled", null, tomorrow), event("staff", 315, "scheduled", null, tomorrow), event("wrap", 18 * 60, "scheduled", null, tomorrow)];
    const rows = upNext(events, sources, new Set(["beat"]), NOW, NY, { "05:00-05:15|comms,staff,systems": "Area sweep" });
    expect(rows.map((row) => [row.name, row.count])).toEqual([["Evening wrap-up", 1], ["Area sweep", 3], ["Evening wrap-up", 1]]);
  });
  it("Recent: a group in one line, its failure in red, and the frequent quiet runs as one muted line", () => {
    const events = [
      event("systems", 300, "ok"), event("comms", 305, "ok", "Woke it: 2 new emails"), event("staff", 315, "ok"),
      event("staff", 780, "ok"), event("house", 780, "ok"), event("security", 781, "failed", "Failed: Couldn't sign in to Wyze"),
      ...[0, 2, 4, 6, 8, 10, 12].map((hour) => event("beat", hour * 60, "ok", "Nothing new")),
      event("wrap", 18 * 60, "scheduled"),
    ];
    const entries = recentEntries({ events, sources, frequent: new Set(["beat"]), reports: [], finished: [{ id: "t1", title: "Set up GB Studio", at: TODAY - 2 * H }], maintenance: [], names: { "05:00-05:15|comms,staff,systems": "Area sweep", "13:00-13:01|house,security,staff": "Midday check" }, now: NOW, zone: NY });
    const text = entries.map((entry) => entry.parts.map((part) => part.text).join(""));
    expect(text[0]).toBe("Midday check: House and Staff quiet. Security couldn't sign in to Wyze.");
    expect(entries[0]!.parts.at(-1)).toEqual({ text: " Security couldn't sign in to Wyze.", tone: "failed" });
    expect(text).toContain("Area sweep: Comms found 2 new emails; Systems and Staff quiet.");
    const frequent = entries.find((entry) => entry.muted)!;
    expect(frequent.parts[0]!.text).toBe("Frequent checks ran 7 times today with nothing to report.");
    expect(text.at(-1)).toBe("Finished Set up GB Studio.");
    // Nothing that hasn't happened yet.
    expect(text.some((line) => line.includes("Evening wrap-up"))).toBe(false);
  });
  it("outcomes read as words, not statuses", () => {
    expect(outcomeWords({ status: "ok", outcome: "Ran", error: null, at: 0 })).toBe("Quiet");
    expect(outcomeWords({ status: "ok", outcome: "Woke it: 4 new, none urgent", error: null, at: 0 })).toBe("4 new, none urgent");
    expect(outcomeWords({ status: "failed", outcome: "Failed: x", error: "couldn't sign in to Wyze", at: 0 })).toBe("couldn't sign in to Wyze");
  });
});
