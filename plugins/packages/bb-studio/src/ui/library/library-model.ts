// The Library's rules (6f, "the Bot's files"), pure so they are tested
// directly (library-model.test.ts): search, the filter (Starred, or a kind:
// App covers saved and interactive apps, with a sub-filter), and grouping by
// conversation (default), kind or date, newest first everywhere. In a group,
// near-identical files from one source are one row with a count, and a group
// shows 8 rows, then "N more" (UX review 3, item 7).
import type { LibraryItem, LibraryKind } from "../../bot-threads-contract";

export type LibraryGroupBy = "conversation" | "kind" | "date";
export type LibraryKindFilter = "all" | "starred" | Exclude<LibraryKind, "other" | "artifact">;
export type LibraryAppType = "all" | "interactive" | "saved";

export const LIBRARY_KINDS: readonly { id: LibraryKindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "starred", label: "Starred" },
  { id: "page", label: "Page" },
  { id: "whiteboard", label: "Whiteboard" },
  { id: "design", label: "Design" },
  { id: "app", label: "App" },
  { id: "recording", label: "Recording" },
];
export const LIBRARY_APP_TYPES: readonly { id: LibraryAppType; label: string }[] = [
  { id: "all", label: "All apps" },
  { id: "interactive", label: "Interactive" },
  { id: "saved", label: "Saved" },
];
export const LIBRARY_GROUPS: readonly { id: LibraryGroupBy; label: string }[] = [
  { id: "conversation", label: "Conversation" },
  { id: "kind", label: "Kind" },
  { id: "date", label: "Date" },
];

const KIND_LABEL: Record<LibraryKind, string> = { page: "Page", whiteboard: "Whiteboard", design: "Design", app: "App", artifact: "App", recording: "Recording", other: "Other" };
export const kindLabel = (kind: LibraryKind): string => KIND_LABEL[kind];
const listedKind = (kind: LibraryKind): LibraryKind => kind === "artifact" ? "app" : kind;

/** One row of a group: a file, or several near-identical ones from one source as one row (the newest opens). */
export interface LibraryRow {
  key: string;
  /** The newest of them: what the row shows and opens. */
  item: LibraryItem;
  /** How many files the row stands for; 1 for a lone file. */
  count: number;
}

export interface LibraryGroup {
  key: string;
  title: string;
  /** The conversation a "by conversation" group opens. */
  threadId: string | null;
  items: LibraryItem[];
  /** The files as rows, near-identical ones from one source folded together. */
  rows: LibraryRow[];
}

/** A group shows this many rows, then "N more". */
export const GROUP_FOLD = 8;

/**
 * What near-identical titles share: the part before a colon when that part
 * is long enough to name something ("Real @pierre/trees explorer in BB
 * colours: pierre-trees-filter.png"), else the whole title; case, numbers,
 * file extensions and spacing aside.
 */
export function titleStem(title: string): string {
  const clean = title.trim().toLocaleLowerCase();
  const colon = clean.indexOf(":");
  const head = colon >= 12 ? clean.slice(0, colon) : clean;
  return head.replace(/\.[a-z0-9]{2,4}$/, "").replace(/\d+/g, "#").replace(/[\s…·-]+/g, " ").trim();
}

/** Files of one kind from one thread with one title stem fold into one row; a file Patrick made himself never folds. */
export function libraryRows(items: readonly LibraryItem[]): LibraryRow[] {
  const rows = new Map<string, LibraryRow>();
  for (const item of items) {
    const key = item.madeIn ? `${item.madeIn.threadId}|${item.kind}|${titleStem(item.title)}` : `${item.pluginId}:${item.id}`;
    const row = rows.get(key);
    if (row) row.count += 1;
    else rows.set(key, { key, item, count: 1 });
  }
  return [...rows.values()];
}

