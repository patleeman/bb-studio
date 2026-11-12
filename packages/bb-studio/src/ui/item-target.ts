// A thread or a Studio item as one thing to open, drag or drop: its route in
// the main view, and the workbench tab that shows it beside a conversation.
// Pure. (Main tabs used these; they outlive them for drag and drop and the
// workbench.)
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { builtinItemAt } from "../builtins";
import { typeHref, typeOfId } from "../item-model";
import { STUDIO_PLUGIN_ID } from "../kit/contract";
import { THREAD_TAB, type WorkbenchOpen } from "../kit/app/workbench";
import { STUDIO_TAB, tabKind } from "./studio-tab/model";

/** What a drag or a link shows. An item id is a Studio item id (page, whiteboard, app, design…). */
export type TabTarget = { kind: "thread"; id: string } | { kind: "item"; id: string };

export const targetKey = (target: TabTarget): string => `${target.kind}:${target.id}`;
export const sameTarget = (a: TabTarget | null | undefined, b: TabTarget | null | undefined): boolean => !!a && !!b && a.kind === b.kind && a.id === b.id;

const THREAD_PATH = /^\/(?:projects\/[^/?#]+\/)?threads\/([^/?#]+)(?:\/|$)/;

function decode(segment: string): string | null {
  try { return decodeURIComponent(segment); } catch { return null; }
}

/**
 * What the main view's path shows: a thread, or an item in Studio's items
 * index (a page, whiteboard, design, mini app, dashboard, artifact), under
 * any of its addresses and sub-views. Null for every other page.
 */
export function targetForPath(pathname: string): TabTarget | null {
  const clean = pathname.split(/[?#]/)[0] ?? "";
  const thread = THREAD_PATH.exec(clean);
  if (thread) { const id = decode(thread[1]!); return id ? { kind: "thread", id } : null; }
  const item = builtinItemAt(clean);
  if (!item) return null;
  const type = typeOfId(item.id);
  return type && type.pluginId === item.pluginId ? { kind: "item", id: item.id } : null;
}

/** The main view's path for a thread or an item; null for an item id of no known type. */
export function pathForTarget(target: TabTarget): string | null {
  if (target.kind === "thread") return `/threads/${encodeURIComponent(target.id)}`;
  const type = typeOfId(target.id);
  return type ? typeHref(type, target.id) : null;
}

/** The item kind name (page, drawing, design, mini, dashboard, artifact) an item id has, for its icon. */
export function itemKindOf(id: string): string | null {
  return typeOfId(id)?.kind ?? null;
}

/** The workbench tab that shows a thread or an item beside a conversation; null for an item with no workbench view. */
export function workbenchOpenFor(target: TabTarget, title: string): WorkbenchOpen | null {
  if (target.kind === "thread") return { tabId: THREAD_TAB, params: { threadId: target.id }, title: title || "Thread" };
  const type = typeOfId(target.id);
  const kind = type ? tabKind(type.kind, target.id) : null;
  return kind ? { tabId: STUDIO_TAB, params: { kind: kind.kind, id: target.id }, title: title || "Untitled" } : null;
}

const field = (params: JsonValue | null | undefined, key: string): string | null => {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const value = params[key];
  return typeof value === "string" && value ? value : null;
};

/** What a workbench tab of Studio's shows: a thread tab's thread, a Studio tab's item. Null for every other tab. */
export function targetForWorkbenchTab(tab: { pluginId: string; tabId: string; params: JsonValue | null | undefined }): TabTarget | null {
  if (tab.pluginId !== STUDIO_PLUGIN_ID) return null;
  if (tab.tabId === THREAD_TAB) { const id = field(tab.params, "threadId"); return id ? { kind: "thread", id } : null; }
  if (tab.tabId !== STUDIO_TAB) return null;
  const id = field(tab.params, "id");
  return id && typeOfId(id) ? { kind: "item", id } : null;
}
