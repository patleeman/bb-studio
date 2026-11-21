import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import { ownerText } from "../loops/reference";
import { placeKey } from "../loops/store";
import type { Loop } from "../loops/contract";
import { directiveFor } from "../work/shared";
import { closedByUser, KEPT_CLOSED, createInput, handoffInput, isClosed, listInput, needsYou, updateInput, USER_OWNER, type Task, type TaskCreateInput, type TaskHandoffInput, type TaskListInput, type TaskUpdateInput } from "./contract";
import type { TaskProblem } from "./check";
import { asFact, boundTask, isPlaceholder, rootOf, ThreadDirectory } from "./links";
import { SpawnLinks } from "./spawn";
import { surfaceForUser, TaskStore, toStoredOwner } from "./store";
import { inLoopView, inWorkView } from "./views";

const SCHEDULE_TASK = "This task is an automation's schedule; change it with schedule (op: update), schedule (op: pause) or schedule (op: resume) (runner_* for a runner). Its runs and findings are its subtasks: update those instead.";

export const CONVERSATION_SET = "The conversation is set once, where the task started; it was kept. A subtask shows under its parent's conversation.";
export const WAITING_NOTE = "Say what it waits on with waitingOn: {kind: \"user\"}, {kind: \"ci\", ref: <run or PR>}, {kind: \"task\", ref: <task id>} or {kind: \"outside\", text: <who>}.";

type Ctx = { threadId?: string | null };
type Post = (text: string) => Promise<void>;
type Send = (threadId: string, text: string) => Promise<void>;

export type TaskToolOptions = { links?: SpawnLinks; check?: () => Promise<TaskProblem[]> };

