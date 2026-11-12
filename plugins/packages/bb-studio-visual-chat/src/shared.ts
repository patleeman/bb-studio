// Canvas (prototype): names, limits and shapes the server, the app and the
// agent tools share. Imports only zod, so the app can use it without the SDK.
//
// A canvas is a board the agent edits each turn, backed by a hidden BB
// thread (its memory). The board holds items: Dashboards' widget types, plus
// a headline and a caption. The user never arranges it: in Classic the app
// packs it by importance and size (layout.ts); in a style it composes it
// from the agent's rough placement (organic.ts).
import { z } from "zod";
import { lookSchema } from "./looks";

/** The canvas plugin's panel: /plugins/studio-visual-chat/canvas/<threadId>. */
export const CANVAS_SEGMENT = "canvas";
export const CANVAS_ROOT = `/plugins/studio-visual-chat/${CANVAS_SEGMENT}`;
/** Realtime channel: a board or its caption changed. */
export const CANVAS_CHANNEL = "studio-visual-chat";
export const CANVAS_UPDATE_TYPE = "canvas:updated";

export interface CanvasSignal { type: typeof CANVAS_UPDATE_TYPE; canvasId: string; threadId: string; rev: number }

/**
 * Realtime: the page the agent is writing in its reply, so far (src/stream.ts). `html` is the partial page,
 * repaired and marked; `n` counts up within a stream. The last signal of a stream has `done`: then `rev` is the
 * board's revision with the finished page (the page shows the stream until it has that revision), or null when
 * nothing was committed.
 */
export const CANVAS_STREAM_TYPE = "canvas:stream";
export type CanvasStreamSignal =
  | { type: typeof CANVAS_STREAM_TYPE; canvasId: string; threadId: string; n: number; html: string; done?: false }
  | { type: typeof CANVAS_STREAM_TYPE; canvasId: string; threadId: string; n: number; done: true; rev: number | null };

export const canvasHref = (threadId?: string | null) => (threadId ? `${CANVAS_ROOT}/${encodeURIComponent(threadId)}` : CANVAS_ROOT);
/** An explicit new canvas. The bare root reopens the last canvas instead (the rail opens the root). */
export const CANVAS_NEW_SEGMENT = "new";
export const canvasNewHref = () => `${CANVAS_ROOT}/${CANVAS_NEW_SEGMENT}`;

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
  /** A board's page (src/page.ts). */
  pageBytes: 200 * 1024,
  /** The caption the page shows: the agent's reply, clipped. */
  captionChars: 600,
  /** A message the user sends. */
  messageChars: 8000,
  /** Change log and history kept per canvas. */
  changesKept: 200,
  turnsKept: 200,
  /** Versions kept per canvas: the oldest go past this. */
  versionsKept: 50,
} as const;

/**
 * What an item can be: a headline, a caption, or one of Dashboards' widget
 * types (Studio's src/dashboards/shared.ts WIDGETS), rendered by its
 * renderers. Not Dashboards' embed: it reads Studio's RPCs, which a canvas
 * (another plugin) can't call from its page.
 */
export const CANVAS_KINDS = ["headline", "caption", "stat", "line", "bar", "area", "pie", "table", "list", "ticker", "progress", "image", "custom", "quote", "timeline", "map", "multiples"] as const;
export type CanvasKind = (typeof CANVAS_KINDS)[number];
export const isCanvasKind = (value: unknown): value is CanvasKind => typeof value === "string" && (CANVAS_KINDS as readonly string[]).includes(value);
/** Canvas had sticky and margin notes; they're gone. Older turns may still ask for one. */
export const NOTES_REFUSED = "notes aren't supported; put the point in a caption or the item itself";
const kindSchema = z.enum(CANVAS_KINDS, { error: (issue) => (issue.input === "note" ? NOTES_REFUSED : undefined) });
export const SIZE_HINTS = ["s", "m", "l", "xl"] as const;
export type SizeHint = (typeof SIZE_HINTS)[number];

/**
 * Placement (styles only; organic.ts). The agent says roughly where and how
 * big; the engine composes. scale: the item's rank in the composition (one
 * hero). region: a rough spot on the screen. pinnedTo (+ point, side): next
 * to a spot on another item. bleed: runs off the board's edge.
 */
