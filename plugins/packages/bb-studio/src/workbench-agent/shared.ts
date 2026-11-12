// Agent control of a conversation's workbench (the side panel beside the
// chat): what the server and the app window share. The tools run on the
// server (src/workbench-agent/server.ts); the workbench lives in the app, so
// each call goes over Studio's realtime channel to the window showing that
// conversation, which claims it, runs it (exec.ts) and replies over RPC
// (contract.ts). Pure, with no SDK value import, so the app can load it.
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

/** The server publishes each command here; every app window hears it. */
export const WORKBENCH_CHANNEL = "studio-workbench";
/** How long a window showing the conversation has to claim a command before the server says it isn't on screen. */
export const CLAIM_MS = 1500;
/** How long the claiming window has to finish (an open waits up to 3 s for its tab). */
export const RESULT_MS = 10_000;
/** The panel's share of the view, as BB clamps it. */
export const MIN_WIDTH_PERCENT = 20;
export const MAX_WIDTH_PERCENT = 80;
/** The workbench holds at most this many panes, side by side, right of the conversation. */
export const MAX_PANES = 2;
/** Each of two panes keeps at least this share of the workbench (BB's rule). */
export const MIN_PANE_PERCENT = 15;
/** The mark on a tab opened behind the selected one while the user was typing, until they look at it. */
export const NEW_MARK = "• ";

export type LayoutField = "panel" | "widthPercent" | "conversation" | "panes" | "paneWidths";
export const LAYOUT_FIELDS: readonly LayoutField[] = ["panel", "widthPercent", "conversation", "panes", "paneWidths"];

const json: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json)]));

/**
 * A workbench's layout as these tools read and set it. `panes` (how many)
 * and `paneWidths` (left first: read as each pane's share of the workbench in
 * percent; set as a ratio, such as [2, 1]) are there only on a BB whose
 * workbench has panes (adaptLayout).
 */
export const layoutSchema = z.object({
  panel: z.enum(["open", "closed"]),
  widthPercent: z.number(),
  conversation: z.enum(["shown", "collapsed"]),
  panes: z.union([z.literal(1), z.literal(2)]).optional(),
  paneWidths: z.tuple([z.number(), z.number()]).optional(),
});
export type WorkbenchLayout = z.infer<typeof layoutSchema>;

const fileLocation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line"), line: z.number().int().min(1), column: z.number().int().min(1).nullable() }),
  z.object({ kind: z.literal("range"), startLine: z.number().int().min(1), endLine: z.number().int().min(1) }),
]);

/** What `ExperimentalWorkbench.open` takes, as far as these tools use it (no terminals). */
export const openSpecSchema = z.discriminatedUnion("kind", [
  /** `tab.pluginId`: another plugin's tab it lets others open (a Visual Chat board, a workflow run). */
  z.object({ kind: z.literal("tab"), tab: z.object({ id: z.string().min(1).max(100), pluginId: z.string().min(1).max(100).optional() }), params: json.optional(), title: z.string().max(300).optional() }),
  z.object({
    kind: z.literal("file"),
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("workspace"), environmentId: z.string().min(1).max(200), path: z.string().min(1).max(4096) }),
      z.object({ kind: z.literal("host"), hostId: z.string().min(1).max(200), path: z.string().min(1).max(4096) }),
    ]),
    location: fileLocation.nullable().optional(),
  }),
  z.object({ kind: z.literal("diff"), path: z.string().min(1).max(4096) }),
  z.object({ kind: z.literal("url"), url: z.string().url().max(4096) }),
]);
export type OpenSpec = z.infer<typeof openSpecSchema>;

/**
 * What Studio remembers about one conversation's workbench between calls:
 * the tabs the agent opened (by item and key), what the user closed or moved
 * out of the panel after the agent opened it, the layout fields the agent
 * set, and the fields the user changed after that.
 */
export const recordSchema = z.object({
  opened: z.array(z.object({ item: z.string().max(5000), key: z.string().max(500), title: z.string().max(300) })).max(100),
  dismissed: z.array(z.object({ item: z.string().max(5000), title: z.string().max(300) })).max(200),
  layoutSet: layoutSchema.partial(),
  userLayout: z.array(z.enum(["panel", "widthPercent", "conversation", "panes", "paneWidths"])).max(5),
});
export type WorkbenchRecord = z.infer<typeof recordSchema>;
export const EMPTY_RECORD: WorkbenchRecord = { opened: [], dismissed: [], layoutSet: {}, userLayout: [] };