// The task rows' own logic: make, change, read, list and hand off a task.
// Agents no longer have task tools (strands replaced them; their one tool is
// strand_note, src/strands): these functions stay for what still keeps task
// rows (areas, automations' runs and findings, the Tool Gateway's history,
// and older phone builds acting on an old card).
export function registerTasks(bb: BbPluginApi, db: Database.Database, post: Post, send: Send = async (threadId, text) => { await bb.sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text, mentions: [], visibility: "agent-only" }] } as never); }, moved: (task: Task) => void = () => {}, options: TaskToolOptions = {}) {
  const store = new TaskStore(db, () => { void bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" } as never); });
  const links = options.links ?? new SpawnLinks({ store, dir: new ThreadDirectory(db), thread: async (threadId) => asFact(await bb.sdk.threads.get({ threadId } as never).catch(() => null)) });
  const notes = (...parts: (string | null | undefined)[]) => parts.filter((p): p is string => !!p).join(" ") || null;
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
    const parent = x.parentId ? store.get(x.parentId) : null;
    const inherited = parent ? rootOf(new Map(store.all().map((t) => [t.id, t])), parent).conversation : null;
    const conversation = x.conversation ?? (x.card ? ctx.threadId ?? null : inherited);
    const unbound = (threadId: string) => { const bound = boundTask(store.all(), threadId); return !bound || isPlaceholder(bound); };
    const selfWorker = !!ctx.threadId && owner === `thread:${ctx.threadId}` && !x.workers && unbound(ctx.threadId) && await links.isWorker(ctx.threadId);
    if (x.card && !conversation) throw new Error("Pass conversation: the thread the card goes in.");
    checkParent(x.parentId);
    const trigger = checkTrigger(x.trigger);
    const toUser = owner === USER_OWNER;
    const now = store.now();
    const task: Task = {
      id: store.newId("task"), title: x.title, why: x.why ?? "", owner, state: x.state ?? (toUser || (trigger && trigger.type !== "none") ? "todo" : "in_progress"), kind: x.kind ?? (x.options?.length ? "decide" : "do"),
      options: x.options ?? [], needs: x.needs ?? null, priority: x.priority ?? "normal", conversation, project: x.project ?? null, area: x.area ?? null,
      timing: { due: x.due ?? null, trigger: trigger ?? { type: "none" }, snoozed: false }, attention: { queue: toUser && x.card ? "surfaced" : null, push: x.push ?? false },
      progress: { step: x.step ?? null, line: x.line ?? null }, workers: x.workers ?? (selfWorker ? [ctx.threadId!] : []), outputs: x.outputs ?? [], source: x.source ?? null,
      parentId: x.parentId ?? null, schedule: x.schedule ?? null, card: x.card ? { kind: "task", messageId: null, messageSeq: null, dismissedAt: null } : null,
      automation: null, waitingOn: x.waitingOn ?? null, stale: false, origin: "task", createdAt: now, updatedAt: now, closedAt: null, closedBy: null,
    };
    surfaceForUser(task);
    const created = store.save(task);
    store.event(created.id, "created", { by: caller(ctx) ?? "cos", owner: created.owner });
    const linked = created.workers.length ? await links.joined(created.id, created.workers) : null;
    const saved = store.get(created.id);
    if (needsYou(saved)) moved(saved);
    const posted = needsYou(saved) && !inWorkView(saved) ? await tellUser(saved, ctx) : saved.card ? await postCard(saved, ctx) : null;
    const note = notes(posted, linked, saved.state === "waiting" && !saved.waitingOn ? WAITING_NOTE : null);
    return { task: saved, ...(saved.card ? { directive: directiveFor(saved.id) } : {}), ...(note ? { note } : {}) };
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
  const update = async (input: TaskUpdateInput, ctx: Ctx = {}) => {
    const x = updateInput.parse(input);
    if (x.parentId !== undefined) checkParent(x.parentId, x.id);
    const trigger = checkTrigger(x.trigger);
    const current = store.get(x.id);
    if (current.automation?.role === "schedule") throw new Error(SCHEDULE_TASK);
    const kept = closedByUser(current) && !x.reopen;
    const joined = kept ? false : await links.touched(x.id, ctx.threadId);
    const keepConversation = x.conversation !== undefined && current.conversation !== null && x.conversation !== current.conversation;
    const attachedCard = x.card === true && !current.card;
    const changed = store.change(x.id, (t) => {
      if (t.stale && !kept) { t.stale = false; if (x.state === undefined) t.state = "in_progress"; }
      if (x.title !== undefined) t.title = x.title;
      if (x.why !== undefined) t.why = x.why;
      if (x.state !== undefined) t.state = x.state;
      if (x.kind !== undefined) t.kind = x.kind;
      if (x.options !== undefined) t.options = x.options;
      if (x.needs !== undefined && !kept) t.needs = x.needs || null;
      if (x.priority !== undefined) t.priority = x.priority;
      if (x.conversation !== undefined && !keepConversation) t.conversation = x.conversation;
      if (attachedCard) {
        t.card = { kind: "task", messageId: null, messageSeq: null, dismissedAt: null };
        if (!t.conversation && ctx.threadId) t.conversation = ctx.threadId;
      }
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
      if (x.waitingOn !== undefined) t.waitingOn = x.waitingOn;
      if (x.state !== undefined && !isClosed(t)) t.stale = false;
      if (kept && !isClosed(t)) t.state = before(x.id).state;
    }, caller(ctx));
    const added = x.workers ? changed.workers.filter((w) => !current.workers.includes(w)) : [];
    const linked = added.length ? await links.joined(x.id, added) : null;
    const task = added.length ? store.get(x.id) : changed;
    if (kept) {
      if (x.step !== undefined || x.line !== undefined) store.event(x.id, "progress", { step: x.step ?? null, line: x.line ?? null, by: caller(ctx), kept: true });
      return { ...task, note: KEPT_CLOSED };
    }
    const posted = attachedCard && task.card ? await postCard(task, ctx) : null;
    const note = notes(posted, keepConversation ? CONVERSATION_SET : null, linked, joined ? `This thread joined task ${task.id}; report on it from now on.` : null, x.state === "waiting" && !task.waitingOn ? WAITING_NOTE : null);
    return { ...task, ...(attachedCard && task.card ? { directive: directiveFor(task.id) } : {}), ...(note ? { note } : {}) };
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
    if (before.automation?.role === "schedule") throw new Error(SCHEDULE_TASK);
    if (isClosed(before) && !(before.automation?.role === "run" && before.closedBy !== USER_OWNER)) throw new Error(`Task ${x.id} is closed.`);
    const toUser = to === USER_OWNER;
    const task = store.change(x.id, (t) => {
      t.owner = to;
      t.state = toUser ? "waiting" : "in_progress";
      t.needs = x.needs ?? (toUser ? t.needs : null);
      if (x.options?.length) { t.options = x.options; t.kind = "decide"; }
      if (toUser && x.needs && t.automation?.role === "run") t.title = `${t.title.split(" · ")[0]}: ${x.needs}`.slice(0, 160);
      if (x.line !== undefined) t.progress.line = x.line || null;
      if (toUser && inLoopView(t)) t.attention.queue = "surfaced";
    }, caller(ctx));
    if (toUser && !(before.owner === USER_OWNER && needsYou(before))) moved(task);
    let note = task.card ? "The card shows the new owner." : "";
    const tell = async (text: string, done: string) => {
      try { await post(text); note = done; } catch (error) { note = `Handed off, but the Bot chat could not be told: ${error instanceof Error ? error.message : String(error)}`; }
    };
    if (toUser && !inWorkView(task) && before.attention.queue !== "surfaced") {
      note = await tellUser(task, ctx);
    } else if (!toUser && to !== caller(ctx)) {
      await tell(`Task ${task.id} was handed to ${ownerText(to)}: ${JSON.stringify(task.title)}.${task.needs ? ` Needs: ${task.needs}.` : ""} ${to === "cos" ? "Carry out the next step now" : "Ask that thread to carry out the next step"}, and report in the chat.`, "The Bot was told.");
    }
    return { task, note };
  };

  const check = async () => {
    if (!options.check) throw new Error("The task check isn't available here.");
    const problems = await options.check();
    return { problems, summary: problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"} found; nothing was changed.` : "No orphans or duplicates." };
  };
  return { store, create, update, get, list, handoff, links, check };
}
