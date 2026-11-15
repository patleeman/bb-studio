import { loop as loopSchema, type Loop } from "../loops/contract";
import { workCard as workSchema, type WorkCard } from "../work/contract";
import type { WorkState } from "../work/shared";
import { isClosed, USER_OWNER, type Task, type TaskKind, type TaskState } from "./contract";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const inLoopView = (task: Pick<Task, "origin">) => task.origin !== "work";
export const inWorkView = (task: Pick<Task, "card" | "conversation">) => task.card !== null && task.conversation !== null;

const loopKind = (kind: TaskKind): Loop["kind"] => (kind === "waiting-outside" ? "waiting" : kind);
const taskKind = (kind: Loop["kind"]): TaskKind => (kind === "waiting" ? "waiting-outside" : kind);

export function loopStatus(task: Task): Loop["status"] {
  if (isClosed(task)) return task.state === "done" ? "done" : "dropped";
  if (task.timing.snoozed) return "snoozed";
  return task.attention.queue ?? "in_progress";
}

function fromStatus(status: Loop["status"], kind: Loop["kind"]): Pick<Task, "state"> & { queue: Task["attention"]["queue"]; snoozed: boolean } {
  if (status === "done" || status === "dropped") return { state: status, queue: null, snoozed: false };
  if (status === "in_progress") return { state: "in_progress", queue: null, snoozed: false };
  return { state: kind === "waiting" ? "waiting" : "todo", queue: status === "surfaced" ? "surfaced" : "queued", snoozed: status === "snoozed" };
}

export function toLoop(task: Task): Loop {
  return loopSchema.parse({
    id: task.id, title: task.title, why: task.why, source: task.source, kind: loopKind(task.kind), options: task.options,
    owner: task.owner, trigger: task.timing.trigger, priority: task.priority, push: task.attention.push, status: loopStatus(task),
    due: task.timing.due, area: task.area, createdAt: task.createdAt, updatedAt: task.updatedAt, closedAt: task.closedAt, closedBy: task.closedBy,
  });
}

export function taskFromLoop(loop: Loop): Task {
  const s = fromStatus(loop.status, loop.kind);
  return {
    id: loop.id, title: loop.title, why: loop.why, owner: loop.owner, state: s.state, kind: taskKind(loop.kind), options: loop.options, needs: null,
    priority: loop.priority, conversation: null, project: null, area: loop.area,
    timing: { due: loop.due, trigger: loop.trigger, snoozed: s.snoozed }, attention: { queue: s.queue, push: loop.push },
    progress: { step: null, line: null }, workers: [], outputs: [], source: loop.source, parentId: null, schedule: null, card: null, stale: false,
    origin: "loop", createdAt: loop.createdAt, updatedAt: loop.updatedAt, closedAt: loop.closedAt, closedBy: loop.closedBy,
  };
}

export function applyLoop(before: Task, next: Loop): Task {
  const was = toLoop(before);
  const t: Task = structuredClone(before);
  const changed = <K extends keyof Loop>(key: K) => !same(was[key], next[key]);
  if (changed("title")) t.title = next.title;
  if (changed("why")) t.why = next.why;
  if (changed("source")) t.source = next.source;
  if (changed("options")) t.options = next.options;
  if (changed("owner")) t.owner = next.owner;
  if (changed("priority")) t.priority = next.priority;
  if (changed("area")) t.area = next.area;
  if (changed("trigger")) t.timing.trigger = next.trigger;
  if (changed("due")) t.timing.due = next.due;
  if (changed("push")) t.attention.push = next.push;
  if (changed("createdAt")) t.createdAt = next.createdAt;
  if (changed("updatedAt")) t.updatedAt = next.updatedAt;
  if (changed("closedAt")) t.closedAt = next.closedAt;
  if (changed("closedBy")) t.closedBy = next.closedBy;
  if (changed("kind")) t.kind = taskKind(next.kind);
  if (changed("status")) {
    const s = fromStatus(next.status, next.kind);
    t.state = s.state; t.attention.queue = s.queue; t.timing.snoozed = s.snoozed;
  } else if (changed("kind") && !isClosed(t) && t.attention.queue !== null) {
    t.state = next.kind === "waiting" ? "waiting" : "todo";
  }
  return t;
}

