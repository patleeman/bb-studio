// Dashboards: names, limits and shapes the server, the app and agents share.
// Imports only zod, so the app can use it without the root SDK.
import { z } from "zod";

/** The item namespace: dashboards are `dashboards:<id>` in Studio's tables. */
export const PLUGIN_ID = "dashboards";
/** Studio's panel sub-path: /plugins/studio/studio/dashboards/<id> shows one dashboard. */
export const ROUTE_SEGMENT = "dashboards";
export const DASHBOARD_KIND = "dashboard";
export const DASHBOARD_ICON = "studio/dashboard";
/** The thread workbench's Dashboards tab. */
export const DASHBOARD_TAB = "dashboards";
/** Realtime channel: dashboard edits and fresh widget data. */
export const REALTIME_CHANNEL = "dashboards";
export const DASHBOARD_UPDATE_TYPE = "dashboard:updated";
export const DATA_UPDATE_TYPE = "dashboard:data";

export function dashboardHref(id: string): string {
  return `/plugins/studio/studio/${ROUTE_SEGMENT}/${encodeURIComponent(id)}`;
}

export function isDashboardId(value: string): boolean {
  return /^dsh_[0-9a-f]{16}$/.test(value);
}

// ---------------------------------------------------------------------------
// Limits (docs: README "Dashboards").

export const LIMITS = {
  widgets: 60,
  title: 120,
  name: 200,
  /** JSON size of one widget's options. */
  optionsBytes: 32 * 1024,
  /** JSON size of a static source's data, and of pushed data. */
  staticBytes: 256 * 1024,
  pushBytes: 512 * 1024,
  /** A custom widget's HTML (library type or instance override). */
  htmlBytes: 200 * 1024,
  libraryTypes: 200,
  versions: 20,
  urlMinIntervalSec: 60,
  scriptMinIntervalSec: 300,
  maxIntervalSec: 7 * 24 * 3600,
  urlBytes: 2 * 1024 * 1024,
  urlTimeoutMs: 15_000,
  urlRedirects: 5,
  scriptBytes: 1024 * 1024,
  scriptTimeoutMs: 30_000,
  /** A dashboard's stored data value, after `select`. */
  valueBytes: 1024 * 1024,
  /** Unviewed dashboards' url and script widgets refresh this often. */
  backgroundMs: 30 * 60_000,
  /** A manual Refresh waits at least this long per widget. */
  manualMs: 10_000,
  /** A viewer counts for this long after its last heartbeat. */
  viewerMs: 75_000,
} as const;

// ---------------------------------------------------------------------------
// Grid.

export const BREAKPOINT_NAMES = ["lg", "md", "sm"] as const;
export type Breakpoint = (typeof BREAKPOINT_NAMES)[number];
/** Minimum container width (px) for each breakpoint. */
export const BREAKPOINTS: Record<Breakpoint, number> = { lg: 1100, md: 700, sm: 0 };
/** The breakpoint react-grid-layout picks for a container this wide. */
export const breakpointFor = (width: number): Breakpoint => (width >= BREAKPOINTS.lg ? "lg" : width >= BREAKPOINTS.md ? "md" : "sm");
export const COLS: Record<Breakpoint, number> = { lg: 12, md: 8, sm: 4 };
export const ROW_HEIGHT = 36;
export const GRID_MARGIN = 12;

// ---------------------------------------------------------------------------
// Widget types.

