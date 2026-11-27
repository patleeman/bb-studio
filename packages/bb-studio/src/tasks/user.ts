import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { z } from "zod";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import type { hold, ownerInfo } from "../loops/contract";
import { threadOwner } from "../loops/register";
import { isClosed, USER_OWNER, type Task, type TaskEvent } from "./contract";
import { tasksContract, type TaskView } from "./rpc-contract";
import { checkTasks, legacyCardsWithoutTask } from "./check";
import { ThreadDirectory, type ThreadFact } from "./links";
import { dayStart, type RowContext } from "./rows";
import { guardTasks, TaskStore } from "./store";
import { inLoopView } from "./views";

type ThreadInfo = z.infer<typeof ownerInfo>;
type ThreadLike = Parameters<typeof threadOwner>[1];

export type UserTaskDeps = {
  thread(threadId: string): Promise<ThreadLike | null>;
  held(): z.infer<typeof hold>[];
  zone?(): string;
  dir?: ThreadDirectory;
  facts?(): Promise<ThreadFact[]>;
};

const DONE_LIST_MS = 8 * 86_400_000;

const THREAD_CACHE_MS = 10_000;

export class UserTasks {
  constructor(readonly store: TaskStore, readonly deps: UserTaskDeps) {}

  private cache = new Map<string, { at: number; value: Promise<ThreadLike | null> }>();
  reads = 0;

  lookup(id: string): Promise<ThreadLike | null> {
    const now = Date.now();
    const hit = this.cache.get(id);
    if (hit && now - hit.at < THREAD_CACHE_MS) return hit.value;
    if (this.cache.size > 500) for (const [key, entry] of this.cache) if (now - entry.at >= THREAD_CACHE_MS) this.cache.delete(key);
    this.reads += 1;
    const value = this.deps.thread(id).catch(() => null);
    this.cache.set(id, { at: now, value });
    return value;
  }

  async names(tasks: readonly Task[], history: readonly TaskEvent[] = []): Promise<ThreadInfo[]> {
    const ids = new Set<string>();
    for (const event of history) {
      try {
        const d = JSON.parse(event.data || "{}") as Record<string, unknown>;
        for (const key of ["owner", "from", "by"]) { const v = d[key]; if (typeof v === "string" && v.startsWith("thread:")) ids.add(v.slice(7)); }
      } catch { continue; }
    }
    for (const t of tasks) {
      if (t.owner.startsWith("thread:")) ids.add(t.owner.slice(7));
      for (const w of t.workers) ids.add(w);
      if (t.conversation) ids.add(t.conversation);
    }
    return Promise.all([...ids].map(async (id) => threadOwner(`thread:${id}`, await this.lookup(id))));
  }

  async view(id: string): Promise<TaskView> {
    const task = this.store.get(id);
    const history = this.store.history(id);
    const runs = task.automation?.role === "schedule" ? this.store.rows("SELECT record FROM tasks WHERE parent_id = ? ORDER BY created_at DESC, id LIMIT 10", id) : null;
    return { task, history, todo: inLoopView(task), threads: await this.names([task, ...(runs ?? [])], history), ...(runs ? { runs } : {}) };
  }

  /** Several task cards' views in one call; a task that is gone reads null. */
  async views(ids: readonly string[]): Promise<{ views: { id: string; view: TaskView | null }[] }> {
    const views = await Promise.all([...new Set(ids)].map(async (id) => {
      try { return { id, view: await this.view(id) }; } catch (error) {
        if (error instanceof Error && error.message === `Task ${id} not found`) return { id, view: null };
        throw error;
      }
    }));
    return { views };
  }

  async list() {
    const since = this.store.now() - DONE_LIST_MS;
    const tasks = this.store.all().filter((t) => t.state !== "dropped" && (!isClosed(t) || (t.closedAt ?? 0) > since) && !(t.automation?.role === "run" && t.owner !== USER_OWNER));
    return { tasks, threads: await this.names(tasks), held: this.deps.held() };
  }

  today(): number {
    return dayStart(this.store.now(), this.deps.zone?.() ?? "UTC");
  }

  context(): RowContext {
    return { since: this.today(), dir: this.deps.dir ?? new ThreadDirectory(this.store.db) };
  }

  async check() {
    const facts = this.deps.facts ? await this.deps.facts() : [];
    return { problems: checkTasks(this.store.all(), facts, this.context(), legacyCardsWithoutTask(this.store.db)) };
  }
}

export function registerUserTasks(bb: BbPluginApi, db: Database.Database, deps: UserTaskDeps) {
  const store = new TaskStore(db, () => { void bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" } as never); });
  const tasks = new UserTasks(store, deps);
  bb.rpc.register(tasksContract, guardTasks(db, {
    "tasks.get": ({ id }: { id: string }) => tasks.view(id),
    "tasks.getMany": ({ ids }: { ids: string[] }) => tasks.views(ids),
    "tasks.list": () => tasks.list(),
  }, false, (message) => bb.log.warn(message)) as never);
  return tasks;
}
