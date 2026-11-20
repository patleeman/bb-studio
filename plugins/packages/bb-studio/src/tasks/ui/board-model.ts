import { addDays, wall } from "../../loops/clock";
import { eventLabel, PRIORITY_RANK } from "../../loops/ui/model";
import { isClosed, needsYou, USER_OWNER, type Task } from "../contract";
import { taskDate, taskSection } from "./model";
import { areaOrder } from "../../areas/ui/model";
import type { AreaView } from "../../areas/contract";

export type RowRef = { id: string; home: string | null; under: string | null; depth: number; open: boolean; workers: string[]; hasWorkers: boolean; needsYou: boolean; startedAt?: number; stalled?: boolean };
export type WorkerInfo = { threadId: string; name: string; status: string | null; archived: boolean };
export type RowsData = { rows: readonly RowRef[]; tasks: readonly Task[]; workers?: readonly WorkerInfo[] };

export type FlightNode = { row: RowRef; task: Task; children: FlightNode[]; workers: WorkerInfo[] };

export function treeOf(data: RowsData): FlightNode[] {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const workers = new Map((data.workers ?? []).map((w) => [w.threadId, w]));
  const nodes = new Map<string, FlightNode>();
  const roots: FlightNode[] = [];
  for (const row of data.rows) {
    const task = byId.get(row.id);
    if (!task) continue;
    const node: FlightNode = { row, task, children: [], workers: row.workers.map((id) => workers.get(id) ?? { threadId: id, name: "A worker thread", status: null, archived: false }) };
    nodes.set(row.id, node);
    const parent = row.under ? nodes.get(row.under) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function countBelow(node: FlightNode): { subtasks: number; workers: number } {
  let subtasks = 0;
  const workers = new Set(node.workers.map((w) => w.threadId));
  const walk = (n: FlightNode) => { for (const c of n.children) { subtasks += 1; for (const w of c.workers) workers.add(w.threadId); walk(c); } };
  walk(node);
  return { subtasks, workers: workers.size };
}

export const isUserTodo = (t: Task) => t.owner === USER_OWNER && t.kind !== "waiting-outside";

export function pageFlight(data: RowsData): FlightNode[] {
  const nodes = treeOf(data).filter((n) => n.row.open && !isUserTodo(n.task));
  return [...nodes.filter(isRunning), ...nodes.filter((n) => !isRunning(n))];
}

export type TodoBox = { asks: Task[]; today: Task[]; later: Task[] };

export function todoBox(tasks: readonly Task[], now: number, zone?: string): TodoBox {
  const open = tasks.filter((t) => !isClosed(t) && isUserTodo(t) && t.automation?.role !== "schedule");
  const asks = open.filter(needsYou).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt);
  const rest = open.filter((t) => !needsYou(t));
  const soonest = (a: Task, b: Task) => (taskDate(a) ?? Infinity) - (taskDate(b) ?? Infinity) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt;
  const today = rest.filter((t) => taskSection(t, now, zone) === "today").sort(soonest);
  const later = rest.filter((t) => taskSection(t, now, zone) !== "today").sort(soonest);
  return { asks, today, later };
}

export const TODO_ROWS = 7;

export type AreaAsk = { key: string; areaId: string; area: string; title: string; since: string | null; sinceAt: number | null; taskId: string | null };

export function areaAsks(areas: readonly Pick<AreaView, "id" | "name" | "status" | "open">[], tasks: readonly Task[]): AreaAsk[] {
  const mine = new Set(tasks.filter((t) => t.owner === USER_OWNER).map((t) => t.id));
  return areaOrder(areas).flatMap((a) => a.open
    .filter((item) => item.needsUser && !(item.taskId && mine.has(item.taskId)))
    .map((item, n) => ({ key: `${a.id}:${n}:${item.title}`, areaId: a.id, area: a.name, title: item.title, since: item.since, sinceAt: item.sinceAt, taskId: item.taskId })));
}

export type TodoShown = { asks: number; areaAsks: number; today: number; later: number; moreAsks: number; moreToday: number; moreLater: number };

export function todoShown(box: TodoBox, chatAsks: number, expanded: boolean, rows = TODO_ROWS, areaAskCount = 0): TodoShown {
  if (expanded) return { asks: box.asks.length, areaAsks: areaAskCount, today: box.today.length, later: box.later.length, moreAsks: 0, moreToday: 0, moreLater: 0 };
  let room = Math.max(0, rows - chatAsks);
  const asks = Math.min(box.asks.length, room); room -= asks;
  const area = Math.min(areaAskCount, room); room -= area;
  const today = Math.min(box.today.length, room);
  return { asks, areaAsks: area, today, later: 0, moreAsks: box.asks.length - asks + areaAskCount - area, moreToday: box.today.length - today, moreLater: box.later.length };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function todoHeader(box: TodoBox, chatAsks: number, areaAskCount = 0): string {
  const asks = box.asks.length + chatAsks + areaAskCount;
  const parts = [asks ? plural(asks, "ask") : null, box.today.length ? `${box.today.length} today` : null];
  return parts.filter(Boolean).join(" · ") || (box.later.length ? `${box.later.length} later` : "");
}

export function moreLine(moreToday: number, moreLater: number, moreAsks = 0): string | null {
  const parts = [moreAsks ? `${plural(moreAsks, "more ask")}` : null, moreToday ? `${moreToday} more today` : null, moreLater ? `${moreLater} later` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export type Progress = { at: number; of: number; label: string; rest: string | null };

export function stepProgress(step: string | null | undefined): Progress | null {
  if (!step) return null;
  const match = /(\d+)\s*(?:\/|of)\s*(\d+)/i.exec(step);
  if (!match) return null;
  const at = Number(match[1]), of = Number(match[2]);
  if (!(of > 0) || at < 0 || at > of) return null;
  const rest = (step.slice(0, match.index) + step.slice(match.index + match[0].length)).trim().replace(/^step\b/i, "").replace(/^[\s:·.-]+|[\s:·.-]+$/g, "").trim();
  return { at, of, label: `${at} of ${of}`, rest: rest || null };
}

export type FlightLook = "running" | "waiting" | "needs-you" | "todo" | "done" | "failed";

export const isRunning = (n: Pick<FlightNode, "task" | "row">) => n.task.state === "in_progress" && !n.task.stale && !n.row.stalled;

const LIVE_WORKER = new Set(["active", "running"]);

/** Something under the row is being worked on now: a worker thread that is running, or a running subtask. */
export function workedOn(node: FlightNode): boolean {
  return node.workers.some((w) => !w.archived && LIVE_WORKER.has(w.status ?? "")) || node.children.some((c) => isRunning(c) || workedOn(c));
}

/** A trigger that hasn't fired yet: an event or a place, a time still ahead, or a snooze. */
export function untriggered(task: Task, now: number): boolean {
  const trigger = task.timing.trigger;
  return task.timing.snoozed || trigger.type === "event" || trigger.type === "place" || (trigger.type === "time" && (trigger.at ?? 0) > now);
}

/**
 * Only waiting: nobody is working on it until something outside happens.
 * Open and not in progress; not waiting on the user (that is "needs you")
 * or on CI (a build is running); waiting on someone outside or another task
 * (kind waiting-outside, or waitingOn outside or task), or waiting or queued
 * behind a trigger that hasn't fired; and no worker or subtask under it is
 * running. These leave In flight for the Waiting group.
 */
export function isWaitingOnly(node: FlightNode, now: number = Date.now()): boolean {
  const t = node.task;
  if (!node.row.open || isClosed(t) || t.stale || t.state === "in_progress" || node.row.needsYou || needsYou(t)) return false;
  const on = t.waitingOn?.kind ?? null;
  if (on === "user" || on === "ci") return false;
  const waits = t.kind === "waiting-outside" || (t.state === "waiting" && (on === "outside" || on === "task")) || ((t.state === "waiting" || t.state === "todo") && untriggered(t, now));
  return waits && !workedOn(node);
}

/** The page's In flight rows split: the ones being worked on, and the ones only waiting. */
export function splitWaiting(nodes: readonly FlightNode[], now: number = Date.now()): { active: FlightNode[]; waiting: FlightNode[] } {
  const active: FlightNode[] = [];
  const waiting: FlightNode[] = [];
  for (const node of nodes) (isWaitingOnly(node, now) ? waiting : active).push(node);
  return { active, waiting };
}

export function flightLook(task: Task, rowNeedsYou = false, stalled = false): FlightLook {
  if (task.state === "failed") return "failed";
  if (task.stale) return "done";
  if (isClosed(task)) return "done";
  if (needsYou(task) || (rowNeedsYou && task.state !== "in_progress")) return "needs-you";
  if (task.state === "in_progress" && !stalled) return "running";
  if (task.state === "todo" && task.owner === USER_OWNER) return "todo";
  return "waiting";
}

export function waitLabel(task: Task, titleOf: (id: string) => string | null = () => null): { short: string; long: string } {
  const on = task.waitingOn ?? (task.kind === "waiting-outside" ? { kind: "outside" as const, ref: null, text: null } : needsYou(task) ? { kind: "user" as const, ref: null, text: null } : null);
  const trigger = task.timing.trigger;
  if (!on && trigger.type === "event" && trigger.event) return { short: "waiting on an event", long: `Waiting on: ${eventLabel(trigger.event, trigger.label)}` };
  if (!on) return task.state === "todo" ? { short: "queued", long: "Queued" } : { short: "waiting", long: "Waiting" };
  if (on.kind === "user") return { short: "waiting on you", long: "Waiting on you" };
  if (on.kind === "ci") return { short: "waiting on CI", long: on.text ? `Waiting on CI: ${on.text}` : on.ref ? `Waiting on CI: ${on.ref}` : "Waiting on CI" };
  if (on.kind === "task") {
    const title = on.ref ? titleOf(on.ref) : null;
    return { short: "waiting on a task", long: title ? `Waiting on ${title}` : on.text ? `Waiting on ${on.text}` : "Waiting on another task" };
  }
  const who = on.text?.trim();
  return { short: who ? `waiting on ${who}` : "waiting on someone", long: who ? `Waiting on ${who}` : "Waiting on someone outside" };
}

const MINUTE = 60_000;
export function age(since: number, now: number): string {
  const ms = Math.max(0, now - since);
  if (ms < MINUTE) return "now";
  if (ms < 60 * MINUTE) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < 24 * 60 * MINUTE) return `${Math.floor(ms / (60 * MINUTE))}h`;
  return `${Math.floor(ms / (24 * 60 * MINUTE))}d`;
}

export function startedAt(node: Pick<FlightNode, "task" | "row">): number {
  return node.row.startedAt ?? node.task.createdAt;
}

export function weekStart(now: number, zone?: string): number {
  const weekday = wall(now, zone).weekday;
  return addDays(now, -((weekday + 6) % 7), 0, 0, zone);
}

export function todayStart(now: number, zone?: string): number {
  return addDays(now, 0, 0, 0, zone);
}

export type DoneGroup = { owner: string; tasks: { task: Task; folded: Task[] }[] };
export type DoneSummary = { today: number; week: number; latest: Task[]; groups: DoneGroup[] };

export function doneSummary(tasks: readonly Task[], now: number, zone?: string, latest = 4): DoneSummary {
  const today = todayStart(now, zone);
  const week = weekStart(now, zone);
  const done = tasks.filter((t) => t.state === "done" && (t.closedAt ?? 0) >= week && t.automation?.role !== "schedule");
  const byId = new Map(done.map((t) => [t.id, t]));
  const topOf = (t: Task): Task => {
    let cur = t;
    const seen = new Set<string>();
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parentId)!; }
    return cur;
  };
  const tops = done.filter((t) => topOf(t) === t).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  const folded = new Map<string, Task[]>();
  for (const t of done) { const top = topOf(t); if (top !== t) folded.set(top.id, [...(folded.get(top.id) ?? []), t]); }
  const groups: DoneGroup[] = [];
  for (const t of tops) {
    let group = groups.find((g) => g.owner === t.owner);
    if (!group) { group = { owner: t.owner, tasks: [] }; groups.push(group); }
    group.tasks.push({ task: t, folded: (folded.get(t.id) ?? []).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)) });
  }
  groups.sort((a, b) => (a.owner === USER_OWNER ? -1 : b.owner === USER_OWNER ? 1 : b.tasks.length - a.tasks.length || (b.tasks[0]!.task.closedAt ?? 0) - (a.tasks[0]!.task.closedAt ?? 0)));
  return { today: tops.filter((t) => (t.closedAt ?? 0) >= today).length, week: tops.length, latest: tops.slice(0, latest), groups };
}