export const WIDGET_TYPES = ["stat", "line", "bar", "area", "pie", "table", "list", "ticker", "note", "embed", "clock", "image", "progress", "custom"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export interface WidgetInfo {
  label: string;
  icon: string;
  /** What the widget shows, for the picker and agents. */
  description: string;
  /** The data it reads, for agents. */
  data: string;
  /** Options it reads, for agents. */
  options: string;
  /** Default size on the 12-column grid. */
  w: number;
  h: number;
  /** Whether it reads a data source at all. */
  usesData: boolean;
}

export const WIDGETS: Record<WidgetType, WidgetInfo> = {
  stat: {
    label: "Stat", icon: "Target", description: "A key number with its change and a trend sparkline.",
    data: "a number; an array of numbers (the last is the value, all of them the sparkline); or {value, delta?, trend?: up|down|flat, series?: number[], caption?}",
    options: "label?, unit?, prefix?, decimals?, field? (key of the value in each row when data is an array of objects), sparkline? (default true), invert? (down is good)",
    w: 3, h: 3, usesData: true,
  },
  line: {
    label: "Line chart", icon: "ChartColumn", description: "Series over a category or time axis.",
    data: "an array of rows, e.g. [{day: \"Mon\", signups: 4}]", options: "x? (category key), series? (numeric keys, max 8), unit?, stacked?",
    w: 6, h: 6, usesData: true,
  },
  bar: {
    label: "Bar chart", icon: "ChartColumn", description: "Compare values across categories.",
    data: "an array of rows", options: "x?, series?, unit?, stacked?", w: 6, h: 6, usesData: true,
  },
  area: {
    label: "Area chart", icon: "ChartColumn", description: "Volume over time, optionally stacked.",
    data: "an array of rows", options: "x?, series?, unit?, stacked?", w: 6, h: 6, usesData: true,
  },
  pie: {
    label: "Pie chart", icon: "Circle", description: "Parts of a whole.",
    data: "an array of rows, e.g. [{label: \"Web\", value: 60}]", options: "x? (label key), series? (first is the value key), unit?",
    w: 4, h: 6, usesData: true,
  },
  table: {
    label: "Table", icon: "Rows2", description: "Rows and columns.",
    data: "an array of objects, or {columns: string[], rows: array[]}", options: "columns? (keys to show, in order), maxRows?, wrapColumns? (keys whose long text wraps; others truncate on one line)",
    w: 6, h: 6, usesData: true,
  },
  list: {
    label: "List / feed", icon: "ListView", description: "Headlines, events or tasks; RSS feeds land here.",
    data: "an array of {title, link?, summary?, date?} (or strings), or a feed {items: [...]}", options: "maxItems?, showDates? (default true)",
    w: 4, h: 6, usesData: true,
  },
  ticker: {
    label: "Ticker", icon: "News01", description: "A scrolling strip of values or headlines.",
    data: "an array of {label, value?, delta?} or strings", options: "speed? (seconds per loop, default 30)",
    w: 12, h: 1, usesData: true,
  },
  note: {
    label: "Note", icon: "FileText", description: "Markdown text.",
    data: "none (or a string, shown instead of options.markdown)", options: "markdown",
    w: 4, h: 4, usesData: false,
  },
  embed: {
    label: "Embed", icon: "Layers", description: "A Studio item, a thread, or a web page in a sandboxed frame.",
    data: "none", options: "href (a Studio item link), threadId, or url (http/https)",
    w: 6, h: 6, usesData: false,
  },
  clock: {
    label: "Clock", icon: "Clock", description: "The time somewhere, or a countdown.",
    data: "none", options: "mode? (clock|countdown), timeZone? (IANA, e.g. Europe/London), target? (ISO time, for countdown), label?, hour12?",
    w: 3, h: 3, usesData: false,
  },
  image: {
    label: "Image", icon: "Palette", description: "A picture from a URL.",
    data: "none, or a URL string that replaces options.url", options: "url, alt?, fit? (cover|contain)",
    w: 4, h: 5, usesData: false,
  },
  progress: {
    label: "Progress", icon: "SlidersHorizontal", description: "Progress toward a goal, as a bar or a gauge.",
    data: "a number, or {value, max?, min?, label?}", options: "style? (bar|gauge), min?, max? (default 100), unit?, label?",
    w: 3, h: 3, usesData: true,
  },
  custom: {
    label: "Custom", icon: "Code", description: "Your own HTML and JavaScript, sandboxed.",
    data: "anything; it reaches the widget as window.bbWidget.data", options: "anything the widget's HTML reads (window.bbWidget.options)",
    w: 4, h: 5, usesData: true,
  },
};

export function isWidgetType(value: string): value is WidgetType {
  return (WIDGET_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Schemas. Kept flat and plain, so the generated Swift types read naturally.

const jsonBytes = (value: unknown) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
};

export const SOURCE_KINDS = ["none", "static", "url", "script", "push"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Where a widget's data comes from. Fields apply per kind; others are ignored. */
export const sourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  /** static: the data itself. */
  data: z.unknown().optional(),
  /** url: an http(s) address the Studio server fetches. */
  url: z.string().max(2000).optional(),
  /** url: how to read the response; auto tells JSON from RSS/Atom. */
  format: z.enum(["auto", "json", "rss"]).optional(),
  /** script: a shell command run on the BB host after the user approves it. */
  command: z.string().max(4000).optional(),
  /** script: working directory (default: home). */
  cwd: z.string().max(1000).optional(),
  /** url, script: seconds between refreshes while the dashboard is open. */
  intervalSec: z.number().int().min(1).max(LIMITS.maxIntervalSec).optional(),
  /** url, script, push: a path into the result, e.g. `data.items` or `rows[0].value`. */
  select: z.string().max(200).optional(),
});
export type Source = z.infer<typeof sourceSchema>;

/** A source checked for its kind, with defaults filled in. Throws a readable error. */
export function normalizeSource(input: Source | undefined | null): Source {
  const source = input ?? { kind: "none" as const };
  const select = source.select?.trim() || undefined;
  switch (source.kind) {
    case "none":
      return { kind: "none" };
    case "static":
      if (source.data === undefined) throw new Error("A static source needs data.");
      if (jsonBytes(source.data) > LIMITS.staticBytes) throw new Error(`Static data is over ${LIMITS.staticBytes / 1024} KB; push it with widget_set_data or serve it from a URL.`);
      return { kind: "static", data: source.data };
    case "url": {
      const url = source.url?.trim() ?? "";
      if (!isHttpUrl(url)) throw new Error("A url source needs an http or https address.");
      const intervalSec = Math.max(LIMITS.urlMinIntervalSec, source.intervalSec ?? 300);
      return { kind: "url", url, format: source.format ?? "auto", intervalSec, ...(select ? { select } : {}) };
    }
    case "script": {
      const command = source.command?.trim() ?? "";
      if (!command) throw new Error("A script source needs a command.");
      const intervalSec = Math.max(LIMITS.scriptMinIntervalSec, source.intervalSec ?? 900);
      const cwd = source.cwd?.trim() || undefined;
      return { kind: "script", command, ...(cwd ? { cwd } : {}), intervalSec, ...(select ? { select } : {}) };
    }
    case "push":
      return { kind: "push", ...(select ? { select } : {}) };
  }
}

export const layoutItemSchema = z.object({
  /** The widget id. */
  i: z.string().min(1).max(100),
  x: z.number().int().min(0).max(1000),
  y: z.number().int().min(0).max(100_000),
  w: z.number().int().min(1).max(100),
  h: z.number().int().min(1).max(200),
});
export type LayoutItem = z.infer<typeof layoutItemSchema>;

export const layoutsSchema = z.object({
  lg: z.array(layoutItemSchema).max(LIMITS.widgets),
  md: z.array(layoutItemSchema).max(LIMITS.widgets),
  sm: z.array(layoutItemSchema).max(LIMITS.widgets),
});
export type Layouts = z.infer<typeof layoutsSchema>;

export const widgetSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(WIDGET_TYPES),
  title: z.string().max(LIMITS.title).nullable(),
  options: z.record(z.string(), z.unknown()),
  source: sourceSchema,
  /** custom: the library type it uses. */
  customType: z.string().max(100).nullable(),
  /** custom: HTML for this widget alone, overriding the library type's. */
  html: z.string().nullable(),
});
export type Widget = z.infer<typeof widgetSchema>;

