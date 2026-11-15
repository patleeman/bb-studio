import { z } from "zod";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { hold, ownerInfo } from "../loops/contract";
import { task, taskEvent } from "./contract";

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
  "tasks.list": { input: z.object({}), output: z.object({ tasks: z.array(task), threads: z.array(ownerInfo), held: z.array(hold) }) },
  "tasks.inFlight": { input: z.object({ threadId: z.string().min(1) }), output: z.object({ tasks: z.array(task), threads: z.array(ownerInfo) }) },
  "tasks.act": { input: taskActInput, output: z.object({ task, note: z.string().nullable() }) },
});
