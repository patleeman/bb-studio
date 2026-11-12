// The HUD's RPCs (src/hud/server.ts), and the one a plugin window uses to
// show something in BB's main window, which it can't reach itself.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const hudContract = defineRpcContract({
  "hud.get": {
    experimental_description: "The primary Bot (null before one is made) and whether it is working. Its chat is its thread.",
    input: z.null(),
    output: z.object({
      bot: z.object({ id: z.string(), name: z.string(), threadId: z.string().nullable() }).nullable(),
      working: z.boolean(),
    }),
  },
  "hud.send": {
    experimental_description: "Send a message to the primary Bot's chat.",
    input: z.object({ text: z.string().trim().min(1).max(20_000) }),
    output: z.object({ threadId: z.string() }),
  },
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
