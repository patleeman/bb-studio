import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { z } from "zod";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import type { act as loopAct, hold, ownerInfo } from "../loops/contract";
import { threadOwner } from "../loops/register";
import { SHOW_FINISHED_MS } from "../work/shared";
import { isClosed, needsYou, USER_OWNER, type Task, type TaskEvent } from "./contract";
import { tasksContract, type TaskActInput, type TaskView } from "./rpc-contract";
import { guardTasks, TaskStore } from "./store";
import { inLoopView } from "./views";

type ThreadInfo = z.infer<typeof ownerInfo>;
type ThreadLike = Parameters<typeof threadOwner>[1];

export type UserTaskDeps = {
  post(text: string): Promise<void>;
  send(threadId: string, text: string): Promise<void>;
  thread(threadId: string): Promise<ThreadLike | null>;
  loopAct(input: z.infer<typeof loopAct>): Promise<unknown>;
  reopenLoop(id: string): unknown;
  snoozeLoopUntil(id: string, at: number): unknown;
  held(): z.infer<typeof hold>[];
};

const DONE_LIST_MS = 7 * 86_400_000;
const AGENT = /^(cos|thread:.+)$/;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function handedBy(history: readonly TaskEvent[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const event = history[i]!;
    if (event.type !== "handed_off") continue;
    let data: { owner?: string; from?: string; by?: string | null };
    try { data = JSON.parse(event.data || "{}") as typeof data; } catch { continue; }
    if (data.owner !== USER_OWNER || data.by === USER_OWNER) return null;
    return data.from && AGENT.test(data.from) ? data.from : null;
  }
  return null;
}