export const opSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }),
  /** `item` names what is opened across reopens (itemOfSpec); `title` is how results name it. */
  z.object({
    type: z.literal("open"), spec: openSpecSchema, item: z.string().max(5000), title: z.string().max(300), focus: z.boolean(), force: z.boolean(),
    /** The pane to open it in (2 or "new" makes or uses the second), and its place in that pane's tab strip. */
    pane: z.union([z.literal(1), z.literal(2), z.literal("new"), z.literal("window")]).optional(),
    index: z.number().int().min(0).max(500).optional(),
  }),
  z.object({ type: z.literal("close"), key: z.string().min(1).max(500), force: z.boolean() }),
  z.object({ type: z.literal("focus"), key: z.string().min(1).max(500), force: z.boolean() }),
  z.object({ type: z.literal("popOut"), key: z.string().min(1).max(500), force: z.boolean() }),
  z.object({ type: z.literal("arrange"), layout: layoutSchema.partial(), force: z.boolean() }),
]);
export type WorkbenchOp = z.infer<typeof opSchema>;

/** The realtime payload: one tool call for one conversation's workbench. */
export const commandSchema = z.object({ requestId: z.string().min(1).max(100), threadId: z.string().min(1).max(200), op: opSchema, record: recordSchema });
export type WorkbenchCommand = z.infer<typeof commandSchema>;

/** JSON with object keys sorted, so the same params name the same tab whatever their order. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, each]) => each !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, each]) => `${JSON.stringify(key)}:${stableJson(each)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A plugin tab as an item: Studio's own by id, another plugin's (Visual Chat's) by plugin and id. */
export function tabItem(pluginId: string | null, tabId: string, params: JsonValue | null): string {
  return `tab:${pluginId && pluginId !== STUDIO_PLUGIN_ID ? `${pluginId}/` : ""}${tabId}:${stableJson(params)}`;
}

/** Studio's plugin id (src/kit/contract.ts), named here so the server needn't load the kit. */
export const STUDIO_PLUGIN_ID = "studio";
/** Other plugins whose tabs these tools open (src/tab-kinds.ts: Visual Chat's board, Workflows' run). */
export const SIBLING_TAB_PLUGINS: ReadonlySet<string> = new Set(["studio-visual-chat", "workflows"]);

/** What a spec opens, the same however often it is opened: a Studio tab and its params, a file, a diff, a URL. */
export function itemOfSpec(spec: OpenSpec): string {
  switch (spec.kind) {
    case "tab": return tabItem(spec.tab.pluginId ?? null, spec.tab.id, spec.params ?? null);
    case "file": return `file:${spec.target.path}`;
    case "diff": return `diff:${spec.path}`;
    case "url": return `url:${spec.url}`;
  }
}

const trimPath = (path: string) => path.replace(/^\.?\/+/u, "");

/** Whether two items are the same thing. A file matches by path, relative or absolute (one ends with the other). */
export function sameItem(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a.startsWith("file:") || !b.startsWith("file:")) return false;
  const left = trimPath(a.slice(5));
  const right = trimPath(b.slice(5));
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

/** The fork's layout as `ExperimentalWorkbench.layout()` reports it: `panes` lists each pane's tabs and width on a BB with two panes. */
export interface HostLayout {
  panel: "open" | "closed";
  widthPercent: number;
  conversation: "shown" | "collapsed";
  panes?: readonly { tabs: readonly string[]; widthPercent: number }[];
}

/** The tools' layout from BB's: the pane count and widths where BB has panes, else the panel alone. */
export function adaptLayout(host: HostLayout): WorkbenchLayout {
  const layout: WorkbenchLayout = { panel: host.panel, widthPercent: host.widthPercent, conversation: host.conversation };
  if (!Array.isArray(host.panes) || !host.panes.length) return layout;
  const panes = host.panes.slice(0, MAX_PANES);
  layout.panes = panes.length === 2 ? 2 : 1;
  if (panes.length === 2) layout.paneWidths = [panes[0]!.widthPercent, panes[1]!.widthPercent];
  return layout;
}

/** Which pane (1 or 2) holds each tab key, on a BB with panes. */
export function paneOfKeys(host: HostLayout): Map<string, 1 | 2> {
  const panes = new Map<string, 1 | 2>();
  (host.panes ?? []).slice(0, MAX_PANES).forEach((pane, index) => { for (const key of pane.tabs) panes.set(key, index === 0 ? 1 : 2); });
  return panes;
}

/** Studio's thread tab (src/kit/app/workbench.ts THREAD_TAB), named here so the server needn't load the app kit. */
export const THREAD_TAB_ID = "thread";
