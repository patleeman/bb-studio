import { z } from "zod";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { hold, ownerInfo } from "../loops/contract";
import { task, taskEvent } from "./contract";
import { TASKS_GET_MANY_MAX } from "./limits";

export const SNOOZE_PRESETS = ["later_today", "tonight", "tomorrow_morning", "this_weekend", "home", "mac"] as const;
export const TASK_ACTIONS = ["done", "drop", "got_it", "choose", "snooze", "nudge", "keep", "hand_off", "take_back", "reopen"] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

export const taskView = z.object({
  task,
  history: z.array(taskEvent),
  todo: z.boolean().describe("Whether the task is in the user's todo list, so todo actions (snooze, nudge) apply"),
  threads: z.array(ownerInfo).describe("The owner, workers and conversation, by name, when they are threads"),
  runs: z.array(task).optional().describe("A recurring task's latest runs and findings, newest first"),
});
export type TaskView = z.infer<typeof taskView>;

export const rowRef = z.object({
  id: z.string(),
  home: z.string().nullable().describe("The conversation the row belongs to: its top task's conversation, else its owner's"),
  under: z.string().nullable().describe("The row it is nested under; null for a top-level row"),
  depth: z.number().int().min(0),
  open: z.boolean(),
  workers: z.array(z.string()).describe("Worker threads shown under this row (each worker once, at the deepest task it works on)"),
  hasWorkers: z.boolean(),
  needsYou: z.boolean().describe("It, or an open subtask, needs the user"),
  stalled: z.boolean().optional().describe("Running, but every thread on it has been idle or gone for over six hours"),
  startedAt: z.number().optional().describe("When its current run of work began: the first move to in progress since it was last reopened"),
});
export const rowCounts = z.object({
  open: z.number().int(), running: z.number().int(), waiting: z.number().int(), todo: z.number().int(),
  needsYou: z.number().int(), done: z.number().int(), workers: z.number().int(),
}).describe("Counts over top-level rows: the same numbers in In flight, Workers and the Tasks list");
export const workerInfo = z.object({ threadId: z.string(), name: z.string(), status: z.string().nullable(), archived: z.boolean() });
const rowsOutput = z.object({
  rows: z.array(rowRef).describe("Rows in display order; a subtask follows its parent with under set"),
  tasks: z.array(task),
  counts: rowCounts,
  threads: z.array(ownerInfo),
  workers: z.array(workerInfo),
});
export const problem = z.object({
  kind: z.enum(["worker-without-task", "shown-twice", "card-without-task", "open-under-closed", "stalled"]),
  text: z.string(),
  taskIds: z.array(z.string()),
  threadId: z.string().nullable(),
});

export const taskActInput = z.object({
  id: z.string().min(1),
  action: z.enum(TASK_ACTIONS),
  option: z.string().optional(),
  to: z.string().regex(/^(cos|thread:.+)$/).optional(),
  snooze: z.enum(SNOOZE_PRESETS).optional(),
  at: z.number().optional(),
});
export type TaskActInput = z.infer<typeof taskActInput>;

export const tasksContract = defineRpcContract({
  "tasks.get": { input: z.object({ id: z.string().min(1) }), output: taskView },
  "tasks.getMany": {
    input: z.object({ ids: z.array(z.string().min(1)).min(1).max(TASKS_GET_MANY_MAX) }),
    output: z.object({ views: z.array(z.object({ id: z.string(), view: taskView.nullable().describe("Null when the task is gone") })) }),
  },
  "tasks.list": { input: z.object({}), output: z.object({ tasks: z.array(task), threads: z.array(ownerInfo), held: z.array(hold) }) },
  // Kept for older phone builds (In flight and the Tasks screen before strands); they answer empty.
  "tasks.inFlight": { input: z.object({ threadId: z.string().min(1) }), output: z.object({ tasks: z.array(task), threads: z.array(ownerInfo) }) },
  "tasks.act": { input: taskActInput, output: z.object({ task, note: z.string().nullable() }) },
  "tasks.flight": { input: z.object({ threadId: z.string().min(1) }), output: rowsOutput.extend({ done: z.array(z.string()).describe("Top-level rows that closed today, newest first") }) },
  "tasks.board": { input: z.object({}), output: rowsOutput },
});
