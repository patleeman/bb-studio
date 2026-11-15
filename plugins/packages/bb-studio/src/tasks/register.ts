import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import { ownerText } from "../loops/reference";
import { placeKey } from "../loops/store";
import type { Loop } from "../loops/contract";
import { directiveFor } from "../work/shared";
import { closedByUser, KEPT_CLOSED, createInput, handoffInput, isClosed, listInput, needsYou, updateInput, USER_OWNER, type Task, type TaskCreateInput, type TaskHandoffInput, type TaskListInput, type TaskUpdateInput } from "./contract";
import { guardTasks, surfaceForUser, TaskStore, toStoredOwner } from "./store";
import { inLoopView, inWorkView } from "./views";

export const TASK_TOOLS = ["task_create", "task_update", "task_get", "task_list", "task_handoff"];

type Ctx = { threadId?: string | null };
type Post = (text: string) => Promise<void>;
type Send = (threadId: string, text: string) => Promise<void>;

const CREATE = "Track one piece of work as a task: one task per job. Set its owner (\"user\", \"cos\" for the Bot, \"me\" for your own thread, or \"thread:<id>\"). With card true it returns a ::work{id=\"…\"} line to post once, on its own line, in the conversation; the card redraws in place. Report progress with task_update instead of posting status messages, and hand it to the user with task_handoff when you need them.";
const UPDATE = "Change a task in place: state (todo, in_progress, waiting, done, dropped, failed), step (e.g. \"3/5 Tests\"), line (the latest one-liner), needs, timing, workers, outputs and the rest. Progress and state changes go into its history. Use task_handoff to change its owner.";
const GET = "Read one task by id (task_…, loop_… or wc_…): its record, history and subtasks.";
const LIST = "List tasks, open ones by default, newest change first. Filter by owner (\"user\", \"cos\", \"me\", \"thread:<id>\"), state (a state, open or closed), conversation, area, project or parent.";
const HANDOFF = "Hand a task to another owner and keep its history: to the user when you need a decision or an action from them (say what in needs, give options for a decision), or to the Bot or a thread to carry it on. The task's card updates; a task without a card handed to the user comes up in the Bot chat.";

