// Drag and drop of "an item": one payload for a thread, a Studio document, a
// tab or a file, written by every drag source in Studio (the Bot sidebar's
// rows, Search results, cards and links in a transcript) and read by every
// drop target (a page's body, and BB's own workbench, composer and main view
// through `slots.experimental_itemDrop`). BB writes the same payload for the tabs of
// its side panel, so a workbench tab can be dropped on Studio's targets too.
//
// The payload travels in the drag's DataTransfer under ITEM_DRAG_TYPE. A
// browser only lets a page read a drag's data on drop, so the item being
// dragged in this window is also kept here (currentDragItem) for `dragover`
// decisions. Where BB has its own helpers (`experimental_writeDragItem`,
// `experimental_readDragItem`) they are used, since BB tracks the drag the
// same way for its targets; src/ui/item-drop.ts lends them.
import { typeOfId } from "../../item-model";
import { itemKindOfId, pathFor, refOfPath, refOfTab, tabOpenFor, type TabRef } from "../../tab-kinds";
import { pathForTarget, targetForPath, targetForWorkbenchTab, type TabTarget } from "../../ui/item-target";
import { mentionPrompt, STUDIO_PLUGIN_ID } from "../contract";
import { threadLinkId } from "./studio-item";

/** The DataTransfer type of the payload: JSON of a DragItem. */
export const ITEM_DRAG_TYPE = "application/x-bb-item";

/** A workbench action tab being dragged: which plugin's, which tab, its params, and the thread whose side panel holds it (null on a plugin page). */
export interface DragItemTab {
  pluginId: string;
  tabId: string;
  params: Record<string, unknown> | undefined;
  threadId: string | null;
}

export interface DragItem {
  kind: "thread" | "doc" | "tab" | "file";
  /** A thread id, a Studio item id, or a tab key. */
  id: string;
  title: string;
  /** The BB route that opens it in the main view. */
  path?: string;
  /** "studio" for Studio's documents and tabs. */
  pluginId?: string;
  /** Kind "tab": the workbench tab. */
  tab?: DragItemTab;
  /** Kind "tab", a tab dragged out of a side panel: what BB's workbench API opens it with (BB's `ExperimentalWorkbenchOpenSpec`), carried as BB wrote it. BB moves such a tab between its own panels and windows itself. */
  open?: Record<string, unknown>;
}

export interface HostDragHelpers {
  write?(data: DataTransfer, item: DragItem): void;
  read?(data: DataTransfer): unknown;
}

let host: HostDragHelpers = {};
let current: DragItem | null = null;
let watching = false;

/** BB's own helpers, where it has them; `{}` for none. */
export function setHostDragHelpers(helpers: HostDragHelpers): void {
  host = helpers;
}

