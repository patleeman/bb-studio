// The canvas tools: one definition for the canvas thread's agent (zod, via
// bb.agents.registerTool) and for the hands-free voice (JSON Schema, in the
// OpenAI session). Both run through runCanvasTool, scoped to one canvas.
//
// The agent writes the whole board as one HTML page (canvas_page) and
// changes parts of it by their data-cv-id (canvas_patch). canvas_image
// finds a picture's address for the page, and canvas_images a batch of them
// at once (in parallel). Boards of items from before
// pages still show; canvas_page replaces them.
import { z } from "zod";
import { designGuide } from "./guides";
import { findImage, findImages, IMAGE_BATCH_MAX, type ImageDeps, type ImageResult } from "./image";
import { LOOK_INFO, lookOf, ORGANIC_LOOKS, type OrganicLook } from "./looks";
import { fillPictures, outline } from "./page";
import { CANVAS_LIMITS, jsonBytes } from "./shared";
import type { CanvasActor, CanvasStore } from "./store";

export const CANVAS_TOOL_NAMES = ["canvas_read", "canvas_page", "canvas_patch", "canvas_style", "canvas_image", "canvas_images", "canvas_guide"] as const;
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
    caption: z.string().trim().min(1).max(CANVAS_LIMITS.captionChars).optional(),
  }),
  canvas_patch: z.object({ id: z.string().regex(PART_ID), html: z.string().max(CANVAS_LIMITS.pageBytes) }),
  canvas_style: z.object({ style, reason: z.string().max(200).optional() }),
  canvas_image: z.object({ query: z.string().trim().min(1).max(200).optional(), pageUrl: z.string().url().max(2000).optional() }),
  canvas_images: z.object({
    items: z.array(z.object({
      key: z.string().trim().min(1).max(64),
      query: z.string().trim().min(1).max(200).optional(),
      pageUrl: z.string().url().max(2000).optional(),
    }).refine((item) => !!item.query || !!item.pageUrl, { message: "give query or pageUrl" })).min(1).max(IMAGE_BATCH_MAX)
      .refine((items) => new Set(items.map((item) => item.key)).size === items.length, { message: "each key once" }),
  }),
  canvas_guide: z.object({}),
} satisfies Record<CanvasToolName, z.ZodType>;