export function registerTasks(bb: BbPluginApi, db: Database.Database, post: Post, send: Send = async (threadId, text) => { await bb.sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text, mentions: [], visibility: "agent-only" }] } as never); }) {
  const store = new TaskStore(db, () => { void bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" } as never); });
  const caller = (ctx: Ctx) => (ctx.threadId ? `thread:${ctx.threadId}` : null);

  const checkParent = (id: string | null | undefined, self?: string) => {
    if (!id) return;
    for (let at: string | null = id, depth = 0; at; depth++) {
      if (at === self) throw new Error(depth === 0 ? "A task can't be its own parent." : "That parent is one of this task's own subtasks.");
      if (depth > 20) throw new Error("Subtasks go at most 20 levels deep.");
      at = store.get(at).parentId;
    }
  };

  const checkTrigger = (t: Loop["trigger"] | undefined): Loop["trigger"] | undefined => {
    if (!t) return t;
    const next = t.type === "place" && t.place ? { ...t, place: placeKey(t.place) } : t;
    if (next.type === "time" && !Number.isFinite(next.at) || next.type === "event" && !next.event || next.type === "place" && (!next.place || !next.direction)) throw new Error("Trigger fields are incomplete");
    return next;
  };

  const create = async (input: TaskCreateInput, ctx: Ctx = {}) => {
    const x = createInput.parse(input);
    const owner = toStoredOwner(x.owner, ctx.threadId);
    const conversation = x.conversation ?? (x.card ? ctx.threadId ?? null : null);
    if (x.card && !conversation) throw new Error("Pass conversation: the thread the card goes in.");
    checkParent(x.parentId);
    const trigger = checkTrigger(x.trigger);
    const toUser = owner === USER_OWNER;
    const now = store.now();
    const task: Task = {
      id: store.newId("task"), title: x.title, why: x.why ?? "", owner, state: x.state ?? (toUser || (trigger && trigger.type !== "none") ? "todo" : "in_progress"), kind: x.kind ?? (x.options?.length ? "decide" : "do"),
      options: x.options ?? [], needs: x.needs ?? null, priority: x.priority ?? "normal", conversation, project: x.project ?? null, area: x.area ?? null,
      timing: { due: x.due ?? null, trigger: trigger ?? { type: "none" }, snoozed: false }, attention: { queue: toUser && x.card ? "surfaced" : null, push: x.push ?? false },
      progress: { step: x.step ?? null, line: x.line ?? null }, workers: x.workers ?? [], outputs: x.outputs ?? [], source: x.source ?? null,
      parentId: x.parentId ?? null, schedule: x.schedule ?? null, card: x.card ? { kind: "task", messageId: null, messageSeq: null, dismissedAt: null } : null,
      automation: null, stale: false, origin: "task", createdAt: now, updatedAt: now, closedAt: null, closedBy: null,
    };
    surfaceForUser(task);
    const saved = store.save(task);
    store.event(saved.id, "created", { by: caller(ctx) ?? "cos", owner: saved.owner });
    const posted = needsYou(saved) && !inWorkView(saved) ? await tellUser(saved, ctx) : saved.card ? await postCard(saved, ctx) : null;
    return { task: saved, ...(saved.card ? { directive: directiveFor(saved.id) } : {}), ...(posted ? { note: posted } : {}) };
  };

  const postCard = async (task: Task, ctx: Ctx) => {
    const line = directiveFor(task.id);
    if (!task.conversation || task.conversation === ctx.threadId) return `Post this line once, on its own line, in your reply: ${line}`;
    try {
      await send(task.conversation, `Please post this card in your chat exactly once, on its own line: ${line} (the task ${JSON.stringify(task.title)}, made by ${caller(ctx) ?? "the Bot"}). Don't add anything else.`);
      return "Its card was sent to that conversation, which posts it once; don't post it yourself.";
    } catch (error) {
      return `Post this line once, on its own line, in thread ${task.conversation}: ${line} (that conversation could not be asked to: ${error instanceof Error ? error.message : String(error)})`;
    }
  };

  const before = (id: string) => store.get(id);
  const update = (input: TaskUpdateInput, ctx: Ctx = {}) => {
    const x = updateInput.parse(input);
    if (x.parentId !== undefined) checkParent(x.parentId, x.id);
    const trigger = checkTrigger(x.trigger);
    const kept = closedByUser(store.get(x.id)) && !x.reopen;
    const task = store.change(x.id, (t) => {
      if (t.stale && !kept) { t.stale = false; if (x.state === undefined) t.state = "in_progress"; }
      if (x.title !== undefined) t.title = x.title;
      if (x.why !== undefined) t.why = x.why;
      if (x.state !== undefined) t.state = x.state;
      if (x.kind !== undefined) t.kind = x.kind;
      if (x.options !== undefined) t.options = x.options;
      if (x.needs !== undefined && !kept) t.needs = x.needs || null;
      if (x.priority !== undefined) t.priority = x.priority;
      if (x.conversation !== undefined) t.conversation = x.conversation;
      if (x.project !== undefined) t.project = x.project;
      if (x.area !== undefined) t.area = x.area;
      if (x.due !== undefined) t.timing.due = x.due;
      if (trigger !== undefined) { t.timing.trigger = trigger; t.timing.snoozed = false; }
      if (x.push !== undefined) t.attention.push = x.push;
      if (x.step !== undefined && !kept) t.progress.step = x.step || null;
      if (x.line !== undefined && !kept) t.progress.line = x.line || null;
      if (x.workers !== undefined) t.workers = x.workers;
      if (x.outputs !== undefined) t.outputs = x.outputs;
      if (x.source !== undefined) t.source = x.source;
      if (x.parentId !== undefined) t.parentId = x.parentId;
      if (x.schedule !== undefined) t.schedule = x.schedule;
      if (x.state !== undefined && !isClosed(t)) t.stale = false;
      if (kept && !isClosed(t)) t.state = before(x.id).state;
    }, caller(ctx));
    if (!kept) return task;
    if (x.step !== undefined || x.line !== undefined) store.event(x.id, "progress", { step: x.step ?? null, line: x.line ?? null, by: caller(ctx), kept: true });
    return { ...task, note: KEPT_CLOSED };
  };

  const get = (id: string) => {
    const task = store.get(id);
    return { task, history: store.history(id), children: store.children(id).map((c) => ({ id: c.id, title: c.title, owner: c.owner, state: c.state })) };
  };

  const list = (input: TaskListInput, ctx: Ctx = {}) => {
    const x = listInput.parse(input);
    return { tasks: store.list({ ...x, ...(x.owner ? { owner: toStoredOwner(x.owner, ctx.threadId) } : {}) }) };
  };

  const tellUser = async (task: Task, ctx: Ctx) => {
    store.event(task.id, "handed_to_you", { by: caller(ctx) });
    try { await post(`Please post this card in your chat exactly once: ::loop{id="${task.id}"}`); return "It comes up in the Bot chat."; }
    catch (error) { return `It is in Today, but the Bot chat could not be told: ${error instanceof Error ? error.message : String(error)}`; }
  };

  const handoff = async (input: TaskHandoffInput, ctx: Ctx = {}) => {
    const x = handoffInput.parse(input);
    const to = toStoredOwner(x.to, ctx.threadId);
    const before = store.get(x.id);
    if (isClosed(before)) throw new Error(`Task ${x.id} is closed; reopen it with task_update first.`);
    const toUser = to === USER_OWNER;
    const task = store.change(x.id, (t) => {
      t.owner = to;
      t.state = toUser ? "waiting" : "in_progress";
      t.needs = x.needs ?? (toUser ? t.needs : null);
      if (x.options?.length) { t.options = x.options; t.kind = "decide"; }
      if (x.line !== undefined) t.progress.line = x.line || null;
      if (toUser && inLoopView(t)) t.attention.queue = "surfaced";
    }, caller(ctx));
    let note = task.card ? "The card shows the new owner." : "";
    const tell = async (text: string, done: string) => {
      try { await post(text); note = done; } catch (error) { note = `Handed off, but the Bot chat could not be told: ${error instanceof Error ? error.message : String(error)}`; }
    };
    if (toUser && !inWorkView(task) && before.attention.queue !== "surfaced") {
      note = await tellUser(task, ctx);
    } else if (!toUser && to !== caller(ctx)) {
      await tell(`Task ${task.id} was handed to ${ownerText(to)}: ${JSON.stringify(task.title)}.${task.needs ? ` Needs: ${task.needs}.` : ""} ${to === "cos" ? "Carry out the next step now" : "Ask that thread to carry out the next step"}; read it with task_get and record progress with task_update.`, "The Bot was told.");
    }
    return { task, note };
  };

  const tool = <S extends z.ZodTypeAny>(name: string, description: string, parameters: S, execute: (x: z.infer<S>, ctx: Ctx) => unknown) => {
    const run = guardTasks(db, { execute: (x: z.infer<S>, c: Ctx) => execute(x, c) }, true);
    bb.agents.registerTool({ name, description, parameters, execute: async (x: z.infer<S>, ctx: Ctx) => {
      try { return JSON.stringify(await run.execute(x as never, (ctx ?? {}) as never)); } catch (error) { return `Error: ${error instanceof Error ? error.message : String(error)}`; }
    } } as never);
  };
  tool("task_create", CREATE, createInput, (x, ctx) => create(x, ctx));
  tool("task_update", UPDATE, updateInput, (x, ctx) => update(x, ctx));
  tool("task_get", GET, z.object({ id: z.string().min(1) }), ({ id }) => get(id));
  tool("task_list", LIST, listInput, (x, ctx) => list(x, ctx));
  tool("task_handoff", HANDOFF, handoffInput, (x, ctx) => handoff(x, ctx));

  return { store, create, update, get, list, handoff };
}
