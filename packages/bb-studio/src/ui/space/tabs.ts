// A Space opens on its lead's thread page, so its threads, items and status
// are thread panel tabs: BB's own workbench tabs, closable, persisted, and
// listed in the panel's New tab menu. Outside a thread page (no side panel)
// opening falls back to the main view.
import { openAppPath } from "@bb-studio/kit/app";
import type { BbNavigate, JsonValue } from "@get-bb/plugin-sdk/app";

export const SPACE_STATUS_ACTION = "space-overview";
export const SPACE_THREAD_ACTION = "space-thread";
export const SPACE_ITEM_ACTION = "space-item";

export interface ThreadTabParams { threadId: string }
export interface ItemTabParams { path: string; title: string }
/** "New in Space" from the New tab menu: `draft` names the tab until it holds an item. */
export interface DraftTabParams { draft: string }

function record(params: JsonValue | null): Record<string, JsonValue> | null {
  return params && typeof params === "object" && !Array.isArray(params) ? params : null;
}

export function threadParams(params: JsonValue | null): ThreadTabParams | null {
  const value = record(params);
  return typeof value?.threadId === "string" ? { threadId: value.threadId } : null;
}

export function itemParams(params: JsonValue | null): ItemTabParams | null {
  const value = record(params);
  return typeof value?.path === "string" && value.path.startsWith("/") ? { path: value.path, title: typeof value.title === "string" ? value.title : "Item" } : null;
}

export function draftParams(params: JsonValue | null): DraftTabParams | null {
  const value = record(params);
  return typeof value?.draft === "string" ? { draft: value.draft } : null;
}

/** Open a thread beside the lead; on other surfaces, go to it. */
export function openThreadTab(navigate: BbNavigate, thread: { id: string; title: string }): void {
  const params: ThreadTabParams = { threadId: thread.id };
  if (!navigate.openThreadPanel({ actionId: SPACE_THREAD_ACTION, title: thread.title, params: { ...params } })) navigate.toThread(thread.id);
}

/** Open a Studio item beside the lead; on other surfaces, go to it. */
export function openItemTab(navigate: BbNavigate, item: { href: string; title: string }): void {
  const params: ItemTabParams = { path: item.href, title: item.title };
  if (!navigate.openThreadPanel({ actionId: SPACE_ITEM_ACTION, title: item.title, params: { ...params } })) openAppPath(item.href, { main: true });
}

export function openStatusTab(navigate: BbNavigate): boolean {
  return navigate.openThreadPanel({ actionId: SPACE_STATUS_ACTION, title: "Status" });
}

// What a "New in Space" tab made, so it keeps showing the item after a reload.
const DRAFT_KEY = "bb-studio.space-drafts";

function drafts(): Record<string, ItemTabParams> {
  try { return JSON.parse(globalThis.localStorage?.getItem(DRAFT_KEY) ?? "{}") as Record<string, ItemTabParams>; } catch { return {}; }
}

export function draftItem(draft: string): ItemTabParams | null {
  return drafts()[draft] ?? null;
}

export function saveDraftItem(draft: string, item: ItemTabParams): void {
  // Keep the most recent few; older drafts' tabs fall back to the picker.
  const next = Object.entries({ ...drafts(), [draft]: item }).slice(-50);
  try { globalThis.localStorage?.setItem(DRAFT_KEY, JSON.stringify(Object.fromEntries(next))); } catch { /* storage unavailable */ }
}

export function newDraftId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