export interface DashboardDoc {
  widgets: Widget[];
  layouts: Layouts;
}

export const EMPTY_LAYOUTS: Layouts = { lg: [], md: [], sm: [] };

export const dataViewSchema = z.object({
  widgetId: z.string(),
  /** The last good value (after `select`), or null. */
  value: z.unknown().nullable(),
  fetchedAt: z.number().nullable(),
  /** The last attempt's error, when it failed after (or without) a good value. */
  error: z.string().nullable(),
  errorAt: z.number().nullable(),
  /** ok, error, pending (never fetched), approval (script waits for the user), static, push (none yet), none. */
  status: z.enum(["ok", "error", "pending", "approval", "static", "none"]),
});
export type DataView = z.infer<typeof dataViewSchema>;

export const scriptStateSchema = z.object({
  /** sha256 of the command and working directory; an approval pins it. */
  sha256: z.string(),
  approved: z.boolean(),
});

/**
 * What the approval dialog shows, from `dashboards.requestApproval`, with a
 * one-time nonce that approves this exact command once.
 */
export const approvalPromptSchema = z.object({
  /** Pass to dashboards.approveScript; one use, bound to this command. */
  nonce: z.string(),
  /** Approve is accepted from this time (ms): the dialog was open a moment. */
  notBefore: z.number(),
  expiresAt: z.number(),
  sha256: z.string(),
  command: z.string(),
  /** The folder it runs in; the home folder when none was set. */
  cwd: z.string(),
  cwdIsHome: z.boolean(),
  /** The BB host's machine name: where the command runs. */
  host: z.string(),
  intervalSec: z.number(),
  /** While no BB window shows the dashboard. */
  backgroundSec: z.number(),
  timeoutSec: z.number(),
  maxOutputBytes: z.number(),
  /** Who wrote this command, when Studio knows. */
  proposedBy: z.object({
    actor: z.enum(["user", "agent"]),
    threadId: z.string().nullable(),
    threadTitle: z.string().nullable(),
    at: z.number(),
  }).nullable(),
});
export type ApprovalPrompt = z.infer<typeof approvalPromptSchema>;

