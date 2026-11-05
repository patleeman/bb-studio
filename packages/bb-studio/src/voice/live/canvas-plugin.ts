// The Visual Chat plugin (packages/bb-studio-visual-chat; it calls a board a canvas), seen from hands-free voice: the
// RPCs Studio calls when a session's launching thread backs a canvas. Only
// their answers' shapes live here; the canvas, its board and its tools are
// the plugin's own. Not installed: the call fails and the session gets no
// canvas tools.
import { z } from "zod";

export const CANVAS_PLUGIN_ID = "studio-visual-chat";
/** The ids Visual Chat has had (BB Studio Canvas, and Canvas before it): the threads they spawned are canvas threads. */
export const CANVAS_PLUGIN_IDS = [CANVAS_PLUGIN_ID, "studio-canvas", "canvas"] as const;

/**
 * Whether a thread backs a Visual Chat canvas, from who spawned it (agents.configure's origin.pluginId, BB's
 * originPluginId). Such a thread designs its board with Visual Chat's own canvas_* tools; Studio's tools, skill
 * and instructions would only fill its context, and on Claude Code keep its tool set too big to load up front.
 */
export const isCanvasThreadOrigin = (origin: { pluginId: string | null } | null | undefined): boolean =>
  !!origin?.pluginId && (CANVAS_PLUGIN_IDS as readonly string[]).includes(origin.pluginId);

export const canvasVoiceOutput = z.object({
  tools: z.array(z.object({ type: z.literal("function"), name: z.string().regex(/^canvas_[a-z_]+$/), description: z.string(), parameters: z.record(z.string(), z.unknown()) })),
  instructions: z.string().max(4000).nullable(),
});

export const canvasVoiceRunOutput = z.object({ output: z.string().nullable() });
