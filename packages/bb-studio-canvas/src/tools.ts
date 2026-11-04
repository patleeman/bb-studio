// The canvas tools: one definition for the canvas thread's agent (zod, via
// bb.agents.registerTool) and for the hands-free voice (JSON Schema, in the
// OpenAI session). Both run through runCanvasTool, scoped to one canvas.
//
// The agent writes the whole board as one HTML page (canvas_page) and
// changes parts of it by their data-cv-id (canvas_patch). canvas_image
// finds a picture's address for the page. Boards of items from before
// pages still show; canvas_page replaces them.
import { z } from "zod";
import { designGuide } from "./guides";
import { findImage, type ImageDeps } from "./image";
import { LOOK_INFO, lookOf, ORGANIC_LOOKS, type OrganicLook } from "./looks";
import { outline } from "./page";
import { CANVAS_LIMITS, jsonBytes } from "./shared";
import type { CanvasActor, CanvasStore } from "./store";

export const CANVAS_TOOL_NAMES = ["canvas_read", "canvas_page", "canvas_patch", "canvas_style", "canvas_image", "canvas_guide"] as const;
export type CanvasToolName = (typeof CANVAS_TOOL_NAMES)[number];
export const isCanvasTool = (name: string): name is CanvasToolName => (CANVAS_TOOL_NAMES as readonly string[]).includes(name);

/** The board styles the agent picks from (looks.ts; classic isn't one). */
const style = z.enum(ORGANIC_LOOKS as [OrganicLook, ...OrganicLook[]]);
const PART_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const CANVAS_TOOL_PARAMS = {
  canvas_read: z.object({}),
  canvas_page: z.object({
    html: z.string().min(1).max(CANVAS_LIMITS.pageBytes),
    title: z.string().trim().min(1).max(CANVAS_LIMITS.title).optional(),
    style: style.optional(),
    styleReason: z.string().max(200).optional(),
  }),
  canvas_patch: z.object({ id: z.string().regex(PART_ID), html: z.string().max(CANVAS_LIMITS.pageBytes) }),
  canvas_style: z.object({ style, reason: z.string().max(200).optional() }),
  canvas_image: z.object({ query: z.string().trim().min(1).max(200).optional(), pageUrl: z.string().url().max(2000).optional() }),
  canvas_guide: z.object({}),
} satisfies Record<CanvasToolName, z.ZodType>;

export const CANVAS_TOOL_DESCRIPTIONS: Record<CanvasToolName, string> = {
  canvas_read: "Read this canvas: its style, title and the page's source (or, for a board from before pages, its items), with the ids of its parts, and the latest changes.",
  canvas_page: "Show a new version of the whole board: one HTML page you design for this answer (HTML and CSS, no <html>/<head>; scripts allowed). It renders in a sandboxed frame the size of the screen, with the style's tokens (--cv-* CSS variables), the kit's classes and charts (data-chart), and no network except https images. Mark each part with a stable data-cv-id: between versions, parts with the same id glide to their new place, new ones come in, gone ones leave. title names the topic (else the page's first heading). style switches the board's style: editorial, field or instrument (with styleReason).",
  canvas_patch: "Change one part of the page in place: id is its data-cv-id, html replaces that whole element (keep the data-cv-id on it so it animates); an empty html removes it.",
  canvas_style: "Switch the board's style without rewriting the page: editorial, field or instrument, with the reason in a few words. The page's tokens change and it animates.",
  canvas_image: "Find a picture for the page (box art, a cover, a product shot, a photo): returns {url, alt, source, width?, height?}, an https address the page can show in an <img>. query searches for it (when image search is set up); pageUrl takes the main picture of a page you found (a store, publisher or Wikipedia page). Call it once per picture.",
  canvas_guide: "The design guide again: how to tell the story on one page, the style tokens, the kit and the examples.",
};