export function inFlightOrder(tasks: readonly Task[]): Task[] {
  const rank = (t: Task) => (isClosed(t) ? 3 : t.owner === USER_OWNER ? (needsYou(t) ? 0 : 1) : 2);
  return [...tasks].sort((a, b) => rank(a) - rank(b) || (isClosed(a) ? (b.closedAt ?? 0) - (a.closedAt ?? 0) : a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
}

export class UserTasks {
  constructor(readonly store: TaskStore, readonly deps: UserTaskDeps) {}

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
    return Promise.all([...ids].map(async (id) => threadOwner(`thread:${id}`, await this.deps.thread(id).catch(() => null))));
  }

  async view(id: string): Promise<TaskView> {
    const task = this.store.get(id);
    const history = this.store.history(id);
    return { task, history, todo: inLoopView(task), threads: await this.names([task], history) };
  }

  async list() {
    const since = this.store.now() - DONE_LIST_MS;
    const tasks = this.store.all().filter((t) => !isClosed(t) || (t.closedAt ?? 0) > since);
    return { tasks, threads: await this.names(tasks), held: this.deps.held() };
  }

  async inFlight(threadId: string) {
    const since = this.store.now() - SHOW_FINISHED_MS;
    const rows = this.store.rows("SELECT record FROM tasks WHERE conversation = ? AND (closed_at IS NULL OR closed_at > ?) ORDER BY rowid", threadId, since)
      .filter((t) => (t.card ? t.card.dismissedAt === null : !isClosed(t)));
    const tasks = inFlightOrder(rows);
    return { tasks, threads: await this.names(tasks) };
  }

  private async tell(owner: string, text: string): Promise<string | null> {
    try {
      if (owner === "cos") await this.deps.post(text);
      else await this.deps.send(owner.slice("thread:".length), text);
      return null;
    } catch (error) {
      if (owner === "cos") return `The Bot chat could not be told: ${errorText(error)}`;
      try { await this.deps.post(`${text}\n\nThat thread (${owner}) could not be reached, so pass this on to it.`); return null; }
      catch (again) { return `It could not be told: ${errorText(again)}`; }
    }
  }

  private brief(t: Task) {
    return [`${JSON.stringify(t.title)} (${t.id})`, t.why ? ` Why: ${t.why}` : "", t.progress.line ? ` Last update: ${t.progress.line}.` : ""].join("");
  }

  private async label(owner: string): Promise<string> {
    if (owner === "cos") return "the Bot";
    if (owner === USER_OWNER) return "the user";
    const thread = await this.deps.thread(owner.slice(7)).catch(() => null);
    const title = (thread?.title || thread?.titleFallback || "").trim();
    return title ? `the thread ${JSON.stringify(title)} (${owner})` : owner;
  }

  async handOff(id: string, to: string) {
    if (!AGENT.test(to)) throw new Error("Hand a task to the Bot (cos) or a thread (thread:<id>).");
    const before = this.store.get(id);
    if (isClosed(before)) throw new Error("This task is closed. Reopen it first.");
    if (before.owner === to) return { task: before, note: null };
    if (to.startsWith("thread:")) {
      const thread = await this.deps.thread(to.slice(7)).catch(() => null);
      if (!thread || thread.deletedAt || thread.archivedAt) throw new Error("That thread is gone or archived. Hand the task to someone else.");
    }
    const asked = before.owner === USER_OWNER ? handedBy(this.store.history(id)) : null;
    const task = this.store.change(id, (t) => {
      t.owner = to;
      t.state = "in_progress";
      t.needs = null;
      t.attention.queue = null;
      t.timing.snoozed = false;
    }, USER_OWNER);
    const failed = await this.tell(to, `The user handed you a task: ${this.brief(task)} Carry it out now. Read it with task_get, record progress with task_update (not status messages), close it with task_update state "done", and hand it back with task_handoff to "user" when you need them.`);
    const toName = await this.label(to);
    const previous = AGENT.test(before.owner) ? before.owner : asked;
    const told = previous && previous !== to
      ? await this.tell(previous, before.owner === previous
        ? `The user handed task ${this.brief(before)} to ${toName}. Stop working on it; it is theirs now.`
        : `The user handed your question on task ${this.brief(before)} to ${toName}, who has the task now. Don't wait for the user's answer on it.`)
      : null;
    return { task, note: failed ?? told };
  }

  async takeBack(id: string) {
    const before = this.store.get(id);
    if (isClosed(before)) throw new Error("This task is closed. Reopen it first.");
    if (before.owner === USER_OWNER) return { task: before, note: null };
    const task = this.store.change(id, (t) => {
      t.owner = USER_OWNER;
      t.state = t.kind === "waiting-outside" ? "waiting" : "todo";
      t.attention.queue = "surfaced";
      t.timing.snoozed = false;
      t.progress = { step: null, line: null };
    }, USER_OWNER);
    const failed = await this.tell(before.owner, `The user took task ${this.brief(task)} back. Stop working on it; it is theirs now.`);
    return { task, note: failed };
  }

  async answer(id: string, option: string, from: string) {
    const before = this.store.get(id);
    if (!before.options.includes(option)) throw new Error("Choose an existing option");
    const task = this.store.change(id, (t) => {
      t.owner = from;
      t.state = "in_progress";
      t.needs = null;
      t.progress.line = `Chose: ${option}`.slice(0, 300);
      t.options = [];
      if (t.kind === "decide") t.kind = "do";
    }, USER_OWNER);
    this.store.event(id, "acted", { action: "choose", option });
    const failed = await this.tell(from, `The user chose ${JSON.stringify(option)} for task ${this.brief(before)} Carry on with that choice and record progress with task_update.`);
    return { task, note: failed };
  }

  private close(id: string, state: "done" | "dropped") {
    return this.store.change(id, (t) => { t.state = state; }, USER_OWNER);
  }

  async act(x: TaskActInput) {
    const before = this.store.get(x.id);
    const todo = inLoopView(before);
    const from = handedBy(this.store.history(x.id));
    if (x.action === "hand_off") return this.handOff(x.id, x.to ?? "cos");
    if (x.action === "take_back") return this.takeBack(x.id);
    if (x.action === "choose" && from && !isClosed(before) && before.owner === USER_OWNER) return this.answer(x.id, x.option ?? "", from);
    if (x.action === "reopen") {
      if (!isClosed(before)) return { task: before, note: null };
      if (todo) { this.deps.reopenLoop(x.id); this.store.change(x.id, (t) => { t.needs = null; if (AGENT.test(t.owner)) t.state = "in_progress"; }, USER_OWNER); }
      else this.store.change(x.id, (t) => { t.state = t.owner === USER_OWNER ? "todo" : "in_progress"; t.needs = null; t.stale = false; }, USER_OWNER);
      const task = this.store.get(x.id);
      const note = AGENT.test(task.owner) ? await this.tell(task.owner, `The user reopened task ${this.brief(task)} It is yours again; carry on and record progress with task_update.`) : null;
      return { task, note };
    }
    if (x.action === "snooze" && todo && x.at !== undefined && !x.snooze) {
      this.deps.snoozeLoopUntil(x.id, x.at);
      return { task: this.store.get(x.id), note: null };
    }
    if (todo) await this.deps.loopAct({ id: x.id, action: x.action as z.infer<typeof loopAct>["action"], ...(x.option ? { option: x.option } : {}), ...(x.snooze ? { snooze: x.snooze } : {}) });
    else if (["done", "got_it", "choose", "drop"].includes(x.action)) {
      if (!isClosed(before)) this.close(x.id, x.action === "drop" ? "dropped" : "done");
    } else throw new Error("Only your own to-dos can be snoozed or nudged.");
    const task = this.store.get(x.id);
    let note: string | null = null;
    const closedNow = isClosed(task) && !isClosed(before);
    const verb = task.state === "done" ? "finished" : "dismissed";
    if (closedNow && from && before.owner === USER_OWNER) {
      note = await this.tell(from, `The user ${verb} task ${this.brief(task)}${x.option ? ` They chose ${JSON.stringify(x.option)}.` : ""}`);
    } else if (closedNow && AGENT.test(before.owner)) {
      note = await this.tell(before.owner, `The user ${verb} task ${this.brief(task)} Stop working on it, and don't reopen it unless they ask.`);
    }
    return { task, note };
  }
}

export function registerUserTasks(bb: BbPluginApi, db: Database.Database, deps: UserTaskDeps) {
  const store = new TaskStore(db, () => { void bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" } as never); });
  const tasks = new UserTasks(store, deps);
  bb.rpc.register(tasksContract, guardTasks(db, {
    "tasks.get": ({ id }: { id: string }) => tasks.view(id),
    "tasks.list": () => tasks.list(),
    "tasks.inFlight": ({ threadId }: { threadId: string }) => tasks.inFlight(threadId),
    "tasks.act": (x: TaskActInput) => tasks.act(x),
  }, false, (message) => bb.log.warn(message)) as never);
  return tasks;
}
