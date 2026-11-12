// Mini apps: names, limits and shapes the server, the app and agents share.
// Imports only zod, so the app can use it without the root SDK.
//
// A mini app is a small interactive app: source files (JSX, JS, HTML, CSS),
// a manifest, and its own data. It runs in a sandboxed frame with
// `window.playground` (state, actions, records, approved network) and shows
// the same way in a page block, a chat card and its own tab.
import { z } from "zod";

/** The item namespace: mini apps are `minis:<id>` in Studio's tables. */
export const PLUGIN_ID = "minis";
/** Studio's panel sub-path: /plugins/studio/studio/minis/<id> shows one mini app. */
export const ROUTE_SEGMENT = "minis";
export const MINI_KIND = "mini";
export const MINI_ICON = "AppWindow";
/** Realtime channel: source edits, state, records and agent commands. */
export const REALTIME_CHANNEL = "minis";
/** What a mini app's frame and its host post each other. */
export const MINI_MESSAGE = "bb-mini";
/** The `window.playground` API version mini apps declare. */
export const MINI_API = 1;

export function miniHref(id: string): string {
  return `/plugins/studio/studio/${ROUTE_SEGMENT}/${encodeURIComponent(id)}`;
}

export function isMiniId(value: string): boolean {
  return /^mini_[0-9a-f]{16}$/.test(value);
}

const HTTP_ROOT = "/api/v1/plugins/studio/http/minis";

/** The frame's document: the version's entry with the runtime added. */
export function frameUrl(miniId: string, versionId: string, theme: "light" | "dark"): string {
  return `${HTTP_ROOT}/frame?mini=${encodeURIComponent(miniId)}&version=${encodeURIComponent(versionId)}&theme=${theme}`;
}

/** A shelf file (shelf/<lib id with - for @>.js), cached until its contents change. */
export const shelfUrl = (file: string, hash: string) => `${HTTP_ROOT}/shelf?file=${encodeURIComponent(file)}&v=${hash}`;
/** A version's compiled modules as one script; versions never change. */
export const appUrl = (miniId: string, versionId: string) => `${HTTP_ROOT}/app?mini=${encodeURIComponent(miniId)}&version=${encodeURIComponent(versionId)}`;
export const shelfFile = (libId: string) => `${libId.replace("@", "-")}.js`;

export const LIMITS = {
  name: 120,
  files: 40,
  fileBytes: 512 * 1024,
  /** All of a version's source files together. */
  sourceBytes: 2 * 1024 * 1024,
  versions: 50,
  /** `playground.state`, like a live artifact's. */
  stateBytes: 256 * 1024,
  recordBytes: 64 * 1024,
  /** Every record of one mini app together. */
  dataBytes: 50 * 1024 * 1024,
  collections: 20,
  indexes: 8,
  findLimit: 500,
  events: 500,
  takes: 50,
  fetchBytes: 5 * 1024 * 1024,
  fetchTimeoutMs: 20_000,
  fetchLog: 200,
  /** Writes and fetches a mini app may make per minute. */
  writesPerMinute: 600,
  fetchesPerMinute: 120,
  secrets: 20,
} as const;

// ---------------------------------------------------------------------------
// The shelf: the libraries Studio ships for mini apps (src/minis/shelf).

export interface ShelfLib {
  id: string;
  /** What `import … from "<name>"` resolves for this lib. */
  modules: readonly string[];
  description: string;
  /** Other libs it needs, loaded first. */
  needs: readonly string[];
  /** Loaded for every mini app. */
  always?: boolean;
}

export const SHELF: readonly ShelfLib[] = [
  { id: "react@19", modules: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"], description: "React 19.", needs: [], always: true },
  { id: "tailwind@4", modules: [], description: "Tailwind CSS 4 in the browser: any utility class works, with BB's colors as theme tokens.", needs: [], always: true },
  {
    id: "kit@1",
    modules: ["@studio/kit"],
    description: "Studio Kit: BB's components (Button, Input, Textarea, Select, Checkbox, Card, Dialog, DropdownMenu, Popover, Tooltip, Badge, Tabs, Table, Field, EmptyState, Toolbar, Spinner), cn(), and hooks for playground state and records.",
    needs: ["react@19"],
    always: true,
  },
  { id: "charts@1", modules: ["@studio/kit/charts", "recharts"], description: "Charts: <Chart spec> and <Stats items> (the Pages chart format), and Recharts 3 for anything custom.", needs: ["react@19", "kit@1"] },
  { id: "icons@1", modules: ["lucide-react"], description: "Lucide icons as React components.", needs: ["react@19"] },
  { id: "markdown@1", modules: ["marked"], description: "Marked, to render Markdown to HTML.", needs: [] },
  { id: "dates@4", modules: ["date-fns"], description: "date-fns 4.", needs: [] },
];

export const SHELF_IDS = SHELF.map((lib) => lib.id);

/** Libs to load, in order, for what a manifest lists: needs first, `always` included. */
export function resolveLibs(listed: readonly string[]): ShelfLib[] {
  const out: ShelfLib[] = [];
  const add = (id: string) => {
    if (out.some((lib) => lib.id === id)) return;
    const lib = SHELF.find((each) => each.id === id);
    if (!lib) throw new Error(`No shelf library "${id}". Available: ${SHELF_IDS.join(", ")}.`);
    lib.needs.forEach(add);
    out.push(lib);
  };
  SHELF.filter((lib) => lib.always).forEach((lib) => add(lib.id));
  listed.forEach(add);
  return out;
}

// ---------------------------------------------------------------------------
// The manifest (`mini.json`).

const name = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/, "letters, digits, _ and -, starting with a letter");
const field = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.]{0,63}$/, "a field name such as stage or owner.id");

