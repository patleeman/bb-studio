// The canvas tools: one definition for the canvas thread's agent (zod, via
// bb.agents.registerTool) and for the hands-free voice (JSON Schema, in the
// OpenAI session). Both run through runCanvasTool, scoped to one canvas.
import { z } from "zod";
import { designGuide } from "./guides";
import { KIND_LINES } from "./instructions";
import { lookOf } from "./looks";
import { focusOf } from "./layout";
import { CANVAS_LIMITS, itemInputSchema, itemPatchSchema, jsonBytes, ITEM_ID } from "./shared";
import type { CanvasActor, CanvasOp, CanvasStore, EditResult } from "./store";

export const CANVAS_TOOL_NAMES = ["canvas_read", "canvas_add", "canvas_update", "canvas_remove", "canvas_clear", "canvas_set", "canvas_guide"] as const;
export type CanvasToolName = (typeof CANVAS_TOOL_NAMES)[number];
export const isCanvasTool = (name: string): name is CanvasToolName => (CANVAS_TOOL_NAMES as readonly string[]).includes(name);

const items = z.array(itemInputSchema).min(1).max(CANVAS_LIMITS.perCall);

export const CANVAS_TOOL_PARAMS = {
  canvas_read: z.object({}),
  canvas_add: z.object({ items }),
  canvas_update: z.object({ items: z.array(itemPatchSchema).min(1).max(CANVAS_LIMITS.perCall) }),
  canvas_remove: z.object({ ids: z.array(z.string().regex(ITEM_ID)).min(1).max(CANVAS_LIMITS.items) }),
  canvas_clear: z.object({}),
  canvas_set: z.object({ items: z.array(itemInputSchema).max(CANVAS_LIMITS.items) }),
  canvas_guide: z.object({}),
} satisfies Record<CanvasToolName, z.ZodType>;

const ITEM_HELP = `Each item: id? (short, like "turnout-chart"; made from the title when left out), kind, title?, data, options?, html? (custom only), size? (s|m|l|xl), importance? (1–5, default 3), relatedTo? (ids: connectors), anchor? (an id: a note points at it), point? ({x, y} 0–1 on the anchor). Kinds:\n${KIND_LINES}`;

export const CANVAS_TOOL_DESCRIPTIONS: Record<CanvasToolName, string> = {
  canvas_read: "Read this canvas: each item's id, kind, title, size, importance and data, the focus item, and the latest changes. Read it before editing when you're unsure what's on the board.",
  canvas_add: `Add items to this canvas's board. The user sees them appear at once; Studio places them by importance and size. ${ITEM_HELP}`,
  canvas_update: "Change items in place: pass each item's id and the fields to change. data and html replace; options merge (null removes a key; replaceOptions replaces them). Raise importance to make an item the focus. The user sees the change highlighted.",
  canvas_remove: "Remove items that no longer matter, by id.",
  canvas_clear: "Clear the board, for a topic change. Then add the new items (or use canvas_set to do both in one step).",
  canvas_set: `Replace the whole board in one step: items whose id is already there update in place, new ones appear, the rest leave. Use it on a topic change, or to rebuild. ${ITEM_HELP}`,
  canvas_guide: "The design guide for this canvas's look: what makes a rich board, the tokens, the kit (window.cv) for custom components, and examples to adapt.",
};

/** For the voice session (session.ts): OpenAI function tools with the same parameters. */
export function canvasVoiceTools(): { type: "function"; name: CanvasToolName; description: string; parameters: Record<string, unknown> }[] {
  return CANVAS_TOOL_NAMES.map((name) => {
    const schema = z.toJSONSchema(CANVAS_TOOL_PARAMS[name], { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete schema.$schema;
    return { type: "function", name, description: CANVAS_TOOL_DESCRIPTIONS[name], parameters: schema };
  });
}

/** The board as the agent reads it: compact JSON per item, big data clipped. */
export function describeBoard(store: CanvasStore, canvasId: string): string {
  const board = store.items(canvasId);
  const row = store.get(canvasId)!;
  if (!board.length) return `The board is empty (revision ${row.rev}, turn ${row.turn}).`;
  const focus = focusOf(board);
  const lines = board.map((item) => {
    const data = jsonBytes(item.data) > 1500 ? `${JSON.stringify(item.data).slice(0, 1500)}… (clipped)` : JSON.stringify(item.data);
    const options = Object.keys(item.options).length ? ` options=${JSON.stringify(item.options).slice(0, 400)}` : "";
    const rel = `${item.relatedTo.length ? `, related to ${item.relatedTo.join(", ")}` : ""}${item.anchor ? `, anchored to ${item.anchor}${item.point ? ` at ${item.point.x},${item.point.y}` : ""}` : ""}`;
    return `- ${item.id}: ${item.kind}${item.title ? ` "${item.title}"` : ""}, size ${item.size}, importance ${item.importance}${item.id === focus?.id ? " (focus)" : ""}${rel}${item.html ? `, html ${item.html.length} chars` : ""}\n  data=${data}${options}`;
  });
  const changes = store.changes(canvasId, 12).map((change) => `- turn ${change.turn}, rev ${change.rev} (${change.by}): ${change.summary}`);
  return [`Board (revision ${row.rev}, turn ${row.turn}), ${board.length} item(s):`, ...lines, "", "Latest changes:", ...changes].join("\n");
}

function summarize(result: EditResult, focus: { id: string } | null): string {
  const done = result.changes.map((change) => change.summary).join("; ") || "No change.";
  const ids = result.items.map((item) => item.id).join(", ") || "nothing";
  return `${done}. The board now shows ${result.items.length} item(s): ${ids}${focus ? `; the focus is ${focus.id}` : ""}.`;
}

/** The edits a tool call makes; validated input. */
export function toolOps(name: Exclude<CanvasToolName, "canvas_read" | "canvas_guide">, input: unknown): CanvasOp[] {
  switch (name) {
    case "canvas_add": return CANVAS_TOOL_PARAMS.canvas_add.parse(input).items.map((item) => ({ op: "add", item }));
    case "canvas_update": return CANVAS_TOOL_PARAMS.canvas_update.parse(input).items.map((patch) => ({ op: "update", patch }));
    case "canvas_remove": return CANVAS_TOOL_PARAMS.canvas_remove.parse(input).ids.map((id) => ({ op: "remove", id }));
    case "canvas_clear": return [{ op: "clear" }];
    case "canvas_set": return [{ op: "set", items: CANVAS_TOOL_PARAMS.canvas_set.parse(input).items }];
  }
}

/**
 * Runs one canvas tool on one canvas. Returns the text the model gets;
 * `changed` says whether the board moved (so the caller publishes).
 */
export function runCanvasTool(store: CanvasStore, canvasId: string, name: CanvasToolName, input: unknown, by: CanvasActor): { text: string; changed: boolean; error?: boolean } {
  try {
    if (name === "canvas_read") return { text: describeBoard(store, canvasId), changed: false };
    if (name === "canvas_guide") {
      const look = lookOf(store.get(canvasId)?.look);
      return { text: look === "classic" ? "This canvas uses the classic look: the canvas skill covers it." : designGuide(look), changed: false };
    }
    const result = store.edit(canvasId, toolOps(name, input), by);
    return { text: summarize(result, focusOf(result.items)), changed: true };
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")
      : error instanceof Error ? error.message : String(error);
    return { text: `Nothing changed: ${message}`, changed: false, error: true };
  }
}
