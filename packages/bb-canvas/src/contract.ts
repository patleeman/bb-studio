// The canvas plugin's RPC methods, `canvas.*` (prototype). The page calls
// them; Studio's hands-free voice calls canvas.voice and canvas.voiceRun
// (bb.sdk.plugins.callRpc) for a session launched from a canvas thread.
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
  "canvas.voice": {
    experimental_description: "For Studio's hands-free voice: the canvas tools (OpenAI function tools) and a note for the voice, when the thread backs a canvas; none otherwise.",
    input: z.object({ threadId }),
    output: z.object({ tools: z.array(z.object({ type: z.literal("function"), name: z.string(), description: z.string(), parameters: z.record(z.string(), z.unknown()) })), instructions: z.string().nullable() }),
  },
  "canvas.voiceRun": {
    experimental_description: "For Studio's hands-free voice: run one canvas tool on the board of the session's canvas thread. null output: not a canvas tool.",
    input: z.object({ threadId, name: z.string().min(1).max(64), args: z.record(z.string(), z.unknown()) }),
    output: z.object({ output: z.string().nullable() }),
  },
  "canvas.send": {
    experimental_description: "A message to the canvas's thread; queued while it works.",
    input: z.object({ threadId, text }),
    output: z.object({ ok: z.boolean() }),
  },
});