/** "Every 5 minutes", "Every hour", "Every 2 days". */
export function describeEvery(seconds: number): string {
  const units: [number, string][] = [[86_400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]];
  for (const [size, name] of units) {
    if (seconds >= size && seconds % size === 0) {
      const n = seconds / size;
      return n === 1 ? `Every ${name}` : `Every ${n} ${name}s`;
    }
  }
  return `Every ${seconds} seconds`;
}

/** "1 MB", "512 KB". */
export function describeBytes(bytes: number): string {
  return bytes >= 1024 * 1024 && bytes % (1024 * 1024) === 0 ? `${bytes / 1024 / 1024} MB` : `${Math.round(bytes / 1024)} KB`;
}

export const widgetViewSchema = widgetSchema.extend({
  /** For script sources: whether the exact command is approved. */
  script: scriptStateSchema.nullable(),
});
export type WidgetView = z.infer<typeof widgetViewSchema>;

export const widgetTypeViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  html: z.string(),
  defaultOptions: z.record(z.string(), z.unknown()),
  sampleData: z.unknown().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type WidgetTypeView = z.infer<typeof widgetTypeViewSchema>;

export const dashboardMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  widgetCount: z.number(),
  archived: z.boolean(),
});
export type DashboardMeta = z.infer<typeof dashboardMetaSchema>;

export const dashboardViewSchema = dashboardMetaSchema.extend({
  /** In grid order (lg layout, top to bottom, left to right). */
  widgets: z.array(widgetViewSchema),
  layouts: layoutsSchema,
  data: z.array(dataViewSchema),
  /** Library types the widgets use. */
  widgetTypes: z.array(widgetTypeViewSchema),
});
export type DashboardView = z.infer<typeof dashboardViewSchema>;

/** One edit. The fields each op reads are listed in OPS_HELP. */
export const opSchema = z.object({
  op: z.enum(["add", "move", "resize", "remove", "update"]),
  widgetId: z.string().max(100).optional(),
  type: z.enum(WIDGET_TYPES).optional(),
  title: z.string().max(LIMITS.title).nullable().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  /** update: replace options instead of merging them (a null value removes a key when merging). */
  replaceOptions: z.boolean().optional(),
  source: sourceSchema.optional(),
  customType: z.string().max(100).nullable().optional(),
  html: z.string().nullable().optional(),
  x: z.number().int().min(0).max(1000).optional(),
  y: z.number().int().min(0).max(100_000).optional(),
  w: z.number().int().min(1).max(100).optional(),
  h: z.number().int().min(1).max(200).optional(),
  /** move, resize: which layout (default lg; the others follow on add). */
  breakpoint: z.enum(BREAKPOINT_NAMES).optional(),
});
export type Op = z.infer<typeof opSchema>;

export const OPS_HELP = [
  "add: type (required), title, options, source, customType/html (custom widgets), x, y, w, h (lg grid of 12 columns; placed at the bottom when x/y are left out).",
  "move: widgetId, x, y, breakpoint (lg, md or sm; default lg).",
  "resize: widgetId, w, h, breakpoint.",
  "remove: widgetId.",
  "update: widgetId and any of type, title, options (merged; null removes a key; replaceOptions replaces them), source (replaced), customType, html.",
].join("\n");

export const versionViewSchema = z.object({
  id: z.number(),
  createdAt: z.number(),
  /** user or agent */
  actor: z.string(),
  label: z.string(),
  widgetCount: z.number(),
});
export type VersionView = z.infer<typeof versionViewSchema>;

/** Reads `a.b[0].c` out of a value; undefined when the path doesn't exist. */
export function selectPath(value: unknown, path: string | undefined): unknown {
  if (!path?.trim()) return value;
  const parts = path.trim().replace(/^\$\.?/, "").match(/[^.[\]]+|\[(\d+)\]/g) ?? [];
  let current: unknown = value;
  for (const raw of parts) {
    if (current === null || current === undefined) return undefined;
    const index = /^\[(\d+)\]$/.exec(raw)?.[1] ?? (/^\d+$/.test(raw) && Array.isArray(current) ? raw : null);
    if (index !== null) {
      if (!Array.isArray(current)) return undefined;
      current = current[Number(index)];
    } else {
      if (typeof current !== "object" || Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[raw];
    }
  }
  return current;
}

/** "just now", "4m ago", "3h ago", "2d ago". */
export function ago(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export { jsonBytes };
