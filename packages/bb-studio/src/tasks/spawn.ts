import { isClosed, USER_OWNER, type Task } from "./contract";
import { applyLinks, boundTask, FINISHED_LINE, isPlaceholder, linksThread, LINKED_BY, needsTask, pairFor, SPAWN_GRACE_MS, workerTask, workerTaskPlan, type ThreadDirectory, type ThreadFact } from "./links";
import type { TaskStore } from "./store";

export type SpawnDeps = {
  store: TaskStore;
  dir: ThreadDirectory;
  thread(threadId: string): Promise<ThreadFact | null>;
  later?(ms: number, work: () => void): void;
  log?(message: string): void;
};

const automated = (t: Task) => t.automation !== null || t.schedule !== null;

// Links between worker threads and the task rows that list them. Studio no
// longer makes a task for a new worker (strands replaced tasks); ensure()
// remains for a worker row the tests and the link checks still build.
export class SpawnLinks {
  constructor(readonly deps: SpawnDeps) {}

  private get store() { return this.deps.store; }

  async isWorker(threadId: string): Promise<boolean> {
    const fact = await this.deps.thread(threadId).catch(() => null);
    return this.deps.dir.isWorker(threadId, fact);
  }

  async joined(taskId: string, threadIds: readonly string[]): Promise<string | null> {
    const notes: string[] = [];
    for (const threadId of new Set(threadIds)) {
      if (!(await this.isWorker(threadId))) continue;
      const found = pairFor(this.store.all(), threadId, { openOnly: true });
      const pairs = found.pairs.filter((p) => p.parent === taskId || p.child === taskId);
      const drops = found.drop.filter((id) => id !== taskId);
      if (pairs.length || drops.length) applyLinks(this.store, { pairs, drops, create: [], ambiguous: [] }, { backup: false });
      this.dropStale(threadId);
      if (found.ambiguous && found.ambiguous.tasks.includes(taskId)) notes.push(`Thread ${threadId} is also on ${found.ambiguous.tasks.filter((id) => id !== taskId).join(", ")}; a worker belongs to one task, so take it off the other or make one a subtask (parentId).`);
    }
    return notes.length ? notes.join(" ") : null;
  }

  async touched(taskId: string, caller: string | null | undefined): Promise<boolean> {
    if (!caller) return false;
    const task = this.store.find(taskId);
    if (!task || isClosed(task) || automated(task) || linksThread(task, caller) || task.owner === USER_OWNER) return false;
    const bound = boundTask(this.store.all(), caller);
    if (bound && !isPlaceholder(bound)) return false;
    if (!(await this.isWorker(caller))) return false;
    this.store.change(taskId, (t) => { t.workers = [...t.workers, caller]; }, `thread:${caller}`);
    this.store.event(taskId, "linked", { thread: caller, by: `thread:${caller}` });
    await this.joined(taskId, [caller]);
    return true;
  }

  ensure(fact: ThreadFact | null, now = this.store.now()): Task | null {
    if (!fact || now - fact.createdAt < SPAWN_GRACE_MS) return null;
    const all = this.store.all();
    if (!needsTask(fact, all, this.deps.dir)) return null;
    const saved = this.store.save(workerTask(this.store, workerTaskPlan(all, fact, this.deps.dir)));
    this.store.event(saved.id, "created", { by: LINKED_BY, owner: saved.owner, from: "worker thread" });
    return saved;
  }

  private placeholders(threadId: string): Task[] {
    return this.store.all().filter((t) => t.source?.kind === "spawn" && t.source.ref === threadId && isPlaceholder(t) && t.state !== "dropped");
  }

  private hasRealTask(threadId: string): boolean {
    return this.store.all().some((t) => !isClosed(t) && !isPlaceholder(t) && t.automation === null && t.schedule === null && linksThread(t, threadId));
  }

  dropStale(threadId: string): string[] {
    if (!this.hasRealTask(threadId)) return [];
    const stale = this.placeholders(threadId);
    if (stale.length) applyLinks(this.store, { pairs: [], drops: stale.map((t) => t.id), create: [], ambiguous: [] }, { backup: false });
    return stale.map((t) => t.id);
  }

  settled(threadId: string): void {
    for (const t of this.placeholders(threadId)) {
      if (isClosed(t)) continue;
      this.store.change(t.id, (next) => { next.state = "done"; next.progress.line = FINISHED_LINE; }, `thread:${threadId}`);
    }
  }

  resumed(threadId: string): void {
    if (this.dropStale(threadId).length) return;
    for (const t of this.placeholders(threadId)) {
      if (t.state !== "done" || t.closedBy !== `thread:${threadId}`) continue;
      this.store.change(t.id, (next) => { next.state = "in_progress"; next.progress.line = null; }, `thread:${threadId}`);
    }
  }
}