export const CANVAS_TOOL_DESCRIPTIONS: Record<CanvasToolName, string> = {
  canvas_read: "Read this canvas: its style, title and the page's source (or, for a board from before pages, its items), with the ids of its parts, and the latest changes.",
  canvas_page: "For a message from the hands-free voice (in a text turn, write the page in your reply as one ```html block instead: it shows while you write). Show a new version of the whole board: one HTML page you design for this answer (HTML and CSS, no <html>/<head>; scripts allowed). It renders in a sandboxed frame the size of the screen, with the style's tokens (--cv-* CSS variables), the kit's classes and charts (data-chart), and no network except https images. Mark each part with a stable data-cv-id: between versions, parts with the same id glide to their new place, new ones come in, gone ones leave. title names the topic (else the page's first heading). style switches the board's style: editorial, field or instrument (with styleReason). caption: with the FINAL page, the caption under the board (your reply's one or two sentences), shown with the page at once; then reply with that same caption.",
  canvas_patch: "Change one part of the page in place: id is its data-cv-id, html replaces that whole element (keep the data-cv-id on it so it animates); an empty html removes it.",
  canvas_style: "Switch the board's style without rewriting the page: editorial, field or instrument, with the reason in a few words. The page's tokens change and it animates.",
  canvas_image: "Find one picture for the page (box art, a cover, a product shot, a photo): returns {url, alt, source, width?, height?}, an https address the page can show in an <img>. query is the thing's name only (\"Tetris DX\", no platform or \"box art\"); pageUrl takes the main picture of a page about it. For more than one picture, use canvas_images.",
  canvas_images: "Find all the page's pictures in ONE call, looked up in parallel: items [{key, query?, pageUrl?}] (up to 24). key is the card's data-cv-id: each card (data-block=\"card\") with that id gets the picture by itself, on the board, in the page in your reply and in every later version, so never copy the addresses into the page; query is the thing's name only (\"Tetris DX\", no platform or \"box art\"; found on the web or Wikipedia); pageUrl takes the main picture of a page about it. Returns {key: {url, alt, source} or {error}}. Answers are cached for a day.",
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
  const versions = store.versions(canvasId);
  const viewing = store.viewing(canvasId);
  const at = viewing === null ? -1 : versions.findIndex((version) => version.n === viewing);
  const shown = at >= 0 ? ` The user is looking at version ${at + 1} of ${versions.length}${versions[at]!.prompt ? ` ("${versions[at]!.prompt!.replace(/\s+/g, " ").slice(0, 160)}")` : ""}, not the latest; a message they send continues from it. Below is the latest board.` : "";
  const head = `Canvas (revision ${row.rev}, turn ${row.turn}${versions.length ? `, ${versions.length} version${versions.length === 1 ? "" : "s"}` : ""}). Style: ${look === "classic" ? "classic" : `${look} (${LOOK_INFO[look].name})`}. Title: "${row.title}".${shown}`;
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

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * When most of the last version's parts lost their ids while their content is still on the page, the agent
 * renamed them, so they come in fresh instead of gliding. The result says which old ids to put back, so it can
 * redo the page.
 */
export function renamedParts(before: string | null, after: string): string {
  if (!before) return "";
  const old = outline(before), now = outline(after);
  if (old.length < 3) return "";
  const ids = new Set(now.map((part) => part.id));
  const gone = old.filter((part) => !ids.has(part.id));
  if (gone.length / old.length <= 0.5) return "";
  const pairs: string[] = [];
  for (const part of gone) {
    const words = norm(part.text).split(" ").slice(0, 6).join(" ");
    if (words.length < 8) continue;
    const match = now.find((each) => !old.some((o) => o.id === each.id) && norm(each.text).includes(words));
    if (match) pairs.push(`"${match.id}" → "${part.id}"`);
  }
  if (pairs.length < 2) return "";
  return ` Most parts got new ids though their content is still here, so they came in fresh instead of gliding. Keep the old id for anything that persists and send the page again: ${pairs.join(", ")}.`;
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
        const before = store.get(canvasId)?.page ?? null;
        const { html, filled } = fillPictures(parsed.html, store.pictures(canvasId));
        const { rev, parts } = store.setPage(canvasId, html, by, parsed.title ?? null);
        // The caption shows with the page, without waiting for the reply; the reply (the same words) is what a voice reads back.
        if (parsed.caption) store.setCaption(canvasId, parsed.caption);
        const advice = parts ? renamedParts(before, parsed.html) : " No part has a data-cv-id, so the next version can't animate part by part: mark the main parts.";
        const pictured = filled.length ? ` Pictures from canvas_images went into ${filled.length} card${filled.length === 1 ? "" : "s"} (${filled.join(", ")}).` : "";
        const close = parsed.caption ? " The caption is up: now reply with exactly that caption and stop." : "";
        return { text: `The page is up (revision ${rev}, ${parts} part${parts === 1 ? "" : "s"}).${styled} Title: "${store.get(canvasId)!.title}".${pictured}${advice}${close}`, changed: true };
      }
      case "canvas_patch": {
        const parsed = CANVAS_TOOL_PARAMS.canvas_patch.parse(input);
        const { rev } = store.patchPage(canvasId, parsed.id, fillPictures(parsed.html, store.pictures(canvasId)).html, by);
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
      case "canvas_images": {
        const parsed = CANVAS_TOOL_PARAMS.canvas_images.parse(input ?? {});
        if (!images) return { text: "Pictures can't be looked up here.", changed: false, error: true };
        const found = await findImages(parsed.items, images);
        const pictures = Object.fromEntries(Object.entries(found).filter((entry): entry is [string, ImageResult] => !("error" in entry[1])));
        store.rememberPictures(canvasId, pictures);
        // Cards already on the page (a draft) get their pictures now.
        const page = store.get(canvasId)?.page ?? null;
        const { html, filled } = page ? fillPictures(page, store.pictures(canvasId)) : { html: "", filled: [] };
        if (filled.length) store.setPage(canvasId, html, by);
        const missing = Object.values(found).filter((answer) => "error" in answer).length;
        const note = missing ? ` (${missing} not found: leave those as a card without a picture, or retry them with pageUrl)` : "";
        const placed = ` Each card whose data-cv-id is a key gets its picture by itself${filled.length ? ` (already in: ${filled.join(", ")})` : ""}: don't copy these addresses into the page.`;
        return { text: `${JSON.stringify(found)}${note}${placed}`, changed: filled.length > 0 };
      }
    }
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")
      : error instanceof Error ? error.message : String(error);
    return { text: `Nothing changed: ${message}`, changed: false, error: true };
  }
}
