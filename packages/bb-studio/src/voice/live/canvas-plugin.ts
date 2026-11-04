// The Visual Chat plugin (packages/bb-studio-visual-chat; it calls a board a canvas), seen from hands-free voice: the
// RPCs Studio calls when a session's launching thread backs a canvas. Only
// their answers' shapes live here; the canvas, its board and its tools are
// the plugin's own. Not installed: the call fails and the session gets no
// canvas tools.
import { z } from "zod";

export const CANVAS_PLUGIN_ID = "studio-visual-chat";

export const canvasVoiceOutput = z.object({
  tools: z.array(z.object({ type: z.literal("function"), name: z.string().regex(/^canvas_[a-z_]+$/), description: z.string(), parameters: z.record(z.string(), z.unknown()) })),
  instructions: z.string().max(4000).nullable(),
});

export const canvasVoiceRunOutput = z.object({ output: z.string().nullable() });
