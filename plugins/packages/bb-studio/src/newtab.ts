// Studio's rows on the side panel's New Tab page (the fork's
// `slots.experimental_newTabItems`): the newest of every kind in the tab
// kinds registry (src/tab-kinds.ts) that has a server-side listing (items,
// recordings, Visual Chat boards, Bots, the Bots' conversations and
// workers), newest first, and the same for its search box. The server builds
// them (`newtab_recents`, `newtab_search`); the app adds the pages this
// window opened last and opens every row (src/ui/newtab-items.tsx). Pure, so
// both sides and tests share it.
import { z } from "zod";
import { itemKindOfId, kindsNamedBy, TAB_KIND_REGISTRY, tabKindEntry, type TabKindId, type TabRef } from "./tab-kinds";

/** Rows Studio offers to Recent and to each search. */
export const NEW_TAB_LIMIT = 8;
/** Visual Chat's plugin and the page that shows one of its boards. */
export const VISUAL_CHAT_PLUGIN_ID = "studio-visual-chat";
export const boardPath = (threadId: string) => `/plugins/${VISUAL_CHAT_PLUGIN_ID}/canvas/${encodeURIComponent(threadId)}`;

const KIND_IDS = TAB_KIND_REGISTRY.map((entry) => entry.id) as [TabKindId, ...TabKindId[]];

export const newTabEntrySchema = z.object({
  /** Unique across Studio's rows: `<kind>:<id>`. */
  id: z.string(),
  title: z.string(),
  /** The kind's name (src/tab-kinds.ts), shown after the title. */
  kind: z.string(),
  icon: z.string(),
  updatedAt: z.number(),
  /** What the row opens, as a tab beside the conversation. */
  ref: z.object({ kind: z.enum(KIND_IDS), id: z.string().nullable() }),
});
export type NewTabEntry = z.infer<typeof newTabEntrySchema>;

/** An item of the Studio tab's kinds: a page, a whiteboard, a design, an app, a dashboard, an artifact, a recording. */
export interface ItemRow { id: string; title: string; updatedAt: number; emoji?: string | null }
export interface BotThreadRow { threadId: string; kind: "conversation" | "worker"; title: string; updatedAt: number }
export interface BoardRow { threadId: string; title: string; updatedAt: number }
export interface BotRow { id: string; name: string; updatedAt: number }
export interface EntryRow { kind: "automation" | "todo" | "record"; id: string; title: string; updatedAt: number }

const UNTITLED: Partial<Record<TabKindId, string>> = { conversation: "Untitled conversation", worker: "Untitled worker", board: "Untitled board", bot: "Bot" };

/** A row for `ref`, named and drawn as the registry says. */
/** The kind shown after a row's title; empty where the title already names it ("Todos" · "Todos"). */
export const shownKind = (entry: Pick<NewTabEntry, "title" | "kind">): string =>
  entry.title.trim().toLocaleLowerCase() === entry.kind.toLocaleLowerCase() ? "" : entry.kind;

export function entryFor(ref: TabRef, title: string, updatedAt: number, icon?: string | null): NewTabEntry {
  const kind = tabKindEntry(ref.kind);
  return { id: `${ref.kind}:${ref.id ?? ""}`, title: title.trim() || UNTITLED[ref.kind] || "Untitled", kind: kind.name, icon: icon || kind.icon, updatedAt, ref };
}

export function itemEntry(item: ItemRow): NewTabEntry | null {
  const kind = itemKindOfId(item.id);
  return kind ? entryFor({ kind, id: item.id }, item.title, item.updatedAt, item.emoji) : null;
}

export function threadEntry(thread: BotThreadRow): NewTabEntry {
  return entryFor({ kind: thread.kind, id: thread.threadId }, thread.title, thread.updatedAt);
}

export function boardEntry(board: BoardRow): NewTabEntry {
  return entryFor({ kind: "board", id: board.threadId }, board.title, board.updatedAt);
}

export function botEntry(bot: BotRow): NewTabEntry {
  return entryFor({ kind: "bot", id: bot.id }, bot.name, bot.updatedAt);
}

const isOwnThread = (entry: NewTabEntry, threadId: string | null) =>
  !!threadId && (entry.ref.kind === "conversation" || entry.ref.kind === "worker") && entry.ref.id === threadId;