/** The rows a group shows: all when open, else the first GROUP_FOLD; and how many it leaves out. */
export function foldRows(rows: readonly LibraryRow[], open: boolean): { shown: LibraryRow[]; more: number } {
  if (open || rows.length <= GROUP_FOLD) return { shown: [...rows], more: 0 };
  return { shown: rows.slice(0, GROUP_FOLD), more: rows.length - GROUP_FOLD };
}

/** Where a file came from, in words: "made in Launch prep", "by Fable lead", "made by Dot", "made by you". */
export function provenance(item: Pick<LibraryItem, "madeIn" | "byBot">, botName = "Bot"): string {
  if (!item.madeIn) return item.byBot ? `made by ${botName}` : "made by you";
  return item.madeIn.kind === "worker" ? `by ${item.madeIn.title}` : `made in ${item.madeIn.title}`;
}

/** Whether a file passes the search (its title, or where it was made), the filter (Starred or a kind) and, for apps, the type. */
export function libraryPasses(item: LibraryItem, query: string, kind: LibraryKindFilter, appType: LibraryAppType = "all", botName?: string): boolean {
  if (kind === "starred" ? !item.starred : kind !== "all" && listedKind(item.kind) !== kind) return false;
  if (kind === "app" && appType !== "all" && item.kind !== (appType === "saved" ? "artifact" : "app")) return false;
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = `${item.title} ${provenance(item, botName)} ${item.madeIn?.conversationTitle ?? ""}`.toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}

const DAY = 24 * 60 * 60_000;

/** The date group of a time, from today back. */
export function dateGroup(at: number, now: number): { key: string; title: string; order: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  if (at >= today) return { key: "today", title: "Today", order: 0 };
  if (at >= today - DAY) return { key: "yesterday", title: "Yesterday", order: 1 };
  if (at >= today - 6 * DAY) return { key: "week", title: "This week", order: 2 };
  if (at >= today - 29 * DAY) return { key: "month", title: "This month", order: 3 };
  return { key: "older", title: "Older", order: 4 };
}

const KIND_ORDER: readonly LibraryKind[] = ["page", "whiteboard", "design", "app", "recording", "other"];

/** The files that pass, in groups; each group newest first, the groups by their newest file (kinds and dates in their own order). */
export function libraryGroups(items: readonly LibraryItem[], options: { query: string; kind: LibraryKindFilter; appType?: LibraryAppType; groupBy: LibraryGroupBy; botName?: string }, now: number): LibraryGroup[] {
  const shown = items.filter((item) => libraryPasses(item, options.query, options.kind, options.appType, options.botName)).sort((a, b) => b.updatedAt - a.updatedAt);
  const groups = new Map<string, LibraryGroup & { order: number }>();
  for (const item of shown) {
    let key: string;
    let title: string;
    let threadId: string | null = null;
    let order = 0;
    if (options.groupBy === "kind") {
      key = listedKind(item.kind); title = `${kindLabel(item.kind)}s`; order = KIND_ORDER.indexOf(listedKind(item.kind));
    } else if (options.groupBy === "date") {
      const group = dateGroup(item.updatedAt, now);
      key = group.key; title = group.title; order = group.order;
    } else {
      threadId = item.madeIn ? item.madeIn.conversationId ?? item.madeIn.threadId : null;
      key = threadId ?? (item.byBot ? "bot" : "you");
      title = item.madeIn ? item.madeIn.conversationTitle ?? item.madeIn.title : item.byBot ? options.botName ?? "Bot" : "Made by you";
    }
    const group = groups.get(key) ?? { key, title, threadId, items: [], rows: [], order };
    group.items.push(item);
    groups.set(key, group);
  }
  const list = [...groups.values()];
  // By conversation: the group whose newest file is newest first (the map keeps first-seen order, which is that).
  if (options.groupBy !== "conversation") list.sort((a, b) => a.order - b.order);
  return list.map(({ order: _order, ...group }) => ({ ...group, rows: libraryRows(group.items) }));
}