/** `fetch:<host>` (or `fetch:*.<domain>`), `secret:<name>`, and `bb.*`. */
export const CAPABILITY = /^(?:fetch:(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+|secret:[a-zA-Z][a-zA-Z0-9_-]{0,47}|bb\.threads\.read|bb\.open|bb\.studio\.read)$/;

export const manifestSchema = z
  .object({
    api: z.literal(MINI_API).default(MINI_API),
    /** The file that starts it: HTML, or a JS/JSX/TS/TSX module. */
    entry: z.string().min(1).max(120).default("main.jsx"),
    libs: z.array(z.string()).max(12).default([]),
    collections: z
      .record(name, z.object({ indexes: z.array(field).max(LIMITS.indexes).default([]) }).strict())
      .refine((value) => Object.keys(value).length <= LIMITS.collections, `At most ${LIMITS.collections} collections.`)
      .default({}),
    capabilities: z.array(z.string().regex(CAPABILITY, "fetch:<host>, secret:<name>, bb.threads.read, bb.open or bb.studio.read")).max(40).default([]),
    size: z.object({ minHeight: z.number().int().min(80).max(2000).optional(), maxHeight: z.number().int().min(120).max(4000).optional() }).strict().default({}),
    description: z.string().max(500).optional(),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;

export function parseManifest(raw: unknown): Manifest {
  const manifest = manifestSchema.parse(raw ?? {});
  resolveLibs(manifest.libs);
  return manifest;
}

/** Capabilities that need the user's approval. Records, state and takes don't. */
export function approvable(manifest: Manifest): string[] {
  return [...new Set(manifest.capabilities)].sort();
}

/** A fetch URL's host is covered by a granted `fetch:` capability. */
export function hostAllowed(host: string, granted: readonly string[]): boolean {
  const lower = host.toLowerCase();
  return granted.some((cap) => {
    if (!cap.startsWith("fetch:")) return false;
    const pattern = cap.slice(6);
    return pattern.startsWith("*.") ? lower.endsWith(pattern.slice(1)) && lower.length > pattern.length - 1 : lower === pattern;
  });
}

// ---------------------------------------------------------------------------
// Records.

export const filterValue = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]);
export const whereSchema = z.record(
  field,
  z.union([
    filterValue,
    z.object({ in: z.array(filterValue).max(100) }).strict(),
    z.object({ gt: filterValue.optional(), gte: filterValue.optional(), lt: filterValue.optional(), lte: filterValue.optional(), ne: filterValue.optional() }).strict(),
  ]),
);
export const findSchema = z
  .object({
    where: whereSchema.optional(),
    /** A field, `-field` for descending; `createdAt` and `updatedAt` always work. */
    order: z.string().max(70).optional(),
    limit: z.number().int().min(1).max(LIMITS.findLimit).optional(),
    offset: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();
export type Find = z.infer<typeof findSchema>;

export interface MiniRecord {
  id: string;
  rev: number;
  createdAt: number;
  updatedAt: number;
  createdBy: "user" | "agent";
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Realtime events.

export type MiniEvent =
  | { type: "source"; miniId: string; versionId: string }
  | { type: "state"; miniId: string; state: unknown; version: number; origin: string }
  | { type: "records"; miniId: string; collection: string; origin: string; changes: { op: "put" | "remove"; id: string; record?: MiniRecord }[] }
  | { type: "grants"; miniId: string }
  | { type: "do"; miniId: string; clientId: string; commandId: string; action: string; args: unknown[] };

// ---------------------------------------------------------------------------
// Theme tokens the host copies into the frame, so Kit's classes match BB.

export const THEME_COLORS = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground",
  "subtle-foreground", "accent", "accent-foreground", "destructive", "destructive-foreground", "destructive-text",
  "border", "input", "ring", "state-hover", "state-active", "success", "warning", "warning-text", "attention",
  "canvas", "ink", "sidebar",
] as const;

export const MINIS_DOC = `Mini apps are small interactive apps built into Studio. Write React (JSX) with Studio Kit components and Tailwind classes; records, state and approved network come from window.playground (Kit hooks wrap them).`;
