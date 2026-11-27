import { isClosed, needsYou, USER_OWNER, type Task } from "./contract";
import { leadThreads, ownerThread, rootOf, type ThreadDirectory } from "./links";

export type RowRef = {
  id: string;
  home: string | null;
  under: string | null;
  depth: number;
  open: boolean;
  workers: string[];
  hasWorkers: boolean;
  needsYou: boolean;
  startedAt?: number;
  stalled?: boolean;
};

export type RowCounts = { open: number; running: number; waiting: number; todo: number; needsYou: number; done: number; workers: number };

export type Rows = { rows: RowRef[]; tasks: Task[]; counts: RowCounts };

export type RowContext = { since: number; dir: ThreadDirectory };

function wallClock(at: number, zone: string): { y: number; m: number; d: number; ms: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
    .formatToParts(new Date(at)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  const y = parts.year!, m = parts.month!, d = parts.day!;
  return { y, m, d, ms: Date.UTC(y, m - 1, d, parts.hour! % 24, parts.minute!, parts.second!) };
}

export function dayStart(now: number, zone: string): number {
  let today: ReturnType<typeof wallClock>;
  try { today = wallClock(now, zone); } catch { return dayStart(now, "UTC"); }
  const midnight = Date.UTC(today.y, today.m - 1, today.d);
  let at = midnight;
  for (let i = 0; i < 4; i++) {
    const next = at + (midnight - wallClock(at, zone).ms);
    if (next === at) break;
    at = next;
  }
  return Math.min(at, now);
}

export function shown(t: Task, since: number): boolean {
  if (t.automation?.role === "schedule") return false;
  if (t.automation?.role === "run" && t.owner !== USER_OWNER) return false;
  if (t.state === "dropped") return false;
  if (t.card?.dismissedAt != null) return false;
  if (t.stale && !isClosed(t)) return t.updatedAt >= since;
  return !isClosed(t) || (t.closedAt ?? 0) >= since;
}

export function homeOf(byId: ReadonlyMap<string, Task>, t: Task, dir: ThreadDirectory): string | null {
  const root = rootOf(byId, t);
  const start = root.conversation ?? ownerThread(root) ?? (root.owner === "cos" ? dir.main() : null);
  return start ? dir.conversationOf(start) : null;
}

const RANK = (t: Task, deepNeedsYou: boolean) => (isClosed(t) ? 3 : deepNeedsYou ? 0 : t.owner === USER_OWNER ? 1 : 2);

const order = (a: Node, b: Node) => RANK(a.task, a.needsYou) - RANK(b.task, b.needsYou)
  || (isClosed(a.task) ? (b.task.closedAt ?? 0) - (a.task.closedAt ?? 0) : a.task.createdAt - b.task.createdAt) || a.task.id.localeCompare(b.task.id);

type Node = { task: Task; children: Node[]; workers: string[]; deep: Set<string>; needsYou: boolean; home: string | null };

export function buildRows(all: readonly Task[], ctx: RowContext): { roots: Node[]; byId: Map<string, Task> } {
  const byId = new Map(all.map((t) => [t.id, t]));
  const visible = all.filter((t) => shown(t, ctx.since));
  const visibleIds = new Set(visible.map((t) => t.id));
  const leads = leadThreads(all);
  const isRoot = (t: Task) => {
    const parent = t.parentId ? byId.get(t.parentId) : undefined;
    if (!parent || !visibleIds.has(parent.id)) return true;
    return !isClosed(t) && isClosed(parent);
  };
  const childrenOf = new Map<string, Task[]>();
  for (const t of visible) {
    if (isRoot(t)) continue;
    const list = childrenOf.get(t.parentId!) ?? [];
    list.push(t);
    childrenOf.set(t.parentId!, list);
  }
  const make = (t: Task, home: string | null, seen: Set<string>): Node => {
    seen.add(t.id);
    const children = (childrenOf.get(t.id) ?? []).filter((c) => !seen.has(c.id)).map((c) => make(c, home, seen)).sort(order);
    const deep = new Set(children.flatMap((c) => [...c.deep]));
    const own = [...new Set([...t.workers, ...(ownerThread(t) ? [ownerThread(t)!] : [])])]
      .filter((id) => id !== home && id !== t.conversation && !deep.has(id) && !leads.has(id) && ctx.dir.isWorker(id));
    for (const id of own) deep.add(id);
    return { task: t, children, workers: own, deep, needsYou: (!isClosed(t) && needsYou(t)) || children.some((c) => c.needsYou && !isClosed(c.task)), home };
  };
  const seen = new Set<string>();
  const roots = visible.filter(isRoot).map((t) => make(t, homeOf(byId, t, ctx.dir), seen));
  roots.sort(order);
  return { roots, byId };
}

function flatten(roots: readonly Node[]): Rows {
  const rows: RowRef[] = [];
  const tasks: Task[] = [];
  const walk = (n: Node, under: string | null, depth: number) => {
    rows.push({ id: n.task.id, home: n.home, under, depth, open: !isClosed(n.task), workers: n.workers, hasWorkers: n.deep.size > 0, needsYou: n.needsYou });
    tasks.push(n.task);
    for (const c of n.children) walk(c, n.task.id, depth + 1);
  };
  for (const r of roots) walk(r, null, 0);
  return { rows, tasks, counts: countRoots(roots) };
}

export function countRoots(roots: readonly Pick<Node, "task" | "needsYou" | "deep">[]): RowCounts {
  const open = roots.filter((r) => !isClosed(r.task));
  return {
    open: open.length,
    running: open.filter((r) => r.task.state === "in_progress").length,
    waiting: open.filter((r) => r.task.state === "waiting").length,
    todo: open.filter((r) => r.task.state === "todo").length,
    needsYou: open.filter((r) => r.needsYou).length,
    done: roots.length - open.length,
    workers: new Set(open.flatMap((r) => [...r.deep])).size,
  };
}

export function flightRows(all: readonly Task[], threadId: string, ctx: RowContext): Rows {
  return flatten(buildRows(all, ctx).roots.filter((r) => r.home === threadId));
}

export function boardRows(all: readonly Task[], ctx: RowContext): Rows {
  return flatten(buildRows(all, ctx).roots);
}