export type PageCounts = { todo: number; flight: number; open: number; running: number; waiting: number; withWorkers: number };

export function pageCounts(board: RowsData, now: number, zone?: string): PageCounts {
  const tops = treeOf(board).filter((n) => n.row.open);
  const flight = tops.filter((n) => !isUserTodo(n.task));
  const box = todoBox(board.tasks, now, zone);
  const topIds = new Set(tops.map((n) => n.task.id));
  const todoTop = [...box.asks, ...box.today, ...box.later].filter((t) => topIds.has(t.id)).length;
  return {
    todo: todoTop,
    flight: flight.length,
    open: tops.length,
    running: flight.filter(isRunning).length,
    waiting: flight.filter((n) => !isRunning(n)).length,
    withWorkers: flight.filter((n) => n.row.hasWorkers).length,
  };
}

export function flightHeader(nodes: readonly FlightNode[]): string {
  const running = nodes.filter(isRunning).length;
  const ended = nodes.filter((n) => n.task.stale).length;
  const waiting = nodes.length - running - ended;
  return [running ? `${running} running` : null, waiting ? `${waiting} waiting` : null, ended ? `${ended} ended` : null].filter(Boolean).join(" · ");
}

export function workersUnder(node: FlightNode): WorkerInfo[] {
  const out = new Map<string, WorkerInfo>();
  const walk = (n: FlightNode) => { for (const w of n.workers) if (!out.has(w.threadId)) out.set(w.threadId, w); for (const c of n.children) walk(c); };
  walk(node);
  return [...out.values()];
}

export type WorkerGroup = { conversation: string | null; name: string; nodes: FlightNode[] };

export function workerGroups(data: RowsData & { groups: readonly { conversation: string | null; name: string; ids: readonly string[] }[] }, keep: (conversation: string | null) => boolean = () => true, now: number = Date.now()): WorkerGroup[] {
  // A task that only waits, with no worker running on it, isn't a worker's live work.
  const tops = new Map(treeOf(data).filter((n) => !isWaitingOnly(n, now)).map((n) => [n.task.id, n]));
  return data.groups.filter((g) => keep(g.conversation)).map((g) => ({ conversation: g.conversation, name: g.name, nodes: g.ids.map((id) => tops.get(id)).filter((n): n is FlightNode => !!n) })).filter((g) => g.nodes.length);
}
