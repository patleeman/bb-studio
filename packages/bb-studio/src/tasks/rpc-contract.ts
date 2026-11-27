import { z } from "zod";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { hold, ownerInfo } from "../loops/contract";
import { task, taskEvent } from "./contract";
import { TASKS_GET_MANY_MAX } from "./limits";

export const taskView = z.object({
  task,
  history: z.array(taskEvent),
  todo: z.boolean().describe("Whether the task is in the user's todo list, so todo actions (snooze, nudge) apply"),
  threads: z.array(ownerInfo).describe("The owner, workers and conversation, by name, when they are threads"),
  runs: z.array(task).optional().describe("A recurring task's latest runs and findings, newest first"),
});
export type TaskView = z.infer<typeof taskView>;

export const tasksContract = defineRpcContract({
  "tasks.get": { input: z.object({ id: z.string().min(1) }), output: taskView },
  "tasks.getMany": {
    input: z.object({ ids: z.array(z.string().min(1)).min(1).max(TASKS_GET_MANY_MAX) }),
    output: z.object({ views: z.array(z.object({ id: z.string(), view: taskView.nullable().describe("Null when the task is gone") })) }),
  },
  "tasks.list": { input: z.object({}), output: z.object({ tasks: z.array(task), threads: z.array(ownerInfo), held: z.array(hold) }) },
});
