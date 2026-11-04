// The canvas tools: one definition for the canvas thread's agent (zod, via
// bb.agents.registerTool) and for the hands-free voice (JSON Schema, in the
// OpenAI session). Both run through runCanvasTool, scoped to one canvas.
import { z } from "zod";
import { designGuide } from "./guides";
import { KIND_LINES } from "./instructions";
import { LOOK_INFO, lookOf, ORGANIC_LOOKS, type OrganicLook } from "./looks";
import { focusOf } from "./layout";
import { CANVAS_LIMITS, COMPOSITION_INFO, COMPOSITIONS, itemInputSchema, itemPatchSchema, jsonBytes, ITEM_ID } from "./shared";
import type { CanvasActor, CanvasOp, CanvasStore, EditResult } from "./store";

export const CANVAS_TOOL_NAMES = ["canvas_read", "canvas_add", "canvas_update", "canvas_remove", "canvas_clear", "canvas_set", "canvas_style", "canvas_guide"] as const;
export type CanvasToolName = (typeof CANVAS_TOOL_NAMES)[number];
export const isCanvasTool = (name: string): name is CanvasToolName => (CANVAS_TOOL_NAMES as readonly string[]).includes(name);

const items = z.array(itemInputSchema).min(1).max(CANVAS_LIMITS.perCall);
/** The board styles the agent picks from (looks.ts; classic isn't one). */
const style = z.enum(ORGANIC_LOOKS as [OrganicLook, ...OrganicLook[]]);
const styleReason = z.string().max(200).optional();
/** The board's topic, for the canvas's title (a few words). */
const title = z.string().trim().min(1).max(CANVAS_LIMITS.title).optional();
const composition = z.enum(COMPOSITIONS).optional();
const sameComposition = z.boolean().optional();

export const CANVAS_TOOL_PARAMS = {
  canvas_read: z.object({}),
  canvas_add: z.object({ items }),
  canvas_update: z.object({ items: z.array(itemPatchSchema).min(1).max(CANVAS_LIMITS.perCall) }),
  canvas_remove: z.object({ ids: z.array(z.string().regex(ITEM_ID)).min(1).max(CANVAS_LIMITS.items) }),
  canvas_clear: z.object({ style: style.optional(), styleReason, title }),
  canvas_set: z.object({ items: z.array(itemInputSchema).max(CANVAS_LIMITS.items), style: style.optional(), styleReason, title, composition, sameComposition }),
  canvas_style: z.object({ style, reason: styleReason }),
  canvas_guide: z.object({ style: style.optional() }),
} satisfies Record<CanvasToolName, z.ZodType>;

const ITEM_HELP = `Each item: id? (short, like "turnout-chart"; made from the title when left out), kind, title?, data, options?, html? (custom only), importance? (1–5, default 3), size? (s|m|l|xl, a fallback for scale). Placement (rough; Studio composes it, never on a grid): scale? (hero|large|medium|small|tiny: one hero, the rest at clearly different scales), region? (top-left|top|top-right|left|center|right|bottom-left|bottom|bottom-right), pinnedTo? (an id: placed right next to it, nothing drawn between) with point? ({x, y} 0–1 on it) and side? (left|right|above|below), bleed? (true: runs off the edge). Kinds:\n${KIND_LINES}`;
const COMPOSITION_HELP = `composition (each new board; never the same as the last board unless the user asks): ${COMPOSITIONS.map((name) => `${name} (${COMPOSITION_INFO[name]})`).join("; ")}.`;

export const CANVAS_TOOL_DESCRIPTIONS: Record<CanvasToolName, string> = {
  canvas_read: "Read this canvas: each item's id, kind, title, size, importance and data, the focus item, and the latest changes. Read it before editing when you're unsure what's on the board.",
  canvas_add: `Add items to this canvas's board. The user sees them appear at once; Studio places them by importance and size. ${ITEM_HELP}`,
  canvas_update: "Change items in place: pass each item's id and the fields to change. data and html replace; options merge (null removes a key; replaceOptions replaces them). Raise importance to make an item the focus. The user sees the change highlighted.",
  canvas_remove: "Remove items that no longer matter, by id.",
  canvas_clear: "Clear the board, for a topic change; style (and styleReason) switches its style at the same time, and title names the new topic (a few words; the canvas's title). Then add the new items (or use canvas_set to do both in one step).",
  canvas_set: `Replace the whole board in one step: items whose id is already there update in place, new ones appear, the rest leave. Use it on a topic change, or to rebuild. style picks the board's style: editorial (news, stories, explainers), field (brainstorming, planning, ideas), instrument (dense data, monitoring, comparisons); give styleReason in a few words. Set it on your first board and when the topic changes kind; the switch animates. title: the topic in a few words (the canvas's title); set it whenever the topic changes. ${COMPOSITION_HELP} ${ITEM_HELP}`,
  canvas_style: "Switch the board's style without rebuilding it: editorial, field or instrument, with the reason in a few words. Use it when the user asks for a style (\"make this a whiteboard\" is field) or the content changes kind.",
  canvas_guide: "The design guide: how to choose a style, what makes a rich board, the tokens, the kit (window.cv) for custom components, quote accents, and examples. style narrows it to one style's rules and examples.",
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
  const look = lookOf(row.look);
  const styleLine = look === "classic" ? "" : ` Style: ${look} (${LOOK_INFO[look].name}).${row.composition ? ` Composition: ${row.composition}.` : ""} Title: "${row.title}".`;
  if (!board.length) return `The board is empty (revision ${row.rev}, turn ${row.turn}).${styleLine}`;
  const focus = focusOf(board);
  const lines = board.map((item) => {
    const data = jsonBytes(item.data) > 1500 ? `${JSON.stringify(item.data).slice(0, 1500)}… (clipped)` : JSON.stringify(item.data);
    const options = Object.keys(item.options).length ? ` options=${JSON.stringify(item.options).slice(0, 400)}` : "";
    const place = `${item.scale ? `, scale ${item.scale}` : ""}${item.region ? `, region ${item.region}` : ""}${item.bleed ? ", bleeds" : ""}${item.pinnedTo ? `, pinned to ${item.pinnedTo}${item.point ? ` at ${item.point.x},${item.point.y}` : ""}${item.side ? ` (${item.side})` : ""}` : ""}`;
    return `- ${item.id}: ${item.kind}${item.title ? ` "${item.title}"` : ""}, size ${item.size}, importance ${item.importance}${item.id === focus?.id ? " (focus)" : ""}${place}${item.html ? `, html ${item.html.length} chars` : ""}\n  data=${data}${options}`;
  });
  const changes = store.changes(canvasId, 12).map((change) => `- turn ${change.turn}, rev ${change.rev} (${change.by}): ${change.summary}`);
  return [`Board (revision ${row.rev}, turn ${row.turn}), ${board.length} item(s).${styleLine}`, ...lines, "", "Latest changes:", ...changes].join("\n");
}

