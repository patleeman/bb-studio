// BB's own surfaces as drop targets for anything the tab kinds registry
// knows (src/tab-kinds.ts): a thread, a document, a Bot, a Bot page, a board,
// or a tab dragged from a side panel (`slots.experimental_itemDrop`, the
// fork), and BB's own drag helpers lent to src/kit/app/item-drag.ts. Read by
// name as src/kit/app/host-sdk.ts does: on a BB without them nothing here is
// registered.
// - composer: mentions it, as a pill where BB has the fork's insertThreadMention
//   (BB's own thread pill) and insertMention (Studio's item pill), else as the
//   link "New thread with this" writes;
// - workbench: opens it as a tab (src/ui/tab-open.ts): in the pane and at the
//   place in its tab strip BB says the drop landed (`pane`, `index`), or in a
//   second pane for a drop on the workbench's right edge (`pane: "new"`).
//   Where BB hands the target its own `open` (the fork, 11 Nov), the tab opens
//   through it: that is the panel the drop landed in, a popped-out window's
//   included, where `experimental_workbench` has no component to answer from;
// - main view: opens it there, a workbench tab of Studio's moving there.
// canDropItem is pure and quick: BB asks it on every `dragover`.
import * as sdkApp from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { member } from "../kit/app/host-sdk";
import { dragItemRef, isPanelTab, setHostDragHelpers, type DragItem, type HostDragHelpers } from "../kit/app/item-drag";
import { openAppPath } from "../kit/app/nav";
import { requestCloseWorkbenchTab } from "../kit/app/workbench-close";
import { mentionPrompt, STUDIO_PLUGIN_ID } from "../kit/contract";
import { pathFor, tabOpenFor, type TabRef } from "../tab-kinds";
import { itemKindOf } from "./item-target";
import { requestThreadTab } from "../kit/app/thread-panel";
import { noteOpenedTab } from "./opened-tabs";
import { requestPageTab } from "./page-tab-requests";
import { openTabRef, requestPluginTab, type OpenDeps, type PanePlace } from "./tab-open";

/** One of BB's own surfaces as a drop target. */
export type ItemDropTarget =
  | {
      zone: "workbench";
      threadId: string | null;
      /** The pane whose tab strip took the drop, or "new" for its right edge (a second pane). Absent on a BB with one pane. */
      pane?: PanePlace;
      /** The place in that tab strip. */
      index?: number;
      /** Opens a tab in the very panel the drop landed in, as the workbench API's `open` does; absent on an older BB. */
      open?(spec: unknown, options: object): Promise<string | null>;
    }
  | {
      zone: "composer";
      threadId: string | null;
      insertText(text: string): boolean;
      /** The fork's pills; absent on an older BB. */
      insertMention?(mention: { provider: string; id: string; label: string }): boolean;
      insertThreadMention?(thread: { id: string; title: string }): boolean;
    }
  | { zone: "main" };

export interface ItemDropRegistration {
  id: string;
  canDrop(item: DragItem, target: ItemDropTarget): boolean;
  drop(item: DragItem, target: ItemDropTarget): void | Promise<void>;
}

/** Takes drops on BB's workbench, composer and main view; false on a BB without it. */
export function registerItemDrop(slots: object, registration: ItemDropRegistration): boolean {
  const slot = member(slots, "experimental_itemDrop");
  if (typeof slot !== "function") return false;
  (slot as (registration: ItemDropRegistration) => void).call(slots, registration);
  return true;
}

/** BB's own drag helpers (`experimental_writeDragItem`, `experimental_readDragItem`), where it has them. */
export function hostDragHelpers(sdk: object = sdkApp): HostDragHelpers {
  const write = member(sdk, "experimental_writeDragItem");
  const read = member(sdk, "experimental_readDragItem");
  return {
    ...(typeof write === "function" ? { write: write as NonNullable<HostDragHelpers["write"]> } : {}),
    ...(typeof read === "function" ? { read: read as NonNullable<HostDragHelpers["read"]> } : {}),
  };
}

