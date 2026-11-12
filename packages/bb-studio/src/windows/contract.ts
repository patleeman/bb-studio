import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const windowsContract = defineRpcContract({
  "window.openInMain": {
    experimental_description: "Ask BB's main window to open an in-app path and come to the front. For a plugin window, which has no main view.",
    input: z.object({ path: z.string().min(2).max(2000).regex(/^\/(?!\/)/) }),
    output: z.object({ ok: z.literal(true) }),
  },
  "window.runInMain": {
    experimental_description: "Ask BB's main window to run one of BB's commands (an id from experimental_useAppCommands), open a web address, or open a link by the link router's rule (src/links: how is workbench, secondPane, window or main), and come to the front. For a plugin window, whose commands act on itself.",
    input: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("command"), commandId: z.string().min(1).max(300) }),
      z.object({ kind: z.literal("url"), url: z.string().url().max(4096).regex(/^https?:\/\//i) }),
      z.object({ kind: z.literal("link"), link: z.string().min(1).max(4096), how: z.enum(["workbench", "secondPane", "window", "main"]) }),
    ]),
    output: z.object({ ok: z.literal(true) }),
  },
});
