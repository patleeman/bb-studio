// Canvas (prototype): names, limits and shapes the server, the app and the
// agent tools share. Imports only zod, so the app can use it without the SDK.
//
// A canvas is a board the agent edits each turn, backed by a hidden BB
// thread (its memory). The board holds items: Dashboards' widget types, plus
// a headline and a caption. The user never arranges it; the app packs it by
// importance and size (layout.ts).
import { z } from "zod";
import { lookSchema } from "./looks";

/** The canvas plugin's panel: /plugins/canvas/canvas/<threadId>. */
export const CANVAS_SEGMENT = "canvas";
export const CANVAS_ROOT = `/plugins/canvas/${CANVAS_SEGMENT}`;
/** Realtime channel: a board or its caption changed. */
export const CANVAS_CHANNEL = "studio-canvas";
export const CANVAS_UPDATE_TYPE = "canvas:updated";

export interface CanvasSignal { type: typeof CANVAS_UPDATE_TYPE; canvasId: string; threadId: string; rev: number }

export const canvasHref = (threadId?: string | null) => (threadId ? `${CANVAS_ROOT}/${encodeURIComponent(threadId)}` : CANVAS_ROOT);

export const isCanvasId = (value: string) => /^cnv_[0-9a-f]{16}$/.test(value);

/** The thread metadata key Studio stamps on a canvas's backing thread. */
export const CANVAS_METADATA_KEY = "canvas";

export const CANVAS_LIMITS = {
  /** A board shows what matters now, not everything. */
  items: 24,
  /** Items in one add, update or set call. */
  perCall: 24,
  title: 120,
  /** JSON size of one item's data. */
  dataBytes: 64 * 1024,
  /** JSON size of one item's options. */
  optionsBytes: 16 * 1024,
  /** A custom item's HTML. */
  htmlBytes: 100 * 1024,
  /** The caption the page shows: the agent's reply, clipped. */
  captionChars: 600,
  /** A message the user sends. */
  messageChars: 8000,
  /** Change log and history kept per canvas. */
  changesKept: 200,
  turnsKept: 200,
} as const;

/**
 * What an item can be: a headline, a caption, or one of Dashboards' widget
 * types (Studio's src/dashboards/shared.ts WIDGETS), rendered by its
 * renderers. Not Dashboards' embed: it reads Studio's RPCs, which a canvas
 * (another plugin) can't call from its page.
 */
export const CANVAS_KINDS = ["headline", "caption", "stat", "line", "bar", "area", "pie", "table", "list", "ticker", "progress", "image", "custom", "quote", "note", "timeline", "map", "multiples"] as const;
export type CanvasKind = (typeof CANVAS_KINDS)[number];
export const SIZE_HINTS = ["s", "m", "l", "xl"] as const;
export type SizeHint = (typeof SIZE_HINTS)[number];

/** Per kind: what data and options it reads (for agents), and its default size. */
export const CANVAS_KIND_INFO: Record<CanvasKind, { data: string; options: string; size: SizeHint }> = {
  headline: { data: "{text, subtitle?, kicker?, tone?: neutral|good|bad|accent} or a string", options: "none", size: "l" },
  caption: { data: "short Markdown (a few lines), or {markdown}", options: "none", size: "m" },
  stat: { data: "a number; a number array (last is the value); or {value, delta?, trend?: up|down|flat, series?: number[], caption?}", options: "label?, unit?, prefix?, decimals?, invert? (down is good)", size: "s" },
  line: { data: "rows, e.g. [{day: \"Mon\", a: 4}]", options: "x? (category key), series? (numeric keys, max 8), unit?, stacked?", size: "l" },
  bar: { data: "rows", options: "x?, series?, unit?, stacked?", size: "l" },
  area: { data: "rows", options: "x?, series?, unit?, stacked?", size: "l" },
  pie: { data: "rows, e.g. [{label: \"Web\", value: 60}]", options: "x? (label key), series? (first is the value key), unit?", size: "m" },
  table: { data: "an array of objects, or {columns, rows}", options: "columns? (keys in order), maxRows?, wrapColumns?", size: "l" },
  list: { data: "an array of {title, link?, summary?, date?} or strings", options: "maxItems?, showDates?", size: "m" },
  ticker: { data: "an array of {label, value?, delta?} or strings", options: "speed? (seconds per loop)", size: "xl" },
  progress: { data: "a number, or {value, max?, min?, label?}", options: "style? (bar|gauge), min?, max?, unit?, label?", size: "s" },
  image: { data: "a URL string, or none", options: "url, alt?, fit? (cover|contain)", size: "m" },
  custom: { data: "anything; the HTML reads window.bbWidget.data (cv.render)", options: "anything the HTML reads (window.bbWidget.options)", size: "m" },
  quote: { data: "{text, by?, role?} or a string", options: "none", size: "m" },
  note: { data: "a short string, or {text, tone?: accent|good|bad}; with anchor (and point) it points at that item", options: "none", size: "s" },
  timeline: { data: "[{date, label, note?, tone?: good|bad|accent|warn}]", options: "layout? (column|row), highlight? (index or date)", size: "m" },
  map: { data: "US states: {PA: 2.1, ...} or {PA: {value, label?, color?}} or [{state, value, label?, color?}]", options: "scale? (diverging|sequential), legend? [low, high], show? (abbr|value|label), low?, high?", size: "m" },
  multiples: { data: "[{label, values: number[], value?, delta?, note?}]", options: "unit?, shared? (one scale), invert?", size: "l" },
};

