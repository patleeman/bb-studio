// The omnibar's list, with no React in it: how well a row matches what was
// typed, and the rows in the order they are shown. One model for both hosts,
// the launcher window (⌥Space) and Cmd+K in BB's main window (ui/Omnibar.tsx).
// Rows come in groups (a typed URL, Ask the Bot, conversations and files,
// apps, actions, commands, settings); the group with the best match comes
// first, and inside one, better matches come first.
import type { TabRef } from "../tab-kinds";

export type OmnibarMode = "commands" | "search";
export type EntrySection = "apps" | "actions" | "commands" | "settings";
export type LauncherSection = "url" | "ask" | "documents" | EntrySection;

export interface LauncherEntry {
  key: string;
  title: string;
  icon: string;
  section: EntrySection;
  keywords?: readonly string[];
  order?: number;
  detail?: string;
  shortcut?: string;
}

/** A conversation, a Studio item or anything else of the tab kinds registry. */
export interface LauncherDocument {
  key: string;
  title: string;
  icon: string;
  /** "Conversation", "Page"… */
  kind: string;
  path: string;
  updatedAt: number;
  /** Found by Studio's search (in its text, say), so listed even when the title doesn't match. */
  found?: boolean;
  ref?: TabRef;
}

export type LauncherRow =
  | { type: "url"; key: "url"; section: "url"; title: string; icon: string; url: string }
  | { type: "ask"; key: "ask"; section: "ask"; title: string; icon: string; text: string }
  | { type: "entry"; key: string; section: EntrySection; title: string; icon: string; entry: LauncherEntry }
  | { type: "document"; key: string; section: "documents"; title: string; icon: string; document: LauncherDocument };

export const SECTION_LABELS: Record<Exclude<LauncherSection, "url" | "ask">, string> = {
  documents: "Conversations and files", apps: "Apps", actions: "Actions", commands: "Commands", settings: "Settings",
};
export const RECENT_LABEL = "Recent";

/** Conversations and files listed at once. */
export const MAX_DOCUMENTS = 8;
export const MAX_PER_SECTION = 8;
/** A query of this many words that starts no app or action is something to ask the Bot. */
export const ASK_MIN_WORDS = 3;

export const MATCH = { none: 0, found: 0.5, keyword: 1, substring: 2, wordStart: 3, prefix: 4 } as const;

const fold = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const words = (text: string) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * How well `title` (with its `keywords`) matches `query`: the title starts
 * with it (4); every word typed starts a word of the title (3); the title
 * contains it (2); every word typed starts a keyword or sits in the title
 * (1); else 0. An empty query matches everything, evenly.
 */
export function matchScore(query: string, title: string, keywords: readonly string[] = []): number {
  const typed = fold(query).trim();
  if (!typed) return MATCH.prefix;
  const name = fold(title);
  if (name.startsWith(typed)) return MATCH.prefix;
  const tokens = words(typed);
  const nameWords = words(title);
  if (tokens.length && tokens.every((token) => nameWords.some((word) => word.startsWith(token)))) return MATCH.wordStart;
  if (name.includes(typed)) return MATCH.substring;
  const keyWords = keywords.flatMap(words);
  if (tokens.length && tokens.every((token) => keyWords.some((word) => word.startsWith(token)) || name.includes(token))) return MATCH.keyword;
  return MATCH.none;
}

/** What to ask the Bot first of all for `query`, or null when it reads as a search: fewer than three words, or the start of an app or action. */
export function askText(query: string, entries: readonly LauncherEntry[]): string | null {
  const text = query.trim().replace(/\s+/g, " ");
  if (text.split(" ").length < ASK_MIN_WORDS) return null;
  if (entries.some((entry) => (entry.section === "apps" || entry.section === "actions") && matchScore(text, entry.title) === MATCH.prefix)) return null;
  return text;
}

