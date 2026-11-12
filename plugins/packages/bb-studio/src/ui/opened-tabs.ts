// What this window opened last of the kinds the server keeps no recency
// for (the registry's `recents: "opened"`: Memory, Library, Automations,
// Todos, the Archive, VS Code), for the New Tab page's Recent list and
// search. Kept in localStorage; a page opens as a tab (src/ui/tab-open.ts)
// or in the main view (OpenedTabsRecorder, from the route).
import { useEffect } from "react";
import { usePathname } from "../kit/app/route";
import { refOfPath, tabKindEntry, type TabKindId, type TabRef } from "../tab-kinds";

const KEY = "studio.openedTabs";
export const OPENED_TABS_MAX = 20;

export interface OpenedTab { kind: TabKindId; id: string | null; at: number }

/** Whether the registry lists `kind`'s recents from this record. */
export const keepsOpened = (kind: TabKindId): boolean => tabKindEntry(kind).recents === "opened";

function read(storage: Pick<Storage, "getItem"> | null): OpenedTab[] {
  try {
    const raw = storage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((each) => {
      if (typeof each !== "object" || each === null) return [];
      const { kind, id, at } = each as Record<string, unknown>;
      if (typeof kind !== "string" || typeof at !== "number" || !(id === null || typeof id === "string")) return [];
      try { return keepsOpened(kind as TabKindId) ? [{ kind: kind as TabKindId, id, at }] : []; } catch { return []; }
    });
  } catch {
    return [];
  }
}

const browserStorage = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

/** The record, newest first. */
export function openedTabs(storage: Pick<Storage, "getItem"> | null = browserStorage()): OpenedTab[] {
  return read(storage).sort((a, b) => b.at - a.at);
}

/** Notes that `ref` was opened now; ignored for kinds listed elsewhere. One entry per kind (a Bot page is one page, whichever Bot it shows). */
export function noteOpenedTab(ref: TabRef, now = Date.now(), storage: Pick<Storage, "getItem" | "setItem"> | null = browserStorage()): void {
  if (!storage || !keepsOpened(ref.kind)) return;
  const next = [{ kind: ref.kind, id: ref.id, at: now }, ...read(storage).filter((each) => each.kind !== ref.kind)].slice(0, OPENED_TABS_MAX);
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: nothing kept */ }
}

/** Notes the page the main view shows, when it is one of the kinds kept here. Draws nothing. */
export function OpenedTabsRecorder() {
  const pathname = usePathname();
  useEffect(() => {
    const ref = refOfPath(pathname);
    if (ref && keepsOpened(ref.kind)) noteOpenedTab(ref);
  }, [pathname]);
  return null;
}
