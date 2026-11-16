import type Database from "better-sqlite3";
import { readdirSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
import { primaryBotThread } from "../primary-thread";
import { isClosed, USER_OWNER, type Task } from "./contract";
import { backupDatabase } from "./migrate";
import type { TaskStore } from "./store";

export type ThreadFact = {
  id: string;
  parentThreadId: string | null;
  title: string | null;
  titleFallback?: string | null;
  status: string | null;
  archivedAt: number | null;
  deletedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  originPluginId?: string | null;
};

export const SPAWN_SOURCE = "spawn";
export const SPAWN_GRACE_MS = 90_000;
export const LINKED_BY = "studio";
export const RUNNING = new Set(["active", "running", "starting", "pending", "stopping"]);

export const asFact = (thread: unknown): ThreadFact | null => {
  if (!thread || typeof thread !== "object") return null;
  const t = thread as Record<string, unknown>;
  if (typeof t.id !== "string") return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    id: t.id, parentThreadId: str(t.parentThreadId), title: str(t.title), titleFallback: str(t.titleFallback), status: str(t.status),
    archivedAt: num(t.archivedAt), deletedAt: num(t.deletedAt), createdAt: num(t.createdAt) ?? 0, updatedAt: num(t.updatedAt) ?? num(t.createdAt) ?? 0,
    originPluginId: str(t.originPluginId),
  };
};