export const SCALES = ["hero", "large", "medium", "small", "tiny"] as const;
export type Scale = (typeof SCALES)[number];
export const REGIONS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;
export type Region = (typeof REGIONS)[number];
export const SIDES = ["left", "right", "above", "below"] as const;
export type Side = (typeof SIDES)[number];
/** Whole-board compositions the design guide teaches (guides.ts); the engine's starting arrangement for each. */
export const COMPOSITIONS = ["orbit", "giant-number", "map", "spine", "split", "quote", "close-up", "essay", "gallery"] as const;
export type Composition = (typeof COMPOSITIONS)[number];
export const COMPOSITION_INFO: Record<Composition, string> = {
  orbit: "a hero chart or figure, with facts orbiting it at different scales",
  "giant-number": "one number set huge, with annotations and a small supporting chart around it",
  map: "a map in the middle, with facts in the corners pointing at places",
  spine: "a timeline running across the screen, with moments above and below it",
  split: "two sides compared, left and right (two heroes), the verdict between or below",
  quote: "a big quote with no frame leading, and the evidence beside and below it",
  "close-up": "one chart full-width, bleeding off the edge, annotated on itself, a few facts under it",
  essay: "a column of text on one side, the figures and notes around it on the other",
  gallery: "a spread of pictures (one big, the rest smaller, at different sizes), each with its name and rating drawn as stars or a big numeral",
};

/** Per kind: what data and options it reads (for agents), and its default size. */
export const CANVAS_KIND_INFO: Record<CanvasKind, { data: string; options: string; size: SizeHint }> = {
  headline: { data: "{text, subtitle?, kicker?, tone?: neutral|good|bad|accent} or a string", options: "none", size: "l" },
  caption: { data: "short Markdown (a few lines), or {markdown}", options: "none", size: "m" },
  stat: { data: "a number; a number array (last is the value); or {value, delta?, trend?: up|down|flat, series?: number[], caption?}", options: "label?, unit?, prefix?, decimals?, invert? (down is good)", size: "s" },
  line: { data: "rows, e.g. [{day: \"Mon\", a: 4}]", options: "x? (category key), series? (numeric keys, max 8), unit?, stacked?, callouts? [{x, series?, text}] (labels drawn on the chart at that point)", size: "l" },
  bar: { data: "rows", options: "x?, series?, unit?, stacked?, callouts? [{x, series?, text}] (labels drawn on the chart at that point)", size: "l" },
  area: { data: "rows", options: "x?, series?, unit?, stacked?, callouts? [{x, series?, text}] (labels drawn on the chart at that point)", size: "l" },
  pie: { data: "rows, e.g. [{label: \"Web\", value: 60}]", options: "x? (label key), series? (first is the value key), unit?", size: "m" },
  table: { data: "an array of objects, or {columns, rows}", options: "columns? (keys in order), maxRows?, wrapColumns?", size: "l" },
  list: { data: "an array of {title, link?, summary?, date?} or strings", options: "maxItems?, showDates?", size: "m" },
  ticker: { data: "an array of {label, value?, delta?} or strings", options: "speed? (seconds per loop)", size: "xl" },
  progress: { data: "a number, or {value, max?, min?, label?}", options: "style? (bar|gauge), min?, max?, unit?, label?", size: "s" },
  image: { data: "an http(s) URL string (a photo, cover or box art found by web search)", options: "url?, alt?, headline? (its name), kicker?, caption?, rating? (number), ratingMax? (5, 10 or 100), credit?, aspect? (\"3 / 4\" for covers and box art), fit? (cover|contain), focus? (CSS object-position, e.g. \"50% 20%\")", size: "m" },
  custom: { data: "anything; the HTML reads window.bbWidget.data (cv.render)", options: "anything the HTML reads (window.bbWidget.options)", size: "m" },
  quote: { data: "{text, by?, role?} or a string", options: "none", size: "m" },
  timeline: { data: "[{date, label, note?, tone?: good|bad|accent|warn}]", options: "layout? (column|row), highlight? (index or date)", size: "m" },
  map: { data: "US states: {PA: 2.1, ...} or {PA: {value, label?, color?}} or [{state, value, label?, color?}]", options: "scale? (diverging|sequential), legend? [low, high], show? (abbr|value|label), low?, high?, callouts? [{state, text}] (beside the map, with a leader to the state)", size: "m" },
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
  kind: kindSchema,
  title: z.string().max(CANVAS_LIMITS.title).nullable().optional(),
  data: z.unknown().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  /** custom only: the widget's HTML, sandboxed with no network. */
  html: z.string().optional(),
  size: z.enum(SIZE_HINTS).optional(),
  /** 5: the point of the board right now; 1: background. */
  importance: z.number().int().min(1).max(5).optional(),
  // Unknown fields (relatedTo and anchor from older turns) are stripped.
  /** Its rank in the composition: one hero, the rest at clearly different scales. */
  scale: z.enum(SCALES).nullable().optional(),
  /** Roughly where on the screen. */
  region: z.enum(REGIONS).nullable().optional(),
  /** Placed right next to this item, at point on it, on side. Nothing is drawn between them. */
  pinnedTo: z.string().regex(ITEM_ID).nullable().optional(),
  /** Where on the pinnedTo item, 0–1 from its top-left. */
  point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable().optional(),
  /** Which side of that spot: left, right, above or below. */
  side: z.enum(SIDES).nullable().optional(),
  /** Run off the board's edge (a hero chart, map or image). */
  bleed: z.boolean().nullable().optional(),
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
  scale: z.enum(SCALES).nullable().optional(),
  region: z.enum(REGIONS).nullable().optional(),
  pinnedTo: z.string().nullable().optional(),
  point: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
  side: z.enum(SIDES).nullable().optional(),
  bleed: z.boolean().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** The board revision that last changed it. */
  rev: z.number(),
});
export type CanvasItem = z.infer<typeof canvasItemSchema>;