const jsonBytes = (value: unknown) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

/** An item id the agent picks: short and readable, like `turnout-chart`. */
export const ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export const itemInputSchema = z.object({
  /** Optional: Studio makes one from the kind and title when left out. */
  id: z.string().regex(ITEM_ID, "Use a short id of lowercase letters, digits, - and _.").optional(),
  kind: z.enum(CANVAS_KINDS),
  title: z.string().max(CANVAS_LIMITS.title).nullable().optional(),
  data: z.unknown().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  /** custom only: the widget's HTML, sandboxed with no network. */
  html: z.string().optional(),
  size: z.enum(SIZE_HINTS).optional(),
  /** 5: the point of the board right now; 1: background. */
  importance: z.number().int().min(1).max(5).optional(),
  /** Items this one relates to: the board draws a connector to each. */
  relatedTo: z.array(z.string().regex(ITEM_ID)).max(6).optional(),
  /** The item this one annotates: a note is placed beside it, pointing at `point`. */
  anchor: z.string().regex(ITEM_ID).nullable().optional(),
  /** Where on the anchor to point, 0–1 from its top-left. */
  point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable().optional(),
});
export type ItemInput = z.infer<typeof itemInputSchema>;

/** An update: the id, and any fields to change. data and html replace; options merge (null removes a key). */
export const itemPatchSchema = itemInputSchema.partial().extend({
  id: z.string().regex(ITEM_ID),
  /** Replace options instead of merging. */
  replaceOptions: z.boolean().optional(),
});
export type ItemPatch = z.infer<typeof itemPatchSchema>;

export const canvasItemSchema = z.object({
  id: z.string(),
  kind: z.enum(CANVAS_KINDS),
  title: z.string().nullable(),
  data: z.unknown(),
  options: z.record(z.string(), z.unknown()),
  html: z.string().nullable(),
  size: z.enum(SIZE_HINTS),
  importance: z.number(),
  relatedTo: z.array(z.string()),
  anchor: z.string().nullable(),
  point: z.object({ x: z.number(), y: z.number() }).nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** The board revision that last changed it. */
  rev: z.number(),
});
export type CanvasItem = z.infer<typeof canvasItemSchema>;

export const CHANGE_OPS = ["add", "update", "remove", "clear", "style"] as const;
export const changeSchema = z.object({
  seq: z.number(),
  rev: z.number(),
  turn: z.number(),
  op: z.enum(CHANGE_OPS),
  itemId: z.string().nullable(),
  summary: z.string(),
  by: z.string(),
  at: z.number(),
});
export type CanvasChange = z.infer<typeof changeSchema>;

export const turnSchema = z.object({
  seq: z.number(),
  /** user, agent (the thread's reply) or voice. */
  role: z.string(),
  text: z.string(),
  at: z.number(),
});
export type CanvasTurn = z.infer<typeof turnSchema>;

export const CANVAS_STATUSES = ["idle", "working", "failed"] as const;

export const canvasMetaSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  title: z.string(),
  updatedAt: z.number(),
  createdAt: z.number(),
  itemCount: z.number(),
  /** The canvas's look (looks.ts); classic for canvases made before looks. */
  look: lookSchema,
});

/** What a canvas's agent runs on: a provider, a model and, when the model has levels, a reasoning level. */
export const executionSchema = z.object({
  providerId: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  reasoningLevel: z.string().max(40).nullable(),
});
export type CanvasExecution = z.infer<typeof executionSchema>;

/** A provider in the model picker, with its models (BB's own listing). */
export const pickerProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Why its models couldn't be listed (signed out, missing), when they couldn't. */
  error: z.string().nullable(),
  models: z.array(z.object({
    id: z.string(),
    name: z.string(),
    isDefault: z.boolean(),
    /** Its reasoning levels; empty when it has none to pick. */
    reasoningLevels: z.array(z.object({ id: z.string(), label: z.string() })),
    defaultReasoningLevel: z.string().nullable(),
  })),
});
export type PickerProvider = z.infer<typeof pickerProviderSchema>;
export type CanvasMeta = z.infer<typeof canvasMetaSchema>;

