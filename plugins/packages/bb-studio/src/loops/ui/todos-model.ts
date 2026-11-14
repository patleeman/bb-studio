// The Todos page's rules, pure so they are tested directly
// (todos-model.test.ts): which of the four groups an open todo goes in
// (Today, This week, Later, Waiting on others), the one small "when" its row
// shows, the area pills, and the search. Times read in Todos' time zone when
// one is passed, else in the browser's.
import type { Loop } from "../contract";
import { dayNumber } from "../clock";
import { PRIORITY_RANK, dueLabel, eventLabel, placeLabel, shortWhen } from "./model";

export type TodoGroupId = "today" | "week" | "later" | "waiting";

export const TODO_GROUPS: readonly { id: TodoGroupId; title: string }[] = [
  { id: "today", title: "Today" },
  { id: "week", title: "This week" },
  { id: "later", title: "Later" },
  { id: "waiting", title: "Waiting on others" },
];


/** The date a todo is for: its due date, else the time it is set to come back. */
export function todoDate(loop: Pick<Loop, "due" | "trigger">): number | null {
  if (loop.due !== null) return loop.due;
  return loop.trigger.type === "time" && loop.trigger.at !== undefined ? loop.trigger.at : null;
}

/**
 * The group of an open todo; null for a closed one. Someone else's (an
 * agent's, the Bot's) and "waiting" todos wait on others. One of the user's
 * that is out now is Today; else its date sorts it: up to the end of today
 * (overdue included) Today, within seven days This week, past that or with
 * no date Later.
 */
export function todoGroup(loop: Loop, now = Date.now(), zone?: string): TodoGroupId | null {
  if (loop.closedAt !== null || loop.status === "done" || loop.status === "dropped") return null;
  if (loop.kind === "waiting" || loop.owner !== "patrick") return "waiting";
  if (loop.status === "surfaced") return "today";
  const at = todoDate(loop);
  if (at === null) return "later";
  const days = dayNumber(at, zone) - dayNumber(now, zone);
  if (days < 1) return "today";
  if (days < 7) return "week";
  return "later";
}

/** The todos the page lists: every open one from loops.list, once. */
export function openTodos(groups: { needsYouNow: Loop[]; comingUp: Loop[]; agentsOnIt: Loop[]; waitingOnOthers: Loop[] }): Loop[] {
  const seen = new Set<string>();
  return [...groups.needsYouNow, ...groups.comingUp, ...groups.agentsOnIt, ...groups.waitingOnOthers].filter((loop) => !seen.has(loop.id) && !!seen.add(loop.id));
}

/** Search: every word in the title, the description, the area or the source. */
export function todoMatches(loop: Loop, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [loop.title, loop.why, loop.area ?? "", loop.source?.ref ?? ""].join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

/** The area pills: All, then the areas of the todos listed, the most used first. */
export function areaPills(loops: readonly Loop[]): { id: string; label: string }[] {
  const counts = new Map<string, number>();
  for (const loop of loops) if (loop.area) counts.set(loop.area, (counts.get(loop.area) ?? 0) + 1);
  const areas = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([area]) => ({ id: area, label: area }));
  return [{ id: ALL_AREAS, label: "All" }, ...areas];
}

export const ALL_AREAS = "all";

/** Open todos in the four groups, in order, each soonest first; areas and search applied. */
export function groupTodos(loops: readonly Loop[], filters: { area: string; query: string }, now = Date.now(), zone?: string): Record<TodoGroupId, Loop[]> {
  const out: Record<TodoGroupId, Loop[]> = { today: [], week: [], later: [], waiting: [] };
  for (const loop of loops) {
    if (filters.area !== ALL_AREAS && loop.area !== filters.area) continue;
    if (!todoMatches(loop, filters.query)) continue;
    const group = todoGroup(loop, now, zone);
    if (group) out[group].push(loop);
  }
  const order = (a: Loop, b: Loop) => (todoDate(a) ?? Infinity) - (todoDate(b) ?? Infinity) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt;
  for (const id of Object.keys(out) as TodoGroupId[]) out[id].sort(order);
  return out;
}

/**
 * The one small "when" on a todo's row, and whether it presses: its due
 * date ("Overdue", "Due today", "Due Fri"), else when it comes back ("3:00
 * PM", "Fri", "When you get home"); a todo waiting on others says since when
 * or who has it.
 */
export function todoWhen(loop: Loop, owner: string, now = Date.now(), zone?: string): { text: string; urgent: boolean } | null {
  const due = dueLabel(loop.due, now, zone);
  if (due) return due;
  const { trigger } = loop;
  if (trigger.type === "time" && trigger.at !== undefined) return { text: shortWhen(trigger.at, now, zone), urgent: false };
  if (trigger.type === "place" && trigger.place) return { text: placeLabel(trigger.place, trigger.direction), urgent: false };
  if (trigger.type === "event" && trigger.event) return { text: eventLabel(trigger.event, trigger.label), urgent: false };
  if (loop.kind === "waiting") return { text: `Since ${shortWhen(loop.createdAt, now, zone)}`, urgent: false };
  if (loop.owner !== "patrick") return { text: owner, urgent: false };
  return null;
}