const studioWorkbenchTab = (item: DragItem) => (isPanelTab(item) && item.tab && item.tab.pluginId === STUDIO_PLUGIN_ID ? item.tab : null);
/** Where the item opens in the main view: its own address (a Todos row knows its Bot), else its kind's. */
const addressOf = (item: DragItem, shown: TabRef): string | null => pathFor(shown) ?? item.path ?? null;
const isThread = (ref: TabRef) => ref.kind === "conversation" || ref.kind === "worker";

/**
 * Whether an item may drop on one of BB's surfaces: anything the registry can
 * show with an address; on a workbench, only what opens as a tab and isn't
 * the conversation that workbench is beside or a tab already in it. Files are
 * BB's own.
 */
export function canDropItem(item: DragItem, target: ItemDropTarget): boolean {
  if (item.kind === "file") return false;
  const shown = dragItemRef(item);
  if (!shown || !addressOf(item, shown)) return false;
  if (target.zone === "composer" || target.zone === "main") return true;
  if (!tabOpenFor(shown, item.title)) return false;
  if (target.threadId && isThread(shown) && shown.id === target.threadId) return false;
  // A tab of this very workbench moves within it, between its panes too: BB does that itself.
  return !(isPanelTab(item) && item.tab && item.tab.threadId === target.threadId);
}

/** A pill in the composer: BB's thread mention for a thread, Studio's item mention (its kind is the provider) for an item. False where BB has neither. */
function insertPill(item: DragItem, shown: TabRef, target: Extract<ItemDropTarget, { zone: "composer" }>): boolean {
  const label = item.title.trim() || (isThread(shown) ? "Conversation" : "Untitled");
  try {
    if (isThread(shown)) return typeof target.insertThreadMention === "function" && target.insertThreadMention({ id: shown.id!, title: label });
    const provider = shown.id ? itemKindOf(shown.id) : null;
    return !!provider && typeof target.insertMention === "function" && target.insertMention({ provider, id: shown.id!, label });
  } catch {
    return false;
  }
}

/** The drop itself, for an item canDropItem allowed. */
export async function dropItem(item: DragItem, target: ItemDropTarget, open: (path: string) => void = (path) => openAppPath(path), deps?: OpenDeps): Promise<void> {
  if (!canDropItem(item, target)) return;
  const shown = dragItemRef(item)!;
  const path = addressOf(item, shown)!;
  if (target.zone === "composer") {
    if (insertPill(item, shown, target)) return;
    const text = mentionPrompt([{ title: item.title.trim() || "Untitled", href: path }]);
    if (!target.insertText(text)) toast.error("Couldn't add it to the message.");
    return;
  }
  if (target.zone === "main") {
    // A workbench tab moves to the main view: Studio's own closes where it was.
    const from = studioWorkbenchTab(item);
    if (from) requestCloseWorkbenchTab(from);
    open(path);
    return;
  }
  const place = { threadId: target.threadId, ...(target.pane !== undefined ? { pane: target.pane } : {}), ...(target.index !== undefined ? { index: target.index } : {}) };
  if (!(await openTabRef(shown, item.title, place, depsForTarget(target, deps)))) toast.error("Couldn't open it in the workbench.");
}

/** The open path for a workbench drop: the target's own `open` where BB gives one, else the window's navigator (`deps`, or the default). */
export function depsForTarget(target: Extract<ItemDropTarget, { zone: "workbench" }>, deps?: OpenDeps): OpenDeps | undefined {
  const open = target.open;
  if (typeof open !== "function") return deps;
  const base: OpenDeps = deps ?? { workbench: () => null, requestThreadTab, requestPageTab, requestPluginTab, noteOpened: (ref) => noteOpenedTab(ref) };
  return { ...base, workbench: () => ({ open: (spec, options) => open.call(target, spec, options) }) };
}

/** BB's helpers for every drag, and its surfaces as drop targets. False on a BB without the drop slot. */
export function registerItemDrops(slots: object): boolean {
  setHostDragHelpers(hostDragHelpers());
  return registerItemDrop(slots, { id: "studio-items", canDrop: canDropItem, drop: (item, target) => dropItem(item, target) });
}
