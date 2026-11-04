// Studio's canvas RPC methods, `canvas.*` (prototype). Desktop only for now:
// not in public-contract.ts, so no Swift is generated for them.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CANVAS_LIMITS, canvasMetaSchema, canvasViewSchema } from "./shared";

const threadId = z.string().min(1).max(200);
const text = z.string().trim().min(1).max(CANVAS_LIMITS.messageChars);

export const canvasContract = defineRpcContract({
  "canvas.list": {
    experimental_description: "Canvases, most recently changed first.",
    input: z.null(),
    output: z.object({ canvases: z.array(canvasMetaSchema) }),
  },
  "canvas.get": {
    experimental_description: "One canvas by its backing thread: the board, the latest changes, the caption and the history.",
    input: z.object({ threadId }),
    output: z.object({ canvas: canvasViewSchema.nullable() }),
  },
  "canvas.create": {
    experimental_description: "A new canvas: its hidden backing thread starts with this message and the canvas rules.",
    input: z.object({ text, providerId: z.string().max(100).optional(), model: z.string().max(200).optional(), reasoningLevel: z.string().max(40).optional() }),
    output: z.object({ canvasId: z.string(), threadId: z.string() }),
  },
  "canvas.send": {
    experimental_description: "A message to the canvas's thread; queued while it works.",
    input: z.object({ threadId, text }),
    output: z.object({ ok: z.boolean() }),
  },
});
