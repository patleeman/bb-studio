// Dragging tabs, as in Arc: reorder within Essentials, Pinned, a folder or
// Today, and drop across them to pin, unpin, file or make an Essential.
//
// Pointer events, not HTML drag and drop, because BB's own drag-to-split
// tracks the same pointer: once it leaves the sidebar toward the page, BB
// takes over (a thread opens in a split) and this drag stands down. Essentials
// and the tab list are separate slots, so drop targets are found from the DOM
// under the pointer rather than from React context:
//   [data-tab-drop-row]   a tab: data-ref, data-zone, data-folder, data-axis (y, or x for tiles)
//   [data-tab-drop-zone]  a section or folder header: data-zone, data-folder, data-at (start | end)
import { useCallback, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import type { TabZone } from "./tabs";

/** Where a drop would put the tab: its zone, folder, and index among the others there. */
export interface DropTarget {
  zone: TabZone;
  folderId: string | null;
  index: number;
  /** For the indicator: the row it lands beside, and on which side; or the zone it ends. */
  beside: { ref: string; after: boolean } | null;
  zoneKey: string;
}

interface DragState {
  ref: string;
  title: string;
  x: number;
  y: number;
  /** Over the page rather than the sidebar: BB's split drag has it. */
  outside: boolean;
  target: DropTarget | null;
}

const THRESHOLD = 4;
let state: DragState | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };

export function useTabDragState(): DragState | null {
  return useSyncExternalStore(subscribe, () => state, () => null);
}

export function zoneKey(zone: TabZone, folderId: string | null): string {
  return folderId ? `folder:${folderId}` : zone;
}

/** The other tabs' refs in a drop list, in order, from the DOM. */
function siblings(key: string, dragged: string): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-tab-drop-row]")]
    .filter((row) => zoneKey(row.dataset.zone as TabZone, row.dataset.folder || null) === key && row.dataset.ref !== dragged)
    .map((row) => row.dataset.ref!);
}

function targetAt(x: number, y: number, dragged: string): DropTarget | null {
  const element = document.elementFromPoint(x, y);
  const row = element?.closest<HTMLElement>("[data-tab-drop-row]");
  if (row && row.dataset.ref !== dragged) {
    const zone = row.dataset.zone as TabZone;
    const folderId = row.dataset.folder || null;
    const key = zoneKey(zone, folderId);
    const box = row.getBoundingClientRect();
    const after = row.dataset.axis === "x" ? x > box.left + box.width / 2 : y > box.top + box.height / 2;
    const others = siblings(key, dragged);
    const at = others.indexOf(row.dataset.ref!);
    return { zone, folderId, index: at + (after ? 1 : 0), beside: { ref: row.dataset.ref!, after }, zoneKey: key };
  }
  const area = element?.closest<HTMLElement>("[data-tab-drop-zone]");
  if (area) {
    const zone = area.dataset.zone as TabZone;
    const folderId = area.dataset.folder || null;
    const key = zoneKey(zone, folderId);
    return { zone, folderId, index: area.dataset.at === "start" ? 0 : siblings(key, dragged).length, beside: null, zoneKey: key };
  }
  return null;
}

/**
 * Pointer handlers for a draggable tab. `onDrop` gets where it landed; a press
 * that never moves past a few pixels stays a click. `onPointerDown` from BB's
 * split support runs first, so dragging a thread out to the page still splits.
 */
export function useTabDrag(
  tab: { ref: string; title: string },
  onDrop: (target: DropTarget) => void,
  hostPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void,
  /** Finds the drop target instead of the tab rules; folders use their own. */
  resolve: (x: number, y: number, dragged: string) => DropTarget | null = targetAt,
) {
  return useCallback((event: ReactPointerEvent<HTMLElement>) => {
    hostPointerDown?.(event);
    if (event.button !== 0 || event.pointerType === "touch") return;
    const startX = event.clientX;
    const startY = event.clientY;
    const sidebar = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-sidebar="sidebar"]');
    let started = false;

    const move = (moved: PointerEvent) => {
      if (!started) {
        if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < THRESHOLD) return;
        started = true;
        document.body.style.setProperty("cursor", "grabbing");
      }
      const box = sidebar?.getBoundingClientRect();
      const outside = !!box && (moved.clientX > box.right || moved.clientX < box.left);
      state = { ref: tab.ref, title: tab.title, x: moved.clientX, y: moved.clientY, outside, target: outside ? null : resolve(moved.clientX, moved.clientY, tab.ref) };
      emit();
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      document.body.style.removeProperty("cursor");
      const target = state?.target ?? null;
      const wasStarted = started;
      state = null;
      emit();
      if (wasStarted) {
        // The click the browser sends right after a drag's pointerup must not
        // open the tab; drop the guard after this task so later clicks work.
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      }
      if (commit && wasStarted && target) onDrop(target);
    };
    const swallow = (click: MouseEvent) => { click.stopPropagation(); click.preventDefault(); };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (pressed: KeyboardEvent) => { if (pressed.key === "Escape") finish(false); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
  }, [tab.ref, tab.title, onDrop, hostPointerDown, resolve]);
}

/**
 * Where a dragged folder would go: before or after the folder under the
 * pointer. `index` is its position among the other folders; `folderId` is the
 * folder it lands beside. Folders are marked [data-tab-folder-row][data-folder].
 */
export function folderTargetAt(x: number, y: number, dragged: string): DropTarget | null {
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-tab-folder-row]");
  const id = row?.dataset.folder;
  if (!row || !id || `folder:${id}` === dragged) return null;
  const others = [...document.querySelectorAll<HTMLElement>("[data-tab-folder-row]")]
    .map((folder) => folder.dataset.folder!)
    .filter((folder) => `folder:${folder}` !== dragged);
  const box = row.getBoundingClientRect();
  const after = y > box.top + box.height / 2;
  return { zone: "pinned", folderId: id, index: others.indexOf(id) + (after ? 1 : 0), beside: { ref: `folder:${id}`, after }, zoneKey: "folders" };
}
