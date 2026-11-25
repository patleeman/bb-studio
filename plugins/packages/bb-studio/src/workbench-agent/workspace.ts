// A conversation's Workspace (its workbench tabs) as the server keeps it, for
// the phone, the desktop and the agent tools alike: what a tab shows (a
// WorkspaceTabRef), how two refs name the same thing, and the conversions to
// and from the desktop workbench's tabs and open specs. Pure, with no SDK
// value import, so the app, the server and tests share it.
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { MOBILE_SUPPORT, refOfTab, STUDIO_PLUGIN, TAB_KIND_IDS, tabOpenFor, type MobileSupport, type TabKindId } from "../tab-kinds";
import type { PanelTab } from "./exec";
import { stableJson, type OpenSpec } from "./shared";

const json: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json)]));
const text = (max: number) => z.string().min(1).max(max).nullable().optional();

/** Every tab kind, and "plugin" for another plugin's tab Studio has no kind for. */
export const WORKSPACE_KINDS = [...TAB_KIND_IDS, "plugin"] as const;
export type WorkspaceKind = TabKindId | "plugin";

/**
 * What a Workspace tab shows. One flat shape, so native clients get a plain
 * struct: `id` for Studio's kinds (a thread, an item, a Bot, an entry, a
 * workflow run; null for a page with one per Bot), `path` with
 * `environmentId` or `hostId` for a file, `path` for a diff, `url` for a
 * browser tab, `terminalId` for a terminal, and `pluginId`, `tabId` and
 * `params` for another plugin's tab.
 */
export const workspaceTabRefSchema = z.object({
  kind: z.enum(WORKSPACE_KINDS as unknown as [string, ...string[]]),
  id: text(500),
  path: text(4096),
  environmentId: text(200),
  hostId: text(200),
  url: text(4096),
  terminalId: text(200),
  pluginId: text(100),
  tabId: text(100),
  params: json.nullable().optional(),
});
export type WorkspaceTabRef = Omit<z.infer<typeof workspaceTabRefSchema>, "kind"> & { kind: WorkspaceKind };

export const mobileSupportOf = (ref: Pick<WorkspaceTabRef, "kind">): MobileSupport => ref.kind === "plugin" ? "web" : MOBILE_SUPPORT[ref.kind];

/** A path as keys compare it: "./" dropped; an absolute path keeps its leading "/". */
const trimPath = (path: string) => path.replace(/^(?:\.\/+)+/u, "");

/** The ref with only the fields its kind uses, so equal refs serialize the same. */
export function cleanRef(ref: WorkspaceTabRef): WorkspaceTabRef {
  switch (ref.kind) {
    case "file": return { kind: "file", path: ref.path ?? null, ...(ref.environmentId ? { environmentId: ref.environmentId } : {}), ...(ref.hostId ? { hostId: ref.hostId } : {}) };
    case "diff": return { kind: "diff", path: ref.path ?? null };
    case "browser": return { kind: "browser", url: ref.url ?? null };
    case "terminal": return { kind: "terminal", terminalId: ref.terminalId ?? null };
    case "plugin": return { kind: "plugin", pluginId: ref.pluginId ?? null, tabId: ref.tabId ?? null, params: ref.params ?? null };
    default: return { kind: ref.kind, id: ref.id ?? null };
  }
}

/** What a ref shows, the same however often it is opened: the Workspace's identity of a tab. */
export function refKey(ref: WorkspaceTabRef): string {
  switch (ref.kind) {
    case "file": return `file:${trimPath(ref.path ?? "")}`;
    case "diff": return `diff:${trimPath(ref.path ?? "")}`;
    case "browser": return `url:${ref.url ?? ""}`;
    case "terminal": return `terminal:${ref.terminalId ?? ""}`;
    case "plugin": return `plugin:${ref.pluginId ?? ""}/${ref.tabId ?? ""}:${stableJson(ref.params ?? null)}`;
    default: return `${ref.kind}:${ref.id ?? ""}`;
  }
}

/**
 * Whether two keys name the same thing. Exact, except a file named by its
 * full path matches the same file named relative to its worktree (the
 * absolute one ends with "/" and the relative one). Two relative paths
 * never match by suffix: `a.ts` is not `src/a.ts`.
 */
export function sameKey(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a.startsWith("file:") || !b.startsWith("file:")) return false;
  const left = a.slice(5);
  const right = b.slice(5);
  if (!left || !right) return false;
  const [abs, rel] = left.startsWith("/") && !right.startsWith("/") ? [left, right] : right.startsWith("/") && !left.startsWith("/") ? [right, left] : [null, null];
  return !!abs && !!rel && abs.endsWith(`/${rel}`);
}

/** Whether two refs show the same thing: the same key, and for files the same worktree or machine where both say. */
export function sameRef(a: WorkspaceTabRef, b: WorkspaceTabRef): boolean {
  if (!sameKey(refKey(a), refKey(b))) return false;
  if (a.kind !== "file") return true;
  if (a.environmentId && b.environmentId && a.environmentId !== b.environmentId) return false;
  if (a.hostId && b.hostId && a.hostId !== b.hostId) return false;
  return true;
}

const hasDotDot = (path: string) => path.split(/[\\/]+/u).some((segment) => segment === "..");