/** A request for something to look at: a showcase, a gallery, pictures. */
const VISUAL_ASK = /\b(showcase|show me|gallery|pictures?|photos?|images?|what (does|do) .* look like)\b/i;

/** After canvas_set in a style: what a thin or heroless board still needs (the board is already shown). */
export function boardAdvice(items: readonly { kind: string; scale?: string | null }[], asked: string | null = null): string {
  const advice: string[] = [];
  if (asked && VISUAL_ASK.test(asked) && !items.some((item) => item.kind === "image")) advice.push("the user asked to see things: add image items with real pictures (covers, box art, photos) from web search; one that fails to load shows its name on a tile, so don't leave them out");
  if (items.length && items.length < 5) advice.push(`it has only ${items.length} pieces: add 2–5 more that each say something specific (numbers with context, a chart, pictures, a quote), at different scales, so the board fills the screen`);
  if (items.length && !items.some((item) => item.scale === "hero")) advice.push("no piece is the hero: give the one that answers the question scale \"hero\"");
  return advice.length ? ` Still to do: ${advice.join("; ")}.` : "";
}

function summarize(result: EditResult, focus: { id: string } | null): string {
  // (the style line, when it changed, is one of the changes)
  const done = result.changes.map((change) => change.summary).join("; ") || "No change.";
  const ids = result.items.map((item) => item.id).join(", ") || "nothing";
  return `${done}. The board now shows ${result.items.length} item(s): ${ids}${focus ? `; the focus is ${focus.id}` : ""}.`;
}

/** The edits a tool call makes; validated input. */
export function toolOps(name: Exclude<CanvasToolName, "canvas_read" | "canvas_guide">, input: unknown): CanvasOp[] {
  const styled = (look: OrganicLook | undefined, reason: string | undefined): CanvasOp[] => (look ? [{ op: "style", look, reason: reason ?? null }] : []);
  switch (name) {
    case "canvas_add": return CANVAS_TOOL_PARAMS.canvas_add.parse(input).items.map((item) => ({ op: "add", item }));
    case "canvas_update": return CANVAS_TOOL_PARAMS.canvas_update.parse(input).items.map((patch) => ({ op: "update", patch }));
    case "canvas_remove": return CANVAS_TOOL_PARAMS.canvas_remove.parse(input).ids.map((id) => ({ op: "remove", id }));
    case "canvas_clear": { const parsed = CANVAS_TOOL_PARAMS.canvas_clear.parse(input ?? {}); return [{ op: "clear" }, ...styled(parsed.style, parsed.styleReason), ...(parsed.title ? [{ op: "board" as const, title: parsed.title }] : [])]; }
    case "canvas_set": {
      const parsed = CANVAS_TOOL_PARAMS.canvas_set.parse(input);
      const board: CanvasOp[] = parsed.title || parsed.composition ? [{ op: "board", title: parsed.title ?? null, composition: parsed.composition ?? null, sameComposition: parsed.sameComposition }] : [];
      return [...styled(parsed.style, parsed.styleReason), { op: "set", items: parsed.items }, ...board];
    }
    case "canvas_style": { const parsed = CANVAS_TOOL_PARAMS.canvas_style.parse(input); return styled(parsed.style, parsed.reason); }
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
      if (look === "classic") return { text: "This canvas uses the classic look: the canvas skill covers it.", changed: false };
      const asked = CANVAS_TOOL_PARAMS.canvas_guide.parse(input ?? {}).style;
      return { text: designGuide(asked ?? null), changed: false };
    }
    const result = store.edit(canvasId, toolOps(name, input), by);
    const look = lookOf(store.get(canvasId)?.look);
    return { text: summarize(result, focusOf(result.items)) + (name === "canvas_set" && look !== "classic" ? boardAdvice(result.items, [...store.history(canvasId, 6)].reverse().find((line) => line.role === "user" || line.role === "voice")?.text ?? null) : ""), changed: true };
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")
      : error instanceof Error ? error.message : String(error);
    return { text: `Nothing changed: ${message}`, changed: false, error: true };
  }
}
