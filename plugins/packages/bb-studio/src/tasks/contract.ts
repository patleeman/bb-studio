import { z } from "zod";
import { trigger } from "../loops/contract";
import { WORK_KINDS } from "../work/shared";

export const TASK_STATES = ["todo", "in_progress", "waiting", "done", "dropped", "failed"] as const;
export const CLOSED_STATES: readonly TaskState[] = ["done", "dropped", "failed"];
export const TASK_KINDS = ["do", "decide", "read", "waiting-outside"] as const;
export const TASK_ORIGINS = ["loop", "work", "task"] as const;
export const PRIORITIES = ["urgent", "normal", "low"] as const;
export const USER_OWNER = "patrick";
export const TASK_ID = /^task_[A-Za-z0-9-]{1,80}$/;

export type TaskState = (typeof TASK_STATES)[number];
export type TaskKind = (typeof TASK_KINDS)[number];

const OWNER = /^(patrick|cos|thread:.+)$/;
export const storedOwner = z.string().regex(OWNER);
export const ownerInput = z.string().regex(/^(user|patrick|cos|me|thread:.+)$/).describe('"user" (the user), "cos" (the Bot), "me" (the calling thread) or "thread:<id>"');
export const isClosed = (task: { state: TaskState }) => CLOSED_STATES.includes(task.state);
export const needsYou = (task: { owner: string; state: TaskState; kind: TaskKind }) => task.owner === USER_OWNER && task.state === "waiting" && task.kind !== "waiting-outside";

const text = (max: number) => z.string().trim().max(max);

export const source = z.object({ kind: z.string(), ref: z.string(), url: z.string().optional() });
export const output = z.object({ kind: text(40).min(1), ref: text(500).min(1), title: text(200).optional(), url: z.string().max(2000).optional() });
export const schedule = z.object({
  text: text(200).min(1),
  cron: z.string().max(200).nullable().default(null),
  timeZone: z.string().max(80).nullable().default(null),
  automationId: z.string().max(200).nullable().default(null),
  paused: z.boolean().default(false),
});
export const card = z.object({
  kind: z.enum(WORK_KINDS),
  messageId: z.string().nullable().default(null),
  messageSeq: z.number().int().min(0).nullable().default(null),
  dismissedAt: z.number().nullable().default(null),
});

export const task = z.object({
  id: z.string().min(1).max(200),
  title: text(500).min(1),
  why: z.string().default(""),
  owner: storedOwner,
  state: z.enum(TASK_STATES),
  kind: z.enum(TASK_KINDS).default("do"),
  options: z.array(z.string()).default([]),
  needs: text(300).nullable().default(null),
  priority: z.enum(PRIORITIES).default("normal"),
  conversation: z.string().min(1).nullable().default(null),
  project: z.string().nullable().default(null),
  area: z.string().nullable().default(null),
  timing: z.object({
    due: z.number().nullable().default(null),
    trigger: trigger.default({ type: "none" }),
    snoozed: z.boolean().default(false),
  }).default({ due: null, trigger: { type: "none" }, snoozed: false }),
  attention: z.object({
    queue: z.enum(["queued", "surfaced"]).nullable().default(null),
    push: z.boolean().default(false),
  }).default({ queue: null, push: false }),
  progress: z.object({ step: text(120).nullable().default(null), line: text(300).nullable().default(null) }).default({ step: null, line: null }),
  workers: z.array(z.string().min(1)).default([]),
  outputs: z.array(output).default([]),
  source: source.nullable().default(null),
  parentId: z.string().nullable().default(null),
  schedule: schedule.nullable().default(null),
  card: card.nullable().default(null),
  stale: z.boolean().default(false),
  origin: z.enum(TASK_ORIGINS),
  createdAt: z.number(),
  updatedAt: z.number(),
  closedAt: z.number().nullable().default(null),
  closedBy: z.string().nullable().default(null),
});
export type Task = z.infer<typeof task>;

export const taskEvent = z.object({ type: z.string(), at: z.number(), data: z.string() });
export type TaskEvent = z.infer<typeof taskEvent>;

const fields = {
  why: z.string().max(4000).optional(),
  kind: z.enum(TASK_KINDS).optional(),
  options: z.array(text(200).min(1)).max(12).optional(),
  needs: text(300).nullable().optional().describe("What the owner must do or answer"),
  priority: z.enum(PRIORITIES).optional(),
  project: z.string().max(200).nullable().optional(),
  area: z.string().max(200).nullable().optional(),
  due: z.number().nullable().optional().describe("Due time, ms since epoch"),
  trigger: trigger.optional().describe("When it comes up: none, time (at), event (event, label) or place (place, direction)"),
  push: z.boolean().optional().describe("Send it to the user's phone when it comes up"),
  step: text(120).nullable().optional().describe('The current step, e.g. "3/5 Tests"'),
  line: text(300).nullable().optional().describe("The latest one-line status"),
  workers: z.array(z.string().min(1)).max(20).optional().describe("Thread ids doing the work"),
  outputs: z.array(output).max(50).optional().describe("What it produced: pages, apps, designs, PRs, builds, releases"),
  source: source.nullable().optional().describe("Where it came from: an email, URL, message or runner report"),
  parentId: z.string().nullable().optional().describe("The parent task, for a subtask"),
  schedule: schedule.nullable().optional().describe("A recurring schedule"),
};

export const createInput = z.object({
  title: text(500).min(1),
  owner: ownerInput,
  state: z.enum(["todo", "in_progress", "waiting"]).optional(),
  conversation: z.string().min(1).optional().describe("The conversation (thread id) the task lives in; defaults to the calling thread when card is true"),
  card: z.boolean().optional().describe("Return a live card line to post once in the conversation"),
  ...fields,
});
export type TaskCreateInput = z.infer<typeof createInput>;

export const updateInput = z.object({
  id: z.string().min(1),
  title: text(500).min(1).optional(),
  state: z.enum(TASK_STATES).optional(),
  conversation: z.string().min(1).nullable().optional(),
  ...fields,
});
export type TaskUpdateInput = z.infer<typeof updateInput>;

export const handoffInput = z.object({
  id: z.string().min(1),
  to: ownerInput,
  needs: text(300).optional().describe("What the new owner must do or answer; for the user, what you need from them"),
  options: z.array(text(200).min(1)).max(12).optional().describe("Choices for the user, for a decision"),
  line: text(300).optional(),
});
export type TaskHandoffInput = z.infer<typeof handoffInput>;

export const listInput = z.object({
  owner: ownerInput.optional(),
  state: z.enum([...TASK_STATES, "open", "closed"]).optional().describe("A state, or open / closed; defaults to open"),
  conversation: z.string().min(1).optional(),
  area: z.string().optional(),
  project: z.string().optional(),
  parentId: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export type TaskListInput = z.infer<typeof listInput>;
