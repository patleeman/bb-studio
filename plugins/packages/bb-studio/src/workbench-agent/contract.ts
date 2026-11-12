// The two RPCs the app window uses to answer a workbench command
// (src/workbench-agent/shared.ts): claim it, so only one window runs it, then
// reply with the result. The UI imports this file for types only.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { recordSchema } from "./shared";

const requestId = z.string().min(1).max(100);

export const workbenchContract = defineRpcContract({
  "workbench.claim": {
    experimental_description: "A window showing the command's conversation takes the command. go: run it; false when another window took it or it timed out.",
    input: z.object({ requestId }),
    output: z.object({ go: z.boolean() }),
  },
  "workbench.reply": {
    experimental_description: "The claiming window's result: the text for the agent and Studio's updated record of that workbench.",
    input: z.object({ requestId, message: z.string().max(20_000), record: recordSchema }),
    output: z.object({ ok: z.boolean() }),
  },
});