export const CHANGE_OPS = ["add", "update", "remove", "clear", "style", "page", "patch"] as const;
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

/**
 * The screen the user is on, from a client that knows (the iOS app): a phone, a Surface Duo folded or open, or a
 * desktop, with the board's size in points. The agent gets one line about it with the message (clientNote).
 */
export const CLIENT_KINDS = ["phone", "duo-folded", "duo-unfolded", "desktop"] as const;
export const clientHintSchema = z.object({
  kind: z.enum(CLIENT_KINDS),
  width: z.number().int().min(200).max(10000),
  height: z.number().int().min(200).max(10000),
});
export type ClientHint = z.infer<typeof clientHintSchema>;

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

/** What a new canvas runs on unless the user picks another: Sonnet, which designs a page well and still answers in a turn. */
export const CANVAS_DEFAULT_EXECUTION: CanvasExecution = { providerId: "claude-code", model: "claude-sonnet-5-5", reasoningLevel: null };

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

/** A version in the timeline: n only grows (old ones drop off), from is the version a branch continued from. */
export const versionMetaSchema = z.object({
  n: z.number(),
  look: lookSchema,
  title: z.string(),
  /** The message that led to it. */
  prompt: z.string().nullable(),
  caption: z.string().nullable(),
  rev: z.number(),
  from: z.number().nullable(),
  at: z.number(),
  /** A board of items from before pages (read-only: it shows as it was). */
  items: z.boolean(),
});
export type CanvasVersionMeta = z.infer<typeof versionMetaSchema>;
export const versionSchema = versionMetaSchema.extend({ page: z.string().nullable(), board: z.array(canvasItemSchema) });
export type CanvasVersion = z.infer<typeof versionSchema>;

export const canvasViewSchema = canvasMetaSchema.extend({
  /** What the backing thread runs on (null for canvases from before the picker). */
  execution: executionSchema.nullable(),
  /** A provider switch picked but not yet run: the next message starts a fresh thread on it, keeping the board. */
  pendingExecution: executionSchema.nullable(),
  rev: z.number(),
  turn: z.number(),
  status: z.enum(CANVAS_STATUSES),
  /** The board as one HTML page (src/page.ts), when the agent has written one; boards from before are items. */
  page: z.string().nullable().optional(),
  /** The agent's latest reply, clipped: one spoken-style line. */
  caption: z.string().nullable(),
  items: z.array(canvasItemSchema),
  /** The latest changes, oldest first. */
  changes: z.array(changeSchema),
  /** The hidden transcript's last few lines, oldest first. */
  history: z.array(turnSchema),
  /** Each turn's finished board, oldest first (store.ts); fetch one's board with canvas.version. */
  versions: z.array(versionMetaSchema),
  /** The version the user is looking at, or null for the latest. */
  viewing: z.number().nullable(),
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