export const canvasViewSchema = canvasMetaSchema.extend({
  /** What the backing thread runs on (null for canvases from before the picker). */
  execution: executionSchema.nullable(),
  /** A provider switch picked but not yet run: the next message starts a fresh thread on it, keeping the board. */
  pendingExecution: executionSchema.nullable(),
  rev: z.number(),
  turn: z.number(),
  status: z.enum(CANVAS_STATUSES),
  /** The agent's latest reply, clipped: one spoken-style line. */
  caption: z.string().nullable(),
  items: z.array(canvasItemSchema),
  /** The latest changes, oldest first. */
  changes: z.array(changeSchema),
  /** The hidden transcript's last few lines, oldest first. */
  history: z.array(turnSchema),
});
export type CanvasView = z.infer<typeof canvasViewSchema>;

/**
 * A checked item: size limits, and what each kind needs. Throws a readable
 * error. The id is filled in by the caller.
 */
export function checkItem(item: { kind: CanvasKind; data?: unknown; options?: Record<string, unknown>; html?: string | null; title?: string | null }): void {
  if (jsonBytes(item.data ?? null) > CANVAS_LIMITS.dataBytes) throw new Error(`An item's data is over ${CANVAS_LIMITS.dataBytes / 1024} KB; show less.`);
  if (jsonBytes(item.options ?? {}) > CANVAS_LIMITS.optionsBytes) throw new Error(`An item's options are over ${CANVAS_LIMITS.optionsBytes / 1024} KB.`);
  if (item.html && new TextEncoder().encode(item.html).length > CANVAS_LIMITS.htmlBytes) throw new Error(`A custom item's HTML is over ${CANVAS_LIMITS.htmlBytes / 1024} KB.`);
  if (item.html && item.kind !== "custom") throw new Error(`Only a custom item takes html; ${item.kind} reads data and options.`);
  switch (item.kind) {
    case "headline":
      if (!headlineOf(item.data)) throw new Error("A headline needs data: a string, or {text, subtitle?, kicker?, tone?}.");
      return;
    case "caption":
      if (!captionOf(item.data)) throw new Error("A caption needs data: short Markdown, or {markdown}.");
      return;
    case "custom":
      if (!item.html?.trim()) throw new Error("A custom item needs html.");
      return;
    case "quote":
      if (!quoteOf(item.data)) throw new Error("A quote needs data: a string, or {text, by?, role?}.");
      return;
    case "note":
      if (!noteOf(item.data)) throw new Error("A note needs data: a short string, or {text, tone?}.");
      return;
    case "image": {
      const url = typeof item.data === "string" ? item.data : item.options?.url;
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) throw new Error("An image needs an http(s) URL in data or options.url.");
      return;
    }
    default:
      if (item.data === undefined || item.data === null) throw new Error(`A ${item.kind} needs data: ${CANVAS_KIND_INFO[item.kind].data}.`);
  }
}

export interface Headline { text: string; subtitle: string | null; kicker: string | null; tone: "neutral" | "good" | "bad" | "accent" }

export function headlineOf(data: unknown): Headline | null {
  if (typeof data === "string") return data.trim() ? { text: data.trim(), subtitle: null, kicker: null, tone: "neutral" } : null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const text = typeof row.text === "string" ? row.text.trim() : "";
  if (!text) return null;
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const tone = row.tone === "good" || row.tone === "bad" || row.tone === "accent" ? row.tone : "neutral";
  return { text, subtitle: str(row.subtitle), kicker: str(row.kicker), tone };
}

export function quoteOf(data: unknown): { text: string; by: string | null; role: string | null } | null {
  if (typeof data === "string") return data.trim() ? { text: data.trim(), by: null, role: null } : null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const text = str(row.text) ?? str(row.quote);
  return text ? { text, by: str(row.by) ?? str(row.author), role: str(row.role) } : null;
}

export function noteOf(data: unknown): { text: string; tone: "accent" | "good" | "bad" | "neutral" } | null {
  if (typeof data === "string") return data.trim() ? { text: data.trim(), tone: "neutral" } : null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const text = typeof row.text === "string" ? row.text.trim() : "";
  const tone = row.tone === "good" || row.tone === "bad" || row.tone === "accent" ? row.tone : "neutral";
  return text ? { text, tone } : null;
}

export function captionOf(data: unknown): string | null {
  const text = typeof data === "string" ? data : data && typeof data === "object" && typeof (data as { markdown?: unknown }).markdown === "string" ? (data as { markdown: string }).markdown : "";
  return text.trim() || null;
}

/** "turnout-chart" from "Turnout by state". */
export function slugId(kind: string, title: string | null | undefined, taken: ReadonlySet<string>): string {
  const base = (title ?? kind).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || kind;
  const start = /^[a-z0-9]/.test(base) ? base : `${kind}-${base}`;
  if (!taken.has(start)) return start;
  for (let n = 2; ; n++) if (!taken.has(`${start}-${n}`)) return `${start}-${n}`;
}

export { jsonBytes };
