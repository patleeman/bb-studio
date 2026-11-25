// The two RPCs the app window uses to answer a workbench command
// (src/workbench-agent/shared.ts): claim it, so only one window runs it, then
// reply with the result. The UI imports this file for types only.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { recordSchema } from "./shared";
import { workspaceContract, workspaceState } from "./workspace-contract";
import { workspaceTabRefSchema } from "./workspace";

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
  "workbench.import": {
    experimental_description: "A desktop window brings over a conversation's tabs, once: applied only while the server has nothing stored for it.",
    input: z.object({
      threadId: z.string().min(1).max(200),
      tabs: z.array(z.object({ ref: workspaceTabRefSchema, title: z.string().max(300) })).max(100),
      activeIndex: z.number().int().min(0).nullable(),
      panelOpen: z.boolean().nullable(),
      origin: z.string().min(1).max(200).optional(),
    }),
    output: z.object({ imported: z.boolean(), state: workspaceState }),
  },
});

/** The Workspace RPCs (workspace-contract.ts), as a contract the server registers and the app calls. */
export const workspaceRpcContract = defineRpcContract(workspaceContract);