/**
 * Why a ref can't be stored, or null when it can. Browser tabs are http(s)
 * only (no javascript:, file:, data:); a path has no ".." segment; a path
 * inside a worktree (a file with environmentId, a diff) is relative; a file
 * on a machine (hostId) is absolute; a file says where it is.
 */
export function refProblem(ref: WorkspaceTabRef): string | null {
  switch (ref.kind) {
    case "browser": {
      let url: URL;
      try { url = new URL(ref.url ?? ""); } catch { return "A browser tab needs an http(s) URL."; }
      return url.protocol === "http:" || url.protocol === "https:" ? null : "A browser tab needs an http(s) URL.";
    }
    case "file": case "diff": {
      const path = ref.path ?? "";
      if (!path || path.includes("\0")) return `A ${ref.kind} tab needs a path.`;
      if (hasDotDot(path)) return "A path can't have \"..\" in it.";
      const absolute = path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);
      if (ref.kind === "diff" || ref.environmentId) return absolute ? "A path in a worktree is relative to it." : null;
      if (ref.hostId) return absolute ? null : "A file on a machine needs its full path.";
      return "A file tab needs its worktree (environmentId) or machine (hostId).";
    }
    default: return refComplete(ref) ? null : `A ${ref.kind} tab is missing what it shows.`;
  }
}

/** Whether a ref has what it needs to be shown. */
export function refComplete(ref: WorkspaceTabRef): boolean {
  switch (ref.kind) {
    case "file": case "diff": return !!ref.path;
    case "browser": return !!ref.url;
    case "terminal": return !!ref.terminalId;
    case "plugin": return !!ref.pluginId && !!ref.tabId;
    default: return true;
  }
}

/** A plugin tab as a ref: Studio's kinds (and Visual Chat's and Workflows') by kind, any other as "plugin". */
export function refOfPluginTab(pluginId: string, tabId: string, params: JsonValue | null): WorkspaceTabRef {
  const ref = refOfTab({ pluginId, tabId, params });
  return ref ? { kind: ref.kind, id: ref.id } : { kind: "plugin", pluginId, tabId, params };
}

/**
 * What a desktop workbench tab shows; null for tabs that stay local: Info,
 * New Tab, plugin details, and fixed tabs (a plugin's own, such as the git
 * Changes tab, which can't be closed).
 */
export function refOfPanelTab(tab: PanelTab): WorkspaceTabRef | null {
  const detail = tab.detail;
  if (!tab.closable) return null;
  if (detail.kind === "plugin" && "pluginId" in detail && detail.tab.availability === "fixed") return null;
  if (detail.kind === "plugin" && "pluginId" in detail) return refOfPluginTab(detail.pluginId, detail.tab.id, detail.params ?? null);
  if (detail.kind === "file" && "path" in detail) return { kind: "file", path: detail.path };
  if (detail.kind === "browser" && "url" in detail) return { kind: "browser", url: detail.url };
  if (detail.kind === "terminal" && "terminalId" in detail) return { kind: "terminal", terminalId: detail.terminalId };
  return null;
}

/** What an agent's open spec shows. */
export function refOfSpec(spec: OpenSpec): WorkspaceTabRef {
  switch (spec.kind) {
    case "tab": return refOfPluginTab(spec.tab.pluginId ?? STUDIO_PLUGIN, spec.tab.id, spec.params ?? null);
    case "file": return spec.target.kind === "workspace"
      ? { kind: "file", path: spec.target.path, environmentId: spec.target.environmentId }
      : { kind: "file", path: spec.target.path, hostId: spec.target.hostId };
    case "diff": return { kind: "diff", path: spec.path };
    case "url": return { kind: "browser", url: spec.url };
    case "terminal": return { kind: "terminal", terminalId: spec.terminalId };
  }
}

/** How the desktop workbench opens a ref; null when it can't (a file with no place, a kind BB has no tab for). */
export function openSpecOf(ref: WorkspaceTabRef, title: string): OpenSpec | null {
  switch (ref.kind) {
    case "file":
      if (!ref.path) return null;
      if (ref.environmentId) return { kind: "file", target: { kind: "workspace", environmentId: ref.environmentId, path: ref.path }, location: null };
      if (ref.hostId) return { kind: "file", target: { kind: "host", hostId: ref.hostId, path: ref.path }, location: null };
      return null;
    case "diff": return ref.path ? { kind: "diff", path: ref.path } : null;
    case "browser": return ref.url && /^https?:\/\//i.test(ref.url) ? { kind: "url", url: ref.url } : null;
    case "terminal": return ref.terminalId ? { kind: "terminal", terminalId: ref.terminalId } : null;
    case "plugin":
      if (!ref.pluginId || !ref.tabId) return null;
      return { kind: "tab", tab: { id: ref.tabId, ...(ref.pluginId === STUDIO_PLUGIN ? {} : { pluginId: ref.pluginId }) }, ...(ref.params != null ? { params: ref.params } : {}), title };
    default: {
      const open = tabOpenFor({ kind: ref.kind, id: ref.id ?? null }, title);
      if (!open) return null;
      return { kind: "tab", tab: { id: open.tabId, ...(open.pluginId === STUDIO_PLUGIN ? {} : { pluginId: open.pluginId }) }, ...(open.params !== null ? { params: open.params } : {}), title: open.title };
    }
  }
}