const URL_TLDS = new Set([
  "com", "org", "net", "io", "dev", "app", "ai", "co", "so", "me", "sh", "xyz", "gg", "tv", "edu", "gov", "uk", "de", "fr", "jp", "ca", "au", "us",
  "info", "biz", "page", "site", "tech", "cloud", "design", "link", "ly", "to", "fm", "im", "is", "it", "nl", "se", "ch", "es", "eu", "in", "br",
  "nz", "be", "at", "dk", "no", "fi", "pl", "pt", "ie", "run", "new", "blog", "news", "shop", "store", "wiki", "studio", "work", "lol", "chat",
]);

export function urlOf(query: string): string | null {
  const text = query.trim();
  if (!text || /\s/.test(text)) return null;
  if (/^bb:\/\/[^/\s]/i.test(text) || /^\/(threads|plugins)\/\S+/.test(text)) return text;
  if (/^https?:\/\//i.test(text)) {
    try { const url = new URL(text); return url.hostname ? url.href : null; } catch { return null; }
  }
  const match = /^((?:[a-z0-9-]+\.)+([a-z]{2,})|localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d{1,5})?([/?#]\S*)?$/i.exec(text);
  if (!match) return null;
  const host = match[1]!.toLowerCase();
  const local = host === "localhost" || /^\d/.test(host);
  if (!local && !URL_TLDS.has(match[2]!.toLowerCase()) && !host.startsWith("www.")) return null;
  try { return new URL(`${local ? "http" : "https"}://${text}`).href; } catch { return null; }
}

export interface LauncherInput {
  query: string;
  mode?: OmnibarMode;
  entries: readonly LauncherEntry[];
  documents: readonly LauncherDocument[];
  /** The Bot to ask, or null when there is none to send to. */
  botName: string | null;
}

const ORDER: readonly LauncherSection[] = ["url", "ask", "documents", "apps", "actions", "commands", "settings"];
const EMPTY_ORDER: Record<OmnibarMode, readonly LauncherSection[]> = {
  commands: ["apps", "actions", "documents", "commands", "settings"],
  search: ["documents"],
};
const RANK = { url: 100, sentence: 90, last: -1 } as const;

function entryRows(query: string, entries: readonly LauncherEntry[], section: EntrySection): { rows: LauncherRow[]; best: number } {
  const scored = entries.map((entry, index) => ({ entry, index, score: entry.section === section ? matchScore(query, entry.title, entry.keywords) : MATCH.none }))
    .filter((each) => each.score > MATCH.none)
    .sort((a, b) => b.score - a.score || (a.entry.order ?? Number.MAX_SAFE_INTEGER) - (b.entry.order ?? Number.MAX_SAFE_INTEGER) || a.index - b.index);
  const kept = query.trim() ? scored.slice(0, MAX_PER_SECTION) : scored;
  return { rows: kept.map(({ entry }): LauncherRow => ({ type: "entry", key: entry.key, section, title: entry.title, icon: entry.icon, entry })), best: kept[0]?.score ?? MATCH.none };
}

function documentRows(query: string, documents: readonly LauncherDocument[]): { rows: LauncherRow[]; best: number } {
  const seen = new Set<string>();
  const listed = documents
    .filter((document) => { if (seen.has(document.path)) return false; seen.add(document.path); return true; })
    .map((document) => ({ document, score: Math.max(matchScore(query, document.title), document.found ? MATCH.found : MATCH.none) }))
    .filter((each) => each.score > MATCH.none)
    .sort((a, b) => b.score - a.score || b.document.updatedAt - a.document.updatedAt)
    .slice(0, MAX_DOCUMENTS);
  return { rows: listed.map(({ document }): LauncherRow => ({ type: "document", key: document.key, section: "documents", title: document.title, icon: document.icon, document })), best: listed[0]?.score ?? MATCH.none };
}

/**
 * The rows in the order shown. With nothing typed: in "commands" mode apps,
 * actions, the recent conversations and files, commands and settings; in
 * "search" mode the recent ones alone. For a query, in either mode, each
 * group ranks by its best match: a URL first, then a sentence for the Bot,
 * then the rest; a short query's Ask row comes last.
 */
export function launcherRows({ query, mode = "commands", entries, documents, botName }: LauncherInput): LauncherRow[] {
  const typed = query.trim().replace(/\s+/g, " ");
  const groups = new Map<LauncherSection, { rows: LauncherRow[]; rank: number }>();
  for (const section of ["apps", "actions", "commands", "settings"] as const) {
    const { rows, best } = entryRows(typed, entries, section);
    if (rows.length) groups.set(section, { rows, rank: best });
  }
  const docs = documentRows(typed, documents);
  if (docs.rows.length) groups.set("documents", { rows: docs.rows, rank: docs.best });
  if (!typed) return EMPTY_ORDER[mode].flatMap((section) => groups.get(section)?.rows ?? []);
  const url = urlOf(typed);
  if (url) groups.set("url", { rows: [{ type: "url", key: "url", section: "url", title: `Open ${url.replace(/\/$/, "")}`, icon: "Globe", url }], rank: RANK.url });
  if (botName) {
    const sentence = askText(typed, entries) !== null;
    groups.set("ask", { rows: [{ type: "ask", key: "ask", section: "ask", title: `Ask ${botName}: “${typed}”`, icon: "Bot", text: typed }], rank: sentence ? RANK.sentence : RANK.last });
  }
  return [...groups.entries()]
    .sort(([a, left], [b, right]) => right.rank - left.rank || ORDER.indexOf(a) - ORDER.indexOf(b))
    .flatMap(([, group]) => group.rows);
}

/** The heading to draw above row `index`, or null: where a labelled group starts. Conversations and files are "Recent" with nothing typed. */
export function sectionLabelAt(rows: readonly LauncherRow[], index: number, typed = true): string | null {
  const row = rows[index];
  if (!row || row.section === "ask" || row.section === "url") return null;
  if (index > 0 && rows[index - 1]!.section === row.section) return null;
  return row.section === "documents" && !typed ? RECENT_LABEL : SECTION_LABELS[row.section];
}

export function sectionStarts(rows: readonly LauncherRow[]): number[] {
  return rows.flatMap((row, index) => (index === 0 || rows[index - 1]!.section !== row.section ? [index] : []));
}

export type LauncherKey =
  | { type: "move"; to: number }
  | { type: "run"; index: number; shift: boolean; alternate: boolean }
  | { type: "clear" }
  | { type: "close" }
  | null;

export interface KeyState {
  selected: number;
  count: number;
  query: string;
  starts?: readonly number[];
  escape?: boolean;
}

/**
 * What a key does: arrows move (and wrap), Tab and ⇧Tab go to the next or
 * previous group, Enter runs (with ⇧ or ⌘ noted), ⌘1…⌘9 run a row, Esc
 * clears what is typed and then closes.
 */
export function launcherKey(event: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }, { selected, count, query, starts = [], escape = true }: KeyState): LauncherKey {
  if (event.key === "Escape") return escape ? (query ? { type: "clear" } : { type: "close" }) : null;
  if (event.key === "ArrowDown") return count ? { type: "move", to: (selected + 1) % count } : null;
  if (event.key === "ArrowUp") return count ? { type: "move", to: (selected - 1 + count) % count } : null;
  if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (starts.length < 2) return null;
    const at = starts.reduce((found, start, index) => (start <= selected ? index : found), 0);
    const next = event.shiftKey ? (at - 1 + starts.length) % starts.length : (at + 1) % starts.length;
    return { type: "move", to: starts[next]! };
  }
  if (event.key === "Enter") return selected < count ? { type: "run", index: selected, shift: !!event.shiftKey, alternate: !!(event.metaKey || event.ctrlKey) } : null;
  if (event.metaKey && !event.ctrlKey && !event.altKey && /^[1-9]$/.test(event.key)) {
    const index = Number(event.key) - 1;
    return index < count ? { type: "run", index, shift: false, alternate: false } : null;
  }
  return null;
}

/** How many rows show a ⌘-number hint. */
export const QUICK_PICKS = 9;
