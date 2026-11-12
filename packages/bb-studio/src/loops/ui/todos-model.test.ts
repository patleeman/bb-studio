import { expect, it } from "vitest";
import type { Loop } from "../contract";
import { ALL_AREAS, areaPills, groupTodos, openTodos, todoGroup, todoWhen } from "./todos-model";

// Monday Nov 2, 3 PM local.
const NOW = new Date("2026-11-02T15:00:00").getTime();
const at = (text: string) => new Date(text).getTime();
const loop = (id: string, extra: Partial<Loop> = {}): Loop => ({ id, title: id, why: "", source: null, kind: "do", options: [], owner: "patrick", trigger: { type: "none" }, priority: "normal", push: false, status: "queued", due: null, area: null, createdAt: NOW - 86_400_000, updatedAt: NOW, closedAt: null, closedBy: null, ...extra });

it("puts a todo in Today, This week, Later or Waiting on others by its date and state", () => {
  const group = (extra: Partial<Loop>) => todoGroup(loop("x", extra), NOW);
  // Out now is Today, whatever its due date.
  expect(group({ status: "surfaced", due: at("2026-11-20T09:00:00") })).toBe("today");
  // Overdue and due by the end of today.
  expect(group({ due: at("2026-10-30T09:00:00") })).toBe("today");
  expect(group({ due: at("2026-11-02T23:59:00") })).toBe("today");
  // From tomorrow through the sixth day after today.
  expect(group({ due: at("2026-11-03T00:00:00") })).toBe("week");
  expect(group({ status: "snoozed", trigger: { type: "time", at: at("2026-11-08T23:00:00") } })).toBe("week");
  // A week out, or no date at all.
  expect(group({ due: at("2026-11-09T00:00:00") })).toBe("later");
  expect(group({ trigger: { type: "place", place: "home" } })).toBe("later");
  expect(group({})).toBe("later");
  // The due date wins over when it comes back.
  expect(group({ due: at("2026-11-20T09:00:00"), trigger: { type: "time", at: at("2026-11-02T18:00:00") } })).toBe("later");
  // Someone else's, or a "waiting" todo, waits on others, dated or not.
  expect(group({ kind: "waiting", due: at("2026-11-02T18:00:00") })).toBe("waiting");
  expect(group({ owner: "cos", trigger: { type: "time", at: at("2026-11-02T18:00:00") } })).toBe("waiting");
  expect(group({ owner: "thread:thr_lead", status: "in_progress" })).toBe("waiting");
  // Closed ones are in no group.
  expect(group({ status: "done", closedAt: NOW })).toBeNull();
  expect(group({ status: "dropped", closedAt: NOW })).toBeNull();
});

it("orders each group soonest first, then by priority, and applies the area and search", () => {
  const loops = [
    loop("later_low", { priority: "low" }),
    loop("later_urgent", { priority: "urgent" }),
    loop("week_b", { due: at("2026-11-06T09:00:00"), area: "Job", title: "Draft section 4", why: "budget table" }),
    loop("week_a", { due: at("2026-11-04T09:00:00"), area: "Home" }),
  ];
  const all = groupTodos(loops, { area: ALL_AREAS, query: "" }, NOW);
  expect(all.week.map((each) => each.id)).toEqual(["week_a", "week_b"]);
  expect(all.later.map((each) => each.id)).toEqual(["later_urgent", "later_low"]);
  expect(groupTodos(loops, { area: "Job", query: "" }, NOW).week.map((each) => each.id)).toEqual(["week_b"]);
  // Search reads the title, the description and the area.
  expect(groupTodos(loops, { area: ALL_AREAS, query: "budget section" }, NOW).week.map((each) => each.id)).toEqual(["week_b"]);
});

it("lists every open todo once, and offers the areas in use, the most used first", () => {
  const a = loop("a", { area: "Home" });
  const listed = openTodos({ needsYouNow: [a], comingUp: [a, loop("b", { area: "Job" })], agentsOnIt: [loop("c", { area: "Home" })], waitingOnOthers: [] });
  expect(listed.map((each) => each.id)).toEqual(["a", "b", "c"]);
  expect(areaPills(listed).map((each) => each.label)).toEqual(["All", "Home", "Job"]);
});

it("words the one small when on a row", () => {
  const when = (extra: Partial<Loop>) => todoWhen(loop("x", extra), "Larkspur lead", NOW);
  expect(when({ due: at("2026-11-01T09:00:00") })).toEqual({ text: "Overdue", urgent: true });
  expect(when({ due: at("2026-11-03T09:00:00") })).toEqual({ text: "Due tomorrow", urgent: false });
  expect(when({ trigger: { type: "time", at: at("2026-11-02T18:00:00") } })?.text).toBe("6:00 PM");
  expect(when({ trigger: { type: "event", event: "reply:sam" } })?.text).toBe("When Sam replies");
  expect(when({ kind: "waiting" })?.text).toBe("Since Sun");
  expect(when({ owner: "thread:thr_lead" })?.text).toBe("Larkspur lead");
  expect(when({})).toBeNull();
});
