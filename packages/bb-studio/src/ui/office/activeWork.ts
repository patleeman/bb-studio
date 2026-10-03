// What the sidebar's Active work section lists, and how it's arranged. A
// thread is active while it runs, waits on you, is unread, or was touched this
// week; an item, while it was touched this week. Rows can be grouped by
// folder (the default), by type, or not at all, and sorted by recent activity
// or by name. The arrangement is kept per browser.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { itemRef, type TreeFolder, type TreeItem } from "./model";

// "pending" is work queued for later (a scheduled send), not work in progress.
export const RUNNING = new Set(["active", "waiting-for-host", "host-reconnecting"]);
const BACKGROUND_ORIGINS = new Set(["bot-teams", "automations", "studio"]);

/** True for threads you started yourself, at the top level. */
export function isMyThread(thread: PluginSidebarThread): boolean {
  if (thread.isHidden || thread.isArchived) return false;
  if (thread.parentThreadId || thread.lifecycleOwnerThreadId) return false;
  return !(thread.originPluginId && BACKGROUND_ORIGINS.has(thread.originPluginId));
}

export type Row =
  | { type: "thread"; at: number; thread: PluginSidebarThread; folder: TreeFolder }
  | { type: "item"; at: number; item: TreeItem; folder: TreeFolder };

/** Kinds kept out of folders: tasks live on their boards and Home, dictations in All items. */
const HIDDEN_KINDS = new Set(["task", "dictation", "bot", "view", "space"]);

/** How long untouched work stays in the sidebar. */
export const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function threadIsLive(thread: PluginSidebarThread): boolean {
  return RUNNING.has(thread.runtimeStatus) || thread.runtimeStatus === "pending" || thread.hasPendingInteraction || thread.isUnread;
}

export function rowKey(row: Row): string {
  return row.type === "thread" ? `thread:${row.thread.id}` : `item:${itemRef(row.item)}`;
}

function rowTitle(row: Row): string {
  return row.type === "thread" ? row.thread.displayTitle : row.item.title;
}

/** A folder's active rows, newest first: live or recent threads and recent items, minus closed ones. */
export function folderRows(folder: TreeFolder, threads: readonly PluginSidebarThread[], closed: Record<string, number> = {}, now = Date.now()): Row[] {
  const rows: Row[] = [
    ...threads.filter((thread) => thread.projectId === folder.id && isMyThread(thread) && !thread.isPinned)
      .map((thread) => ({ type: "thread" as const, at: Math.max(thread.updatedAt, thread.latestAttentionAt), thread, folder })),
    ...folder.items.filter((item) => !HIDDEN_KINDS.has(item.kind) && item.title.trim() && item.title !== "Untitled").map((item) => ({ type: "item" as const, at: item.updatedAt, item, folder })),
  ];
  return rows
    .filter((row) => (row.type === "thread" && threadIsLive(row.thread)) || now - row.at < ACTIVE_WINDOW_MS)
    .filter((row) => !(closed[rowKey(row)] && closed[rowKey(row)]! >= row.at))
    .sort((a, b) => b.at - a.at);
}

export type GroupBy = "folder" | "type" | "none";
export type SortBy = "recent" | "name";
export interface ActiveView { groupBy: GroupBy; sortBy: SortBy }

export const DEFAULT_VIEW: ActiveView = { groupBy: "folder", sortBy: "recent" };

const VIEW_KEY = "bb-studio.office.active-view";
export function readView(): ActiveView {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(VIEW_KEY) ?? "{}") as Partial<ActiveView>;
    return {
      groupBy: saved.groupBy === "type" || saved.groupBy === "none" ? saved.groupBy : DEFAULT_VIEW.groupBy,
      sortBy: saved.sortBy === "name" ? "name" : DEFAULT_VIEW.sortBy,
    };
  } catch { return DEFAULT_VIEW; }
}
export function writeView(view: ActiveView): void {
  try { globalThis.localStorage?.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* private mode */ }
}

/** Type groups in this order; kinds not listed follow, by name. */
const TYPES: { kind: string; label: string }[] = [
  { kind: "thread", label: "Threads" },
  { kind: "page", label: "Pages" },
  { kind: "board", label: "Boards" },
  { kind: "table", label: "Tables" },
  { kind: "drawing", label: "Drawings" },
  { kind: "recording", label: "Recordings" },
  { kind: "artifact", label: "Artifacts" },
];

function rowKind(row: Row): string {
  return row.type === "thread" ? "thread" : row.item.kind;
}

function kindLabel(kind: string): string {
  return TYPES.find((type) => type.kind === kind)?.label ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1)}s`;
}

export interface ActiveGroup {
  /** Stable across renders; open/expanded state is keyed by it. */
  key: string;
  label: string;
  /** Set when grouped by folder, for the folder's own actions. */
  folder?: TreeFolder;
  /** Set when grouped by type, for the group's icon. */
  kind?: string;
  rows: Row[];
}

export function sortRows(rows: Row[], sortBy: SortBy): Row[] {
  return sortBy === "name"
    ? [...rows].sort((a, b) => rowTitle(a).localeCompare(rowTitle(b), undefined, { sensitivity: "base", numeric: true }))
    : [...rows].sort((a, b) => b.at - a.at);
}

/** The Active work section's groups, empty ones left out. "none" gives one group with no label. */
export function activeGroups(
  folders: readonly TreeFolder[],
  threads: readonly PluginSidebarThread[],
  closed: Record<string, number>,
  view: ActiveView,
  now = Date.now(),
): ActiveGroup[] {
  const perFolder = folders.map((folder) => ({ folder, rows: folderRows(folder, threads, closed, now) }));
  if (view.groupBy === "folder") {
    return perFolder.filter(({ rows }) => rows.length).map(({ folder, rows }) => ({ key: folder.id, label: folder.name, folder, rows: sortRows(rows, view.sortBy) }));
  }
  const all = perFolder.flatMap(({ rows }) => rows);
  if (view.groupBy === "none") return all.length ? [{ key: "all", label: "", rows: sortRows(all, view.sortBy) }] : [];
  const byKind = new Map<string, Row[]>();
  for (const row of all) byKind.set(rowKind(row), [...(byKind.get(rowKind(row)) ?? []), row]);
  const order = (kind: string) => { const index = TYPES.findIndex((type) => type.kind === kind); return index < 0 ? TYPES.length : index; };
  return [...byKind.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([kind, rows]) => ({ key: `type:${kind}`, label: kindLabel(kind), kind, rows: sortRows(rows, view.sortBy) }));
}