const hasTable = (db: Database.Database, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

export class ThreadDirectory {
  constructor(readonly db: Database.Database) {}

  private row(id: string): { kind: string; owner: string | null } | null {
    if (!hasTable(this.db, "bot_threads")) return null;
    return (this.db.prepare("SELECT kind, owner_conversation_id AS owner FROM bot_threads WHERE thread_id = ?").get(id) as { kind: string; owner: string | null } | undefined) ?? null;
  }

  kind(id: string): "worker" | "conversation" | null {
    const k = this.row(id)?.kind;
    return k === "worker" || k === "conversation" ? k : null;
  }

  conversationOf(id: string): string {
    let at = id;
    for (let i = 0; i < 6; i++) {
      const row = this.row(at);
      if (row?.kind !== "worker" || !row.owner || row.owner === at) return at;
      at = row.owner;
    }
    return at;
  }

  main(): string | null {
    return primaryBotThread(this.db);
  }

  private runners: { at: number; ids: Set<string> } | null = null;

  runnerThreads(): Set<string> {
    const now = Date.now();
    if (this.runners && now - this.runners.at < 5_000) return this.runners.ids;
    const ids = hasTable(this.db, "bot_runners") ? new Set((this.db.prepare("SELECT thread_id FROM bot_runners WHERE thread_id IS NOT NULL").all() as { thread_id: string }[]).map((r) => r.thread_id)) : new Set<string>();
    this.runners = { at: now, ids };
    return ids;
  }

  isWorker(id: string, fact?: ThreadFact | null): boolean {
    if (this.runnerThreads().has(id)) return false;
    if (fact) return !!fact.parentThreadId && fact.originPluginId !== "automations";
    return this.kind(id) === "worker";
  }
}

export const ownerThread = (t: Pick<Task, "owner">) => (t.owner.startsWith("thread:") ? t.owner.slice(7) : null);
export const threadsOf = (t: Task): string[] => [...new Set([...t.workers, ...(ownerThread(t) ? [ownerThread(t)!] : []), ...(t.automation?.thread ? [t.automation.thread] : [])])];
export const linksThread = (t: Task, threadId: string) => t.workers.includes(threadId) || t.owner === `thread:${threadId}` || t.automation?.thread === threadId;
export const ownedBy = (t: Task, threadId: string) => t.owner === `thread:${threadId}` || (t.card?.kind === "worker" && t.workers[0] === threadId);
export const isPlaceholder = (t: Task) => t.source?.kind === SPAWN_SOURCE && t.card === null && !t.outputs.length && t.progress.step === null && (t.progress.line === null || t.progress.line === FINISHED_LINE);
export const FINISHED_LINE = "Its thread finished without a report";

export function ancestry(byId: ReadonlyMap<string, Task>, t: Task): Task[] {
  const out: Task[] = [];
  const seen = new Set<string>([t.id]);
  for (let at = t.parentId ? byId.get(t.parentId) : undefined; at && !seen.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) {
    out.push(at);
    seen.add(at.id);
  }
  return out;
}

export const rootOf = (byId: ReadonlyMap<string, Task>, t: Task) => ancestry(byId, t).at(-1) ?? t;
export const related = (byId: ReadonlyMap<string, Task>, a: Task, b: Task) => a.id === b.id || ancestry(byId, a).some((x) => x.id === b.id) || ancestry(byId, b).some((x) => x.id === a.id);

const automated = (t: Task) => t.automation !== null || t.schedule !== null;

export function boundTask(all: readonly Task[], threadId: string, open = true): Task | null {
  const byId = new Map(all.map((t) => [t.id, t]));
  const linked = all.filter((t) => !automated(t) && (!open || !isClosed(t)) && linksThread(t, threadId));
  const deepest = linked.filter((t) => !linked.some((o) => o.id !== t.id && ancestry(byId, o).some((a) => a.id === t.id)));
  if (!deepest.length) return null;
  return deepest.find((t) => !isPlaceholder(t)) ?? deepest[0]!;
}

export function leadThreads(all: readonly Task[]): Set<string> {
  const count = new Map<string, number>();
  for (const t of all) {
    const owner = ownerThread(t);
    if (!owner || automated(t) || isClosed(t) || t.parentId !== null) continue;
    count.set(owner, (count.get(owner) ?? 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n >= 2).map(([id]) => id));
}

export type Pairing = { parent: string; child: string; thread: string; parentTitle: string; childTitle: string };
export type Ambiguous = { thread: string; tasks: string[]; reason: string };

export function pairFor(all: readonly Task[], threadId: string, options: { openOnly: boolean }): { pairs: Pairing[]; drop: string[]; ambiguous: Ambiguous | null } {
  const byId = new Map(all.map((t) => [t.id, t]));
  const group = all.filter((t) => !automated(t) && linksThread(t, threadId) && t.state !== "dropped" && (!options.openOnly || !isClosed(t)));
  const out = { pairs: [] as Pairing[], drop: [] as string[], ambiguous: null as Ambiguous | null };
  if (group.length < 2) return out;
  const placeholders = group.filter((t) => isPlaceholder(t) && !isClosed(t));
  const real = group.filter((t) => !placeholders.includes(t));
  if (placeholders.length && real.length) for (const p of placeholders) out.drop.push(p.id);
  const rest = real.length ? real : group;
  const own = rest.filter((t) => ownedBy(t, threadId));
  const leads = rest.filter((t) => !ownedBy(t, threadId));
  const unparented = own.filter((t) => !t.parentId);
  if (unparented.length > 1) {
    out.ambiguous = { thread: threadId, tasks: unparented.map((t) => t.id), reason: "owns several separate tasks" };
    return out;
  }
  for (const child of unparented) {
    const options2 = leads.filter((l) => !related(byId, l, child));
    if (!options2.length) continue;
    const tops = options2.filter((l) => !options2.some((o) => o.id !== l.id && ancestry(byId, o).some((a) => a.id === l.id)));
    if (tops.length !== 1) {
      out.ambiguous = { thread: threadId, tasks: [child.id, ...tops.map((t) => t.id)], reason: `${tops.length} tasks of other owners also list this thread` };
      continue;
    }
    const lead = tops[0]!;
    const under = own.filter((o) => o.id !== child.id && ancestry(byId, o).some((a) => a.id === lead.id));
    const deepest = under.filter((o) => !under.some((d) => d.id !== o.id && ancestry(byId, d).some((a) => a.id === o.id)));
    const parent = deepest.length === 1 ? deepest[0]! : lead;
    if (!isClosed(child) && isClosed(parent)) {
      out.ambiguous = { thread: threadId, tasks: [child.id, parent.id], reason: "its open task would go under a closed one" };
      continue;
    }
    out.pairs.push({ parent: parent.id, child: child.id, thread: threadId, parentTitle: parent.title, childTitle: child.title });
  }
  if (!own.length && leads.length > 1) {
    const unrelated = leads.filter((l) => !leads.some((o) => o.id !== l.id && related(byId, o, l)));
    if (unrelated.length > 1) out.ambiguous = { thread: threadId, tasks: unrelated.map((t) => t.id), reason: "listed as a worker on several tasks, none of them its own" };
  }
  return out;
}

export type WorkerTaskPlan = { threadId: string; title: string; state: Task["state"]; conversation: string | null; parentId: string | null; createdAt: number; closedAt: number | null };
export type LinkPlan = { pairs: Pairing[]; drops: string[]; create: WorkerTaskPlan[]; ambiguous: Ambiguous[] };

const factTitle = (fact: ThreadFact) => (fact.title || fact.titleFallback || "").replace(/\s+/g, " ").trim().slice(0, 200) || "Worker thread";
const factState = (fact: ThreadFact): Task["state"] => (fact.status === "error" || fact.status === "failed" ? "failed" : RUNNING.has(fact.status ?? "") ? "in_progress" : "done");

export function deepestLinked(all: readonly Task[], threadId: string): Task[] {
  const byId = new Map(all.map((t) => [t.id, t]));
  const linked = all.filter((t) => !automated(t) && !isClosed(t) && linksThread(t, threadId));
  return linked.filter((t) => !linked.some((o) => o.id !== t.id && ancestry(byId, o).some((a) => a.id === t.id)));
}

export function spawnerTask(all: readonly Task[], spawner: string, dir: ThreadDirectory): Task | null {
  if (dir.isWorker(spawner)) {
    const real = deepestLinked(all, spawner).filter((t) => !isPlaceholder(t));
    if (real.length > 1) return null;
    if (real.length === 1) return real[0]!;
  }
  const owned = all.filter((t) => !automated(t) && !isClosed(t) && t.owner === `thread:${spawner}` && t.parentId === null && t.state !== "todo");
  return owned.length === 1 ? owned[0]! : null;
}

export function workerTaskPlan(all: readonly Task[], fact: ThreadFact, dir: ThreadDirectory): WorkerTaskPlan {
  const state = factState(fact);
  const byId = new Map(all.map((t) => [t.id, t]));
  const parent = state === "in_progress" && fact.parentThreadId ? spawnerTask(all, fact.parentThreadId, dir) : null;
  const conversation = parent ? (rootOf(byId, parent).conversation ?? dir.conversationOf(fact.parentThreadId!)) : fact.parentThreadId ? dir.conversationOf(fact.parentThreadId) : null;
  return { threadId: fact.id, title: factTitle(fact), state, conversation, parentId: parent?.id ?? null, createdAt: fact.createdAt, closedAt: state === "in_progress" ? null : fact.updatedAt };
}

export function needsTask(fact: ThreadFact, all: readonly Task[], dir: ThreadDirectory): boolean {
  if (fact.archivedAt || fact.deletedAt || !dir.isWorker(fact.id, fact)) return false;
  return !all.some((t) => linksThread(t, fact.id));
}

export function planLinks(all: readonly Task[], facts: readonly ThreadFact[], dir: ThreadDirectory, now = Date.now()): LinkPlan {
  const plan: LinkPlan = { pairs: [], drops: [], create: [], ambiguous: [] };
  const known = new Map(facts.map((f) => [f.id, f]));
  const threads = new Set(all.flatMap((t) => (automated(t) ? [] : threadsOf(t))));
  for (const threadId of [...threads].sort()) {
    if (!dir.isWorker(threadId, known.get(threadId) ?? null)) continue;
    const found = pairFor(all, threadId, { openOnly: false });
    plan.pairs.push(...found.pairs);
    plan.drops.push(...found.drop);
    if (found.ambiguous) plan.ambiguous.push(found.ambiguous);
  }
  const seenChild = new Set<string>();
  plan.pairs = plan.pairs.filter((p) => (seenChild.has(p.child) ? false : (seenChild.add(p.child), true)));
  const byId = new Map(all.map((t) => [t.id, structuredClone(t)]));
  for (const p of plan.pairs) {
    const child = byId.get(p.child)!;
    child.parentId = p.parent;
    if (ancestry(byId, child).some((a) => a.id === child.id) || ancestry(byId, byId.get(p.parent)!).some((a) => a.id === child.id)) {
      child.parentId = null;
      plan.ambiguous.push({ thread: p.thread, tasks: [p.parent, p.child], reason: "pairing them would make a cycle" });
      p.parent = "";
    }
  }
  plan.pairs = plan.pairs.filter((p) => p.parent);
  const after = [...byId.values()];
  for (const fact of [...facts].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    if (RUNNING.has(fact.status ?? "") && now - fact.createdAt >= SPAWN_GRACE_MS && needsTask(fact, after, dir)) plan.create.push(workerTaskPlan(after, fact, dir));
  }
  return plan;
}

export function workerTask(store: TaskStore, p: WorkerTaskPlan): Task {
  const closed = p.state !== "in_progress";
  return {
    id: store.newId("task"), title: p.title, why: "", owner: `thread:${p.threadId}`, state: p.state, kind: "do", options: [], needs: null, priority: "normal",
    conversation: p.conversation, project: null, area: null, timing: { due: null, trigger: { type: "none" }, snoozed: false }, attention: { queue: null, push: false },
    progress: { step: null, line: closed ? FINISHED_LINE : null }, workers: [p.threadId], outputs: [], source: { kind: SPAWN_SOURCE, ref: p.threadId }, parentId: p.parentId,
    schedule: null, card: null, automation: null, waitingOn: null, stale: false, origin: "work", createdAt: p.createdAt || store.now(), updatedAt: closed ? p.closedAt ?? store.now() : store.now(),
    closedAt: closed ? p.closedAt ?? store.now() : null, closedBy: closed ? `thread:${p.threadId}` : null,
  };
}

export type LinkReport = LinkPlan & { created: string[]; backup: string | null; backupError?: string };

export const BACKUP_LABEL = "task-links";

export function backedUp(db: Database.Database): boolean {
  const file = db.name;
  if (!file || file === ":memory:") return true;
  const ext = extname(file);
  const prefix = `${basename(file, ext)}.before-${BACKUP_LABEL}-`;
  try { return readdirSync(dirname(file)).some((name) => name.startsWith(prefix)); } catch { return false; }
}

export function applyLinks(store: TaskStore, plan: LinkPlan, options: { backup?: boolean } = {}): LinkReport {
  const report: LinkReport = { ...plan, created: [], backup: null };
  if (!plan.pairs.length && !plan.drops.length && !plan.create.length) return report;
  if (options.backup !== false && !backedUp(store.db)) {
    try { report.backup = backupDatabase(store.db, store.now(), BACKUP_LABEL); }
    catch (error) {
      report.backupError = error instanceof Error ? error.message : String(error);
      return { ...report, pairs: [], drops: [], create: [] };
    }
  }
  store.db.transaction(() => {
    for (const p of plan.pairs) {
      const child = store.get(p.child);
      const parent = store.get(p.parent);
      const next = structuredClone(child);
      next.parentId = parent.id;
      if (next.conversation === null) next.conversation = rootOf(new Map(store.all().map((t) => [t.id, t])), parent).conversation;
      store.write(next);
      store.event(child.id, "linked", { parent: parent.id, thread: p.thread, by: LINKED_BY });
    }
    for (const id of plan.drops) {
      const t = store.get(id);
      const next = structuredClone(t);
      next.state = "dropped";
      next.closedAt = store.now();
      next.closedBy = LINKED_BY;
      next.workers = [];
      next.progress.line = "Joined its real task";
      store.write(next);
      store.event(id, "closed", { action: "drop", by: LINKED_BY, reason: "joined another task" });
    }
    for (const c of plan.create) {
      const saved = store.write(workerTask(store, c));
      store.event(saved.id, "created", { by: LINKED_BY, owner: saved.owner, from: "worker thread" });
      report.created.push(saved.id);
    }
  })();
  store.changed();
  return report;
}

type Log = { info(message: string): void; warn(message: string): void };

export function linkAtStart(store: TaskStore, facts: readonly ThreadFact[], dir: ThreadDirectory, log?: Log): LinkReport {
  const plan = planLinks(store.all(), facts, dir, store.now());
  const report = applyLinks(store, plan);
  if (log && (report.pairs.length || report.drops.length || report.created.length)) log.info(`Task links: ${report.pairs.length} paired, ${report.drops.length} dropped, ${report.created.length} made for workers; backup at ${report.backup ?? "none"}.`);
  if (log && report.backupError) log.warn(`Task links: the backup failed (${report.backupError}); nothing was linked, and the next start tries again.`);
  if (log && report.ambiguous.length) log.warn(`Task links: left ${report.ambiguous.length} ambiguous: ${report.ambiguous.map((a) => `${a.thread} (${a.reason})`).join("; ")}`);
  return report;
}

export async function listThreadFacts(sdk: { threads: { list(input: never): Promise<unknown[]> } }): Promise<ThreadFact[]> {
  const out: ThreadFact[] = [];
  for (let offset = 0; offset < 20_000; offset += 200) {
    const batch = await sdk.threads.list({ archived: false, includeHidden: true, limit: 200, offset } as never);
    for (const thread of batch) { const fact = asFact(thread); if (fact) out.push(fact); }
    if (batch.length < 200) break;
  }
  return out;
}

export function summarizeLinks(all: readonly Task[], facts: readonly ThreadFact[], dir: ThreadDirectory) {
  const workers = facts.filter((f) => !f.archivedAt && !f.deletedAt && dir.isWorker(f.id, f));
  return {
    tasks: all.length,
    open: all.filter((t) => !isClosed(t)).length,
    subtasks: all.filter((t) => t.parentId !== null && !automated(t)).length,
    workerThreads: workers.length,
    workersWithTask: workers.filter((f) => all.some((t) => linksThread(t, f.id))).length,
    runningWorkers: workers.filter((f) => RUNNING.has(f.status ?? "")).length,
    origin: Object.fromEntries(["loop", "work", "task"].map((o) => [o, all.filter((t) => t.origin === o).length])),
    userOwned: all.filter((t) => t.owner === USER_OWNER).length,
  };
}
