import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { openSpecSchema } from "../workbench-agent/shared";

export const linksContract = defineRpcContract({
  "links.resolve": {
    experimental_description: "Whether a linked entity exists (a thread, a Studio item, a Bot, a file) and its title; for a file, a diff or a browser tab, the workbench spec that opens it.",
    input: z.object({ kind: z.string().min(1).max(40), id: z.string().max(4096).nullable(), threadId: z.string().max(200).nullable() }),
    output: z.object({ found: z.boolean(), title: z.string().nullable(), spec: openSpecSchema.nullable() }),
  },
});