export const agentOwner = (task: Pick<Task, "workers" | "conversation">) =>
  task.workers[0] ? `thread:${task.workers[0]}` : task.conversation ? `thread:${task.conversation}` : "cos";

export function workState(task: Task): WorkState {
  if (task.state === "failed") return "failed";
  if (isClosed(task)) return "done";
  if (task.owner === USER_OWNER && task.kind !== "waiting-outside") return "needs-you";
  return task.state === "in_progress" ? "running" : "waiting";
}

export function toWork(task: Task): WorkCard {
  if (!task.card || !task.conversation) throw new Error(`Work card ${task.id} not found`);
  return workSchema.parse({
    id: task.id, threadId: task.conversation, title: task.title.slice(0, 200), kind: task.card.kind, state: workState(task),
    step: task.progress.step, line: task.progress.line, needs: task.needs, workerThreadId: task.workers[0] ?? null,
    messageId: task.card.messageId, messageSeq: task.card.messageSeq, createdAt: task.createdAt, updatedAt: task.updatedAt,
    finishedAt: task.closedAt, stale: task.stale, dismissedAt: task.card.dismissedAt,
  });
}

const STATE_OF: Record<WorkState, TaskState> = { running: "in_progress", waiting: "waiting", "needs-you": "waiting", done: "done", failed: "failed" };

export function taskFromWork(card: WorkCard): Task {
  const base = { workers: card.workerThreadId ? [card.workerThreadId] : [], conversation: card.threadId };
  const finished = card.state === "done" || card.state === "failed";
  return {
    id: card.id, title: card.title, why: "", owner: card.state === "needs-you" ? USER_OWNER : agentOwner(base), state: STATE_OF[card.state],
    kind: "do", options: [], needs: card.needs, priority: "normal", conversation: card.threadId, project: null, area: null,
    timing: { due: null, trigger: { type: "none" }, snoozed: false }, attention: { queue: null, push: false },
    progress: { step: card.step, line: card.line }, workers: base.workers, outputs: [], source: null, parentId: null, schedule: null,
    card: { kind: card.kind, messageId: card.messageId, messageSeq: card.messageSeq, dismissedAt: card.dismissedAt }, stale: card.stale,
    origin: "work", createdAt: card.createdAt, updatedAt: card.updatedAt, closedAt: card.finishedAt, closedBy: finished ? agentOwner(base) : null,
  };
}

export function applyWork(before: Task, next: WorkCard): Task {
  const was = toWork(before);
  const t: Task = structuredClone(before);
  const card = t.card!;
  const changed = <K extends keyof WorkCard>(key: K) => !same(was[key], next[key]);
  if (changed("threadId")) t.conversation = next.threadId;
  if (changed("title")) t.title = next.title;
  if (changed("kind")) card.kind = next.kind;
  if (changed("step")) t.progress.step = next.step;
  if (changed("line")) t.progress.line = next.line;
  if (changed("needs")) t.needs = next.needs;
  if (changed("workerThreadId")) {
    const rest = t.workers.filter((id, i) => i > 0 && id !== next.workerThreadId);
    t.workers = next.workerThreadId ? [next.workerThreadId, ...rest] : rest;
  }
  if (changed("messageId")) card.messageId = next.messageId;
  if (changed("messageSeq")) card.messageSeq = next.messageSeq;
  if (changed("dismissedAt")) card.dismissedAt = next.dismissedAt;
  if (changed("createdAt")) t.createdAt = next.createdAt;
  if (changed("updatedAt")) t.updatedAt = next.updatedAt;
  if (changed("finishedAt")) t.closedAt = next.finishedAt;
  if (changed("stale")) t.stale = next.stale;
  if (changed("state")) {
    if (next.state === "needs-you") t.owner = USER_OWNER;
    else if (t.owner === USER_OWNER) t.owner = agentOwner(t);
    t.state = STATE_OF[next.state];
    if (next.state !== "needs-you" && t.attention.queue !== null) t.attention.queue = null;
    if (isClosed(t)) t.closedBy = t.owner;
  }
  return t;
}
