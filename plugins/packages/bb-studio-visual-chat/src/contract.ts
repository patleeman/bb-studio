// The canvas plugin's RPC methods, `canvas.*` (prototype). The page calls
// them; Studio's hands-free voice calls canvas.voice and canvas.voiceRun
// (bb.sdk.plugins.callRpc) for a session launched from a canvas thread.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { lookSchema } from "./looks";
import { CANVAS_LIMITS, canvasMetaSchema, clientHintSchema, canvasViewSchema, pickerProviderSchema, versionSchema } from "./shared";

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
    experimental_description: "A new canvas: its hidden backing thread starts with this message and the canvas rules. look picks its design direction (default editorial). voice: true starts it with no message, for hands-free voice to be the first input. client: the screen the user is on, so the agent composes for it.",
    input: z.object({ text: text.optional(), voice: z.boolean().optional(), providerId: z.string().max(100).optional(), model: z.string().max(200).optional(), reasoningLevel: z.string().max(40).optional(), look: lookSchema.optional(), client: clientHintSchema.optional() })
      .refine((input) => !!input.text || input.voice === true, { message: "Say what to look at, or start by voice." }),
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
  "canvas.version": {
    experimental_description: "One version of the canvas's board (the finished board of a turn), with its page or old items, style, title, prompt and caption.",
    input: z.object({ threadId, n: z.number().int().positive() }),
    output: z.object({ version: versionSchema.nullable() }),
  },
  "canvas.view": {
    experimental_description: "Which version the user is looking at (null: the latest), so the agent and the voice know.",
    input: z.object({ threadId, n: z.number().int().positive().nullable() }),
    output: z.object({ viewing: z.number().nullable() }),
  },
  "canvas.send": {
    experimental_description: "A message to the canvas's thread; queued while it works. After a provider switch it starts the canvas's fresh thread: threadId is the canvas's thread now. fromVersion: the user went back to that version, so the board returns to it and the message continues from there (later versions stay). client: the screen the user is on, so the agent composes for it.",
    input: z.object({ threadId, text, fromVersion: z.number().int().positive().nullable().optional(), client: clientHintSchema.optional() }),
    output: z.object({ ok: z.boolean(), threadId: z.string() }),
  },
  "canvas.models": {
    experimental_description: "The providers and models BB has, for the model picker: each available provider's models, with reasoning levels when a model has them.",
    input: z.null(),
    output: z.object({ providers: z.array(pickerProviderSchema) }),
  },
  "canvas.setModel": {
    experimental_description: "Pick the canvas's provider and model (and reasoning level) for its next turn. The same provider changes the backing thread's model in place; another provider starts a fresh backing thread on the next message, keeping the board.",
    input: z.object({ threadId, providerId: z.string().min(1).max(100), model: z.string().min(1).max(200), reasoningLevel: z.string().max(40).nullable().optional() }),
    output: z.object({ mode: z.enum(["unchanged", "same-thread", "new-thread-next-turn"]), canvas: canvasViewSchema.nullable() }),
  },
  "canvas.webpage": {
    experimental_description: "A webpage part's URL on a canvas: whether it may be shown (it came from the user in this chat, or from the agent's own fetch or search results in the turn that used it), and if so whether it can be framed, with its link card.",
    input: z.object({ threadId, url: z.string().min(1).max(2000) }),
    output: z.object({
      status: z.enum(["unverified", "invalid", "frame", "card"]),
      url: z.string(),
      source: z.string().nullable(),
      card: z.object({ title: z.string(), site: z.string(), summary: z.string().nullable(), image: z.string().nullable() }).nullable(),
    }),
  },
  "canvas.renderer": {
    experimental_description: "The board renderer for a host outside BB's web UI (the iOS app): one classic script and its version (a hash of its text, the same for the same build). version: the one the caller has; then js is null when it's still the current one.",
    input: z.object({ version: z.string().max(64).nullable().optional() }).nullable(),
    output: z.object({ version: z.string(), js: z.string().nullable() }),
  },
});