const KINDS: ReadonlySet<string> = new Set(["thread", "doc", "tab", "file"]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A payload from outside (another window, BB, another plugin), checked; null when it isn't one. */
export function parseDragItem(value: unknown): DragItem | null {
  if (!isRecord(value)) return null;
  const { kind, id, title, path, pluginId, tab, open } = value;
  if (typeof kind !== "string" || !KINDS.has(kind) || typeof id !== "string" || !id || id.length > 2_000) return null;
  const item: DragItem = { kind: kind as DragItem["kind"], id, title: typeof title === "string" ? title.slice(0, 300) : "" };
  if (typeof path === "string" && path.startsWith("/") && !path.startsWith("//")) item.path = path;
  if (typeof pluginId === "string" && pluginId) item.pluginId = pluginId;
  if (isRecord(tab) && typeof tab.pluginId === "string" && typeof tab.tabId === "string") {
    item.tab = { pluginId: tab.pluginId, tabId: tab.tabId, params: isRecord(tab.params) ? tab.params : undefined, threadId: typeof tab.threadId === "string" && tab.threadId ? tab.threadId : null };
  }
  if (kind === "tab" && isRecord(open) && typeof open.kind === "string") item.open = open;
  return item;
}

function types(data: DataTransfer | null | undefined): readonly string[] {
  try { return data ? Array.from(data.types ?? []) : []; } catch { return []; }
}

/** Whether a drag carries an item: all a `dragover` may ask of another window's drag. */
export function hasDragItem(data: DataTransfer | null | undefined): boolean {
  return types(data).includes(ITEM_DRAG_TYPE);
}

/** Whether a drag carries files from the system (Finder). */
export function hasDragFiles(data: DataTransfer | null | undefined): boolean {
  return types(data).includes("Files");
}

/** The absolute address of an in-app path, for other apps. */
export function absoluteUrl(path: string, origin: string = typeof window === "undefined" ? "" : window.location.origin): string {
  return `${origin}${path}`;
}

function watch(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  // The drag is over when its source hears `dragend`, or this window takes the drop.
  const clear = () => { current = null; };
  window.addEventListener("dragend", clear, true);
  window.addEventListener("drop", () => { setTimeout(clear, 0); }, true);
}

/**
 * Puts `item` on a drag: the payload, and its address as a link and as text
 * when it has one, so a drop on another app gives a link.
 */
export function writeDragItem(data: DataTransfer | null | undefined, item: DragItem): void {
  if (!data) return;
  current = item;
  watch();
  let written = false;
  if (host.write) {
    try { host.write(data, item); written = hasDragItem(data); } catch { written = false; }
  }
  try {
    if (!written) data.setData(ITEM_DRAG_TYPE, JSON.stringify(item));
    if (item.path) {
      const url = absoluteUrl(item.path);
      data.setData("text/uri-list", url);
      data.setData("text/plain", url);
    } else if (item.title) {
      data.setData("text/plain", item.title);
    }
  } catch { /* a drag whose data can't be written still moves within this window */ }
}

/** The item a drop carries, or null. */
export function readDragItem(data: DataTransfer | null | undefined): DragItem | null {
  if (!data) return null;
  if (host.read) {
    try {
      const item = parseDragItem(host.read(data));
      if (item) return item;
    } catch { /* read it ourselves */ }
  }
  try {
    const raw = data.getData(ITEM_DRAG_TYPE);
    return raw ? parseDragItem(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** The item being dragged in this window, while it is. */
export function currentDragItem(): DragItem | null {
  return current;
}

/**
 * The item a `dragover` is about, where it can be known: this window's own
 * drag, or one whose data can be read. Null for another window's drag, whose
 * data is only readable on drop: such a target accepts on hasDragItem and
 * decides on drop.
 */
export function peekDragItem(data: DataTransfer | null | undefined): DragItem | null {
  if (!hasDragItem(data)) return null;
  return current ?? readDragItem(data);
}

/** For tests, and for a source whose drag ended without `dragend` reaching the window. */
export function clearDragItem(): void {
  current = null;
}

export function threadDragItem(thread: { id: string; title?: string | null }): DragItem {
  return { kind: "thread", id: thread.id, title: thread.title?.trim() || "Thread", path: `/threads/${encodeURIComponent(thread.id)}` };
}

/** A Studio document: `id` is its Studio item id. `href` is its address where the caller has it. */
export function docDragItem(item: { id: string; title?: string | null; href?: string | null }): DragItem {
  const path = item.href || pathForTarget({ kind: "item", id: item.id });
  return { kind: "doc", id: item.id, title: item.title?.trim() || "Untitled", pluginId: STUDIO_PLUGIN_ID, ...(path ? { path } : {}) };
}

/** A workbench tab being dragged, as BB writes it for its side panel's tabs. */
export function tabDragItem(source: { key: string; title?: string | null; tab: DragItemTab }): DragItem {
  const shown = targetForWorkbenchTab({ pluginId: source.tab.pluginId, tabId: source.tab.tabId, params: (source.tab.params ?? null) as never });
  const path = shown ? pathForTarget(shown) : null;
  return { kind: "tab", id: source.key, title: source.title?.trim() || "Tab", pluginId: source.tab.pluginId, ...(path ? { path } : {}), tab: source.tab };
}

/**
 * What an item shows: a thread's thread, a Studio document's item, the
 * thread or item a workbench tab of Studio's shows. Null for a file, another
 * plugin's document or tab, and an id of no known type.
 */
export function dragItemTarget(item: DragItem): TabTarget | null {
  if (item.kind === "thread") return { kind: "thread", id: item.id };
  if (item.kind === "doc") return item.pluginId === STUDIO_PLUGIN_ID && typeOfId(item.id) ? { kind: "item", id: item.id } : null;
  if (item.kind !== "tab" || !item.tab) return null;
  return targetForWorkbenchTab({ pluginId: item.tab.pluginId, tabId: item.tab.tabId, params: (item.tab.params ?? null) as never });
}

/**
 * The text that mentions an item in BB's composer: the link Studio puts in a
 * new thread's prompt for "New thread with this" (mentionPrompt), which the
 * composer shows as a mention and the agent can read. Null for a file and for
 * anything with no address.
 */
export function mentionTextFor(item: DragItem): string | null {
  const target = dragItemTarget(item);
  const href = target ? pathForTarget(target) : null;
  if (!href) return null;
  return mentionPrompt([{ title: item.title, href }]);
}

/**
 * The item a link or a marked element opens, for dragging it: a thread, a
 * Studio document, or any other kind of the tab kinds registry with an
 * address (a Bot, a Bot page, a board). Null for any other address.
 */
export function linkDragItem(link: { href: string; title?: string | null }): DragItem | null {
  const threadId = threadLinkId(link.href);
  if (threadId) return threadDragItem({ id: threadId, title: link.title });
  if (!link.href.startsWith("/")) return null;
  const target = targetForPath(link.href);
  if (target) return target.kind === "thread" ? threadDragItem({ id: target.id, title: link.title }) : docDragItem({ id: target.id, title: link.title, href: link.href });
  const ref = refOfPath(link.href);
  return ref ? refDragItem(ref, link.title) : null;
}

/**
 * The id prefix of a drag that names a Studio tab but didn't come from a
 * side panel (a sidebar row, a Bot page row, a New Tab row): no tab is open
 * where it came from, so a drop never closes or skips one.
 */
export const ROW_DRAG_PREFIX = "row:";

/** Whether a "tab" item is a tab open in a side panel, as bb writes one, not a row naming a tab. */
export const isPanelTab = (item: DragItem): boolean => item.kind === "tab" && !item.id.startsWith(ROW_DRAG_PREFIX);

/**
 * The drag payload of anything the tab kinds registry opens (src/tab-kinds.ts):
 * a thread for a conversation or a worker, a document for an item, else the
 * Studio tab (or Visual Chat's board tab) that shows it. Null for bb's own
 * kinds and a ref that names nothing.
 */
export function refDragItem(ref: TabRef, title?: string | null): DragItem | null {
  if (ref.kind === "conversation" || ref.kind === "worker") return ref.id ? threadDragItem({ id: ref.id, title }) : null;
  const path = pathFor(ref);
  if (ref.id && itemKindOfId(ref.id) === ref.kind) return docDragItem({ id: ref.id, title, href: path });
  const open = tabOpenFor(ref, title);
  if (!open) return null;
  return {
    kind: "tab", id: `${ROW_DRAG_PREFIX}${ref.kind}:${ref.id ?? ""}`, title: open.title, pluginId: open.pluginId, ...(path ? { path } : {}),
    tab: { pluginId: open.pluginId, tabId: open.tabId, params: (open.params ?? undefined) as Record<string, unknown> | undefined, threadId: null },
  };
}

/** What a dragged item shows, in the registry's terms: a thread is a conversation. Null for a file, another plugin's thing and an id of no known kind. */
export function dragItemRef(item: DragItem): TabRef | null {
  if (item.kind === "thread") return { kind: "conversation", id: item.id };
  if (item.kind === "doc") {
    const kind = item.pluginId === STUDIO_PLUGIN_ID ? itemKindOfId(item.id) : null;
    return kind ? { kind, id: item.id } : null;
  }
  if (item.kind !== "tab" || !item.tab) return null;
  return refOfTab({ pluginId: item.tab.pluginId, tabId: item.tab.tabId, params: (item.tab.params ?? null) as never });
}

/**
 * Whether a drag that ended at `point` (viewport coordinates) ended outside
 * the window by at least `margin` pixels: far enough that it was meant to
 * leave it, which pops a tab out.
 */
export function endedOutside(point: { x: number; y: number }, viewport: { width: number; height: number }, margin = POP_OUT_MARGIN): boolean {
  return point.x <= -margin || point.y <= -margin || point.x >= viewport.width + margin || point.y >= viewport.height + margin;
}

/** How far outside the window a drag must end to pop a tab out. */
export const POP_OUT_MARGIN = 40;

/** Where a `dragend` ended, in viewport coordinates. Some shells report no client position for it; the screen position stands in. */
export function dragEndPoint(event: { clientX: number; clientY: number; screenX: number; screenY: number }, frame: { screenX: number; screenY: number } = window): { x: number; y: number } {
  if (event.clientX !== 0 || event.clientY !== 0 || (event.screenX === 0 && event.screenY === 0)) return { x: event.clientX, y: event.clientY };
  return { x: event.screenX - frame.screenX, y: event.screenY - frame.screenY };
}

/** Spread onto a row to make it a drag source of `item` (none for null); a click still opens it. */
export function dragSourceProps(item: DragItem | null): { draggable?: true; onDragStart?(event: { dataTransfer: DataTransfer | null }): void } {
  if (!item) return {};
  return {
    draggable: true,
    onDragStart: (event) => {
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "all";
      writeDragItem(event.dataTransfer, item);
    },
  };
}