/** Newest first, one row per id, at most `limit`, leaving out the conversation the panel belongs to. */
export function newestEntries(entries: readonly (NewTabEntry | null)[], limit = NEW_TAB_LIMIT, exceptThreadId: string | null = null): NewTabEntry[] {
  const seen = new Set<string>();
  return entries
    .filter((entry): entry is NewTabEntry => entry !== null && !isOwnThread(entry, exceptThreadId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((entry) => !seen.has(entry.id) && !!seen.add(entry.id))
    .slice(0, limit);
}

export interface NewTabSources {
  /** Items of every Studio tab kind, newest first. */
  items(limit: number): readonly ItemRow[];
  /** Bot conversations and workers that aren't archived, newest first. */
  botThreads(limit: number): Promise<readonly BotThreadRow[]>;
  /** Visual Chat's boards; none when it isn't installed. */
  boards(): Promise<readonly BoardRow[]>;
  bots(): readonly BotRow[];
}

export async function newTabRecents(sources: NewTabSources, options: { threadId: string | null; limit?: number }): Promise<NewTabEntry[]> {
  const limit = options.limit ?? NEW_TAB_LIMIT;
  const [threads, boards] = await Promise.all([sources.botThreads(limit + 1).catch(() => []), sources.boards().catch(() => [])]);
  return newestEntries([...sources.items(limit).map(itemEntry), ...threads.map(threadEntry), ...boards.map(boardEntry), ...sources.bots().map(botEntry)], limit, options.threadId);
}

/** A search hit and how well it matched (higher first). */
export interface Scored<T> { row: T; score: number }

export interface NewTabSearchSources {
  /** Items of every Studio tab kind matching the query, from Studio's search index. */
  items(query: string, limit: number): readonly Scored<ItemRow>[];
  /** The newest items of these kinds, for a query that names a kind ("whiteboards"). */
  itemsOfKinds(kinds: readonly TabKindId[], limit: number): readonly ItemRow[];
  /** Bot conversations and workers whose title or text matches. */
  botThreads(query: string, limit: number): Promise<readonly Scored<BotThreadRow>[]>;
  boards(): Promise<readonly BoardRow[]>;
  bots(): readonly BotRow[];
  /** Automations, open todos and the memory records matching the query. */
  entries(query: string, limit: number): Promise<readonly EntryRow[]>;
}

/** How well a title matches every word of the query: 0 when a word is missing. */
export function titleScore(title: string, query: string): number {
  const words = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const text = title.toLocaleLowerCase();
  if (!words.length || !words.every((word) => text.includes(word))) return 0;
  return text.startsWith(words[0]!) ? 8 : 4;
}

/** What a query that names a kind scores its rows: below a title that starts with the query, above one that only contains it. */
const KIND_NAMED_SCORE = 5;

/** Search results: the best matches first, newer first among equals, at most `limit`. A query naming a kind lists that kind's newest too. */
export async function newTabSearch(sources: NewTabSearchSources, options: { query: string; threadId: string | null; limit?: number }): Promise<NewTabEntry[]> {
  const limit = options.limit ?? NEW_TAB_LIMIT;
  const query = options.query.trim();
  if (!query) return [];
  const named = new Set(kindsNamedBy(query));
  const [threads, boards, entries] = await Promise.all([sources.botThreads(query, limit + 1).catch(() => []), sources.boards().catch(() => []), sources.entries(query, limit).catch(() => [])]);
  const byTitle = <T>(rows: readonly T[], title: (row: T) => string, kind: TabKindId) =>
    rows.map((row) => ({ row, score: Math.max(titleScore(title(row), query), named.has(kind) ? KIND_NAMED_SCORE : 0) })).filter((each) => each.score > 0);
  const namedItems = sources.itemsOfKinds(ITEM_KIND_IDS.filter((kind) => named.has(kind)), limit);
  const scored: Scored<NewTabEntry | null>[] = [
    ...sources.items(query, limit).map(({ row, score }) => ({ row: itemEntry(row), score })),
    ...namedItems.map((row) => ({ row: itemEntry(row), score: KIND_NAMED_SCORE })),
    ...threads.map(({ row, score }) => ({ row: threadEntry(row), score })),
    ...byTitle(boards, (board) => board.title, "board").map(({ row, score }) => ({ row: boardEntry(row), score })),
    ...byTitle(sources.bots(), (bot) => bot.name, "bot").map(({ row, score }) => ({ row: botEntry(row), score })),
    ...(["automation", "todo", "record"] as const).flatMap((kind) => byTitle(entries.filter((row) => row.kind === kind), (row) => row.title, kind)).map(({ row, score }) => ({ row: entryFor({ kind: row.kind, id: row.id }, row.title, row.updatedAt), score })),
  ];
  const best = new Map<string, Scored<NewTabEntry>>();
  for (const each of scored) {
    if (!each.row || isOwnThread(each.row, options.threadId)) continue;
    const kept = best.get(each.row.id);
    if (!kept || kept.score < each.score) best.set(each.row.id, { row: each.row, score: each.score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || b.row.updatedAt - a.row.updatedAt).map((each) => each.row).slice(0, limit);
}

/** The kinds the Studio tab shows, which the items sources list. */
export const ITEM_KIND_IDS: readonly TabKindId[] = TAB_KIND_REGISTRY.filter((entry) => entry.ref === "item").map((entry) => entry.id);