/** For the voice session (session.ts): OpenAI function tools with the same parameters. */
export function canvasVoiceTools(): { type: "function"; name: CanvasToolName; description: string; parameters: Record<string, unknown> }[] {
  return CANVAS_TOOL_NAMES.map((name) => {
    const schema = z.toJSONSchema(CANVAS_TOOL_PARAMS[name], { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete schema.$schema;
    return { type: "function", name, description: CANVAS_TOOL_DESCRIPTIONS[name], parameters: schema };
  });
}

/** The board as the agent reads it: the page's source with its parts, or the old items. */
export function describeBoard(store: CanvasStore, canvasId: string): string {
  const row = store.get(canvasId)!;
  const look = lookOf(row.look);
  const head = `Canvas (revision ${row.rev}, turn ${row.turn}). Style: ${look === "classic" ? "classic" : `${look} (${LOOK_INFO[look].name})`}. Title: "${row.title}".`;
  const changes = store.changes(canvasId, 12).map((change) => `- turn ${change.turn}, rev ${change.rev} (${change.by}): ${change.summary}`);
  const tail = ["", "Latest changes:", ...(changes.length ? changes : ["- none"])];
  if (row.page) {
    const parts = outline(row.page).map((part) => `- ${part.id} <${part.tag}> ${part.text}`);
    return [head, "", "Parts (data-cv-id):", ...(parts.length ? parts : ["- none: mark parts with data-cv-id so they animate"]), "", "Page source:", row.page, ...tail].join("\n");
  }
  const items = store.items(canvasId);
  if (!items.length) return [`${head} The board is empty: write it with canvas_page.`, ...tail].join("\n");
  const lines = items.map((item) => {
    const data = jsonBytes(item.data) > 1500 ? `${JSON.stringify(item.data).slice(0, 1500)}… (clipped)` : JSON.stringify(item.data);
    return `- ${item.id}: ${item.kind}${item.title ? ` "${item.title}"` : ""}\n  data=${data}`;
  });
  return [head, "", "This board is from before pages: these items show as they are. canvas_page replaces them with a page.", ...lines, ...tail].join("\n");
}

/**
 * Runs one canvas tool on one canvas. Returns the text the model gets;
 * `changed` says whether the board moved (so the caller publishes).
 */
export async function runCanvasTool(store: CanvasStore, canvasId: string, name: CanvasToolName, input: unknown, by: CanvasActor, images?: ImageDeps): Promise<{ text: string; changed: boolean; error?: boolean }> {
  try {
    switch (name) {
      case "canvas_read": return { text: describeBoard(store, canvasId), changed: false };
      case "canvas_guide": return { text: designGuide(), changed: false };
      case "canvas_page": {
        const parsed = CANVAS_TOOL_PARAMS.canvas_page.parse(input);
        let styled = "";
        if (parsed.style) {
          // The store logs a switch, and the agent's first pick with its reason.
          if (parsed.style !== store.get(canvasId)?.look || !store.changes(canvasId, 200).some((change) => change.op === "style")) store.edit(canvasId, [{ op: "style", look: parsed.style, reason: parsed.styleReason ?? null }], by);
          styled = ` Style: ${LOOK_INFO[parsed.style].name}.`;
        }
        const { rev, parts } = store.setPage(canvasId, parsed.html, by, parsed.title ?? null);
        const advice = parts ? "" : " No part has a data-cv-id, so the next version can't animate part by part: mark the main parts.";
        return { text: `The page is up (revision ${rev}, ${parts} part${parts === 1 ? "" : "s"}).${styled} Title: "${store.get(canvasId)!.title}".${advice}`, changed: true };
      }
      case "canvas_patch": {
        const parsed = CANVAS_TOOL_PARAMS.canvas_patch.parse(input);
        const { rev } = store.patchPage(canvasId, parsed.id, parsed.html, by);
        return { text: `${parsed.html.trim() ? "Changed" : "Removed"} part "${parsed.id}" (revision ${rev}).`, changed: true };
      }
      case "canvas_style": {
        const parsed = CANVAS_TOOL_PARAMS.canvas_style.parse(input);
        store.edit(canvasId, [{ op: "style", look: parsed.style, reason: parsed.reason ?? null }], by);
        return { text: `Style: ${LOOK_INFO[parsed.style].name}.`, changed: true };
      }
      case "canvas_image": {
        const parsed = CANVAS_TOOL_PARAMS.canvas_image.parse(input ?? {});
        if (!images) return { text: "Pictures can't be looked up here.", changed: false, error: true };
        const image = await findImage(parsed, images);
        return { text: JSON.stringify(image), changed: false };
      }
    }
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")
      : error instanceof Error ? error.message : String(error);
    return { text: `Nothing changed: ${message}`, changed: false, error: true };
  }
}
