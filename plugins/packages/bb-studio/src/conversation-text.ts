// The text of a Bot's conversations, for the Conversations page's search
// (src/ui/conversations/OlderPage.tsx, bot_conversations_search).
//
// BB's thread search (threads.search, what bot_history_search uses) skips
// hidden threads, and a Bot's own chat (Main) and the threads it owns are
// hidden (src/bot-owned.ts). So Studio keeps the messages of a Bot's
// conversations itself: what the user wrote and the replies, read from each
// thread's events forward from the last seq it saw (BB pages events 100 at
// a time). A conversation is read when the page or a search asks for it,
// and again after it goes idle. Studio's pings and agent-only notes are
// left out.
//
// A search: every word (a prefix) appears in the conversation, in its
// title, its summary or its messages. The snippet is the summary when it
// has every word, else the newest message with every word, else the title;
// one line around the first match.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { isPingRequest } from "./bot-cache";

type Sdk = Pick<BbPluginApi["sdk"], "threads">;

const EVENT_PAGE = 100;
/** Pages read for one thread in one go; the rest waits for the next read. */
const PAGES_PER_READ = 200;
/** A message longer than this is kept cut. */
const TEXT_MAX = 20_000;
const SNIPPET_MAX = 160;
const SNIPPET_LEAD = 40;
const READ_PARALLEL = 2;

export type ConversationHitField = "title" | "summary" | "message";
export interface ConversationHit { threadId: string; field: ConversationHitField; snippet: string | null }

type EventRow = { seq?: number; type?: string; data?: unknown };
type Part = { type?: string; text?: string; visibility?: string };

/** The words of a query, as SQLite's unicode61 tokenizer splits them, lower case. */
export function queryWords(query: string): string[] {
  return [...new Set(query.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean))].slice(0, 8);
}

/** What a message says, for the index; null when it says nothing the user saw. */
export function messageText(event: EventRow): { kind: "user" | "assistant"; text: string } | null {
  const data = (event.data ?? {}) as { input?: Part[]; item?: { type?: string; text?: string } };
  if (event.type === "client/turn/requested") {
    if (!Array.isArray(data.input) || isPingRequest(data)) return null;
    const text = data.input.filter((part) => part.type === "text" && part.visibility !== "agent-only" && typeof part.text === "string").map((part) => part.text).join("\n").trim();
    return text ? { kind: "user", text: text.slice(0, TEXT_MAX) } : null;
  }
  if (event.type === "item/completed" && data.item?.type === "agentMessage" && typeof data.item.text === "string") {
    const text = data.item.text.trim();
    return text ? { kind: "assistant", text: text.slice(0, TEXT_MAX) } : null;
  }
  return null;
}

/** Markdown and Studio's markers out, whitespace folded: what a line reads as. */
export function plainLine(text: string): string {
  return text.replace(/::[a-z-]+\{[^}]*\}/g, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Emphasis and code marks, but an underscore inside a word ("Backups_old") stays.
    .replace(/[*`]+/g, "").replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, "")
    .replace(/^\s*(?:#{1,6}\s+|>\s*)+/gm, "").replace(/\s+/g, " ").trim();
}

const fold = (text: string) => text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/** Where a word starts a word in `text` (lower case, accents off), or -1. */
function wordAt(folded: string, word: string): number {
  let from = 0;
  for (;;) {
    const at = folded.indexOf(word, from);
    if (at < 0) return -1;
    if (at === 0 || !/[\p{L}\p{N}]/u.test(folded[at - 1]!)) return at;
    from = at + 1;
  }
}

/** Whether every word starts a word in `text`. */
export function hasWords(text: string | null | undefined, words: readonly string[]): boolean {
  if (!text) return false;
  const folded = fold(text);
  return words.every((word) => wordAt(folded, word) >= 0);
}

/** One line of `text` around its first matching word, cut to about 160 characters with "…" where it was cut. */
export function snippetOf(text: string, words: readonly string[]): string {
  const line = plainLine(text);
  if (line.length <= SNIPPET_MAX) return line;
  // NFKD keeps most Latin text the same length; past that, the start is close enough.
  const folded = fold(line);
  const hits = words.map((word) => wordAt(folded, word)).filter((at) => at >= 0);
  const first = hits.length ? Math.min(...hits) : 0;
  let start = Math.max(0, Math.min(first - SNIPPET_LEAD, line.length - SNIPPET_MAX));
  if (start > 0) { const space = line.indexOf(" ", start); if (space > 0 && space < first) start = space + 1; }
  let end = Math.min(line.length, start + SNIPPET_MAX);
  if (end < line.length) { const space = line.lastIndexOf(" ", end); if (space > first) end = space; }
  return `${start > 0 ? "…" : ""}${line.slice(start, end).trim()}${end < line.length ? "…" : ""}`;
}

/** An FTS5 query: each word a quoted prefix, joined with AND or OR. */
const ftsQuery = (words: readonly string[], join: "AND" | "OR") => words.map((word) => `"${word.replace(/"/g, "")}"*`).join(` ${join} `);

export class ConversationText {
  private readonly reading = new Map<string, Promise<number>>();
  /** Conversations with events not read yet (they went idle since). */
  private readonly stale = new Set<string>();

  constructor(private readonly deps: { db: Database.Database; sdk: Sdk; log(message: string): void; now?(): number }) {}

  private now() { return this.deps.now?.() ?? Date.now(); }

  /** A conversation has new messages: the next read takes them. */
  touched(threadId: string): void { this.stale.add(threadId); }

  /** Forgets a thread (deleted). */
  forget(threadId: string): void {
    this.deps.db.prepare("DELETE FROM conversation_text_fts WHERE thread_id = ?").run(threadId);
    this.deps.db.prepare("DELETE FROM conversation_text_state WHERE thread_id = ?").run(threadId);
    this.stale.delete(threadId);
  }

  private state(threadId: string): { seen_seq: number; done: number } | null {
    return (this.deps.db.prepare("SELECT seen_seq, done FROM conversation_text_state WHERE thread_id = ?").get(threadId) as { seen_seq: number; done: number } | undefined) ?? null;
  }

  /** Whether any of these conversations still has events to read. */
  pending(threadIds: readonly string[]): boolean {
    return threadIds.some((id) => this.stale.has(id) || !this.state(id)?.done);
  }

  /** Reads a conversation's new messages; answers how many it added. One read per thread at a time. */
  read(threadId: string): Promise<number> {
    const running = this.reading.get(threadId);
    if (running) return running;
    const next = this.readNow(threadId).finally(() => this.reading.delete(threadId));
    this.reading.set(threadId, next);
    return next;
  }

  private async readNow(threadId: string): Promise<number> {
    this.stale.delete(threadId);
    let after = this.state(threadId)?.seen_seq ?? 0;
    let added = 0;
    const insert = this.deps.db.prepare("INSERT INTO conversation_text_fts (thread_id, seq, kind, text) VALUES (?, ?, ?, ?)");
    const save = this.deps.db.prepare(`INSERT INTO conversation_text_state (thread_id, seen_seq, done, read_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET seen_seq = excluded.seen_seq, done = excluded.done, read_at = excluded.read_at`);
    for (let page = 0; page < PAGES_PER_READ; page++) {
      const rows = await this.deps.sdk.threads.events.list({ threadId, afterSeq: String(after), order: "asc", limit: String(EVENT_PAGE), types: ["client/turn/requested", "item/completed"] }) as EventRow[];
      const last = rows.reduce((max, row) => Math.max(max, row.seq ?? 0), after);
      const done = rows.length < EVENT_PAGE || last === after;
      this.deps.db.transaction(() => {
        for (const row of rows) {
          if ((row.seq ?? 0) <= after) continue;
          const message = messageText(row);
          if (message) { insert.run(threadId, row.seq ?? 0, message.kind, message.text); added++; }
        }
        save.run(threadId, last, done ? 1 : 0, this.now());
      })();
      after = last;
      if (done) return added;
    }
    // More to read: the next read goes on from here.
    this.stale.add(threadId);
    return added;
  }

  /** Reads every conversation not read yet or with new messages, two at a time. Failures are logged and left for the next read. */
  async readAll(threadIds: readonly string[]): Promise<void> {
    const queue = threadIds.filter((id) => this.stale.has(id) || !this.state(id)?.done);
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try { await this.read(id); } catch (error) { this.deps.log(`Reading conversation ${id} for search failed: ${error instanceof Error ? error.message : String(error)}`); }
      }
    };
    await Promise.all(Array.from({ length: READ_PARALLEL }, worker));
  }

  /** The newest reply read for each conversation, for a row with no latest line. */
  newestReplies(threadIds: readonly string[]): Map<string, string> {
    if (!threadIds.length) return new Map();
    const marks = threadIds.map(() => "?").join(",");
    const rows = this.deps.db.prepare(`SELECT thread_id, text FROM conversation_text_fts WHERE rowid IN (
      SELECT MAX(rowid) FROM conversation_text_fts WHERE thread_id IN (${marks}) AND kind = 'assistant' GROUP BY thread_id)`).all(...threadIds) as { thread_id: string; text: string }[];
    return new Map(rows.map((row) => [row.thread_id, row.text]));
  }

  /**
   * The conversations among `rows` that have every word of `query`, each
   * with where it matched and a one-line snippet, in `rows`' order.
   */
  search(query: string, rows: readonly { threadId: string; title: string; summary: string | null }[]): ConversationHit[] {
    const words = queryWords(query);
    if (!words.length || !rows.length) return [];
    const ids = rows.map((row) => row.threadId);
    const marks = ids.map(() => "?").join(",");
    // The conversations whose messages have each word.
    const withWord = words.map((word) => new Set((this.deps.db.prepare(`SELECT DISTINCT thread_id FROM conversation_text_fts WHERE conversation_text_fts MATCH ? AND thread_id IN (${marks})`)
      .all(ftsQuery([word], "AND"), ...ids) as { thread_id: string }[]).map((row) => row.thread_id)));
    // The newest message with every word, then with any, per conversation.
    const newest = (join: "AND" | "OR") => new Map((this.deps.db.prepare(`SELECT thread_id, text FROM conversation_text_fts WHERE rowid IN (
      SELECT MAX(rowid) FROM conversation_text_fts WHERE conversation_text_fts MATCH ? AND thread_id IN (${marks}) GROUP BY thread_id)`)
      .all(ftsQuery(words, join), ...ids) as { thread_id: string; text: string }[]).map((row) => [row.thread_id, row.text]));
    const all = newest("AND");
    const any = words.length > 1 ? newest("OR") : all;
    const hits: ConversationHit[] = [];
    for (const row of rows) {
      const folded = { title: fold(row.title), summary: fold(row.summary ?? "") };
      const has = (word: string, index: number) => wordAt(folded.title, word) >= 0 || wordAt(folded.summary, word) >= 0 || withWord[index]!.has(row.threadId);
      if (!words.every(has)) continue;
      const message = all.get(row.threadId);
      if (row.summary && hasWords(row.summary, words)) hits.push({ threadId: row.threadId, field: "summary", snippet: snippetOf(row.summary, words) });
      else if (message) hits.push({ threadId: row.threadId, field: "message", snippet: snippetOf(message, words) });
      else if (hasWords(row.title, words)) hits.push({ threadId: row.threadId, field: "title", snippet: null });
      else {
        // The words are spread over the title, the summary and the messages: the newest message with one.
        const some = any.get(row.threadId);
        const inSummary = row.summary && words.some((word) => wordAt(folded.summary, word) >= 0);
        hits.push(inSummary ? { threadId: row.threadId, field: "summary", snippet: snippetOf(row.summary!, words) }
          : some ? { threadId: row.threadId, field: "message", snippet: snippetOf(some, words) } : { threadId: row.threadId, field: "title", snippet: null });
      }
    }
    return hits;
  }
}

/** A summary without a first line that only repeats the conversation's title (finishing's memory record starts with it). */
export function summaryBody(summary: string, title: string): string {
  const [first, ...rest] = summary.trim().split("\n");
  return rest.length && plainLine(first ?? "").toLowerCase() === plainLine(title).toLowerCase() ? rest.join("\n").trim() : summary.trim();
}

/**
 * The first line or two of a conversation's summary, for its row: the
 * section heads ("**Decisions**", "**Last replies** (…)") and a first line
 * that only repeats the title left out, list marks and quotes off.
 */
export function summaryPreview(summary: string | null | undefined, title: string): string | null {
  if (!summary?.trim()) return null;
  const lines = summaryBody(summary, title).split("\n").map((line) => line.replace(/^(?:\s*>)+/, "").trim())
    .filter((line) => line.length > 0 && !/^\*\*[^*]+\*\*:?(?:\s*\([^)]*\))?$/.test(line) && !/^#{1,6}\s/.test(line))
    .map((line) => plainLine(line.replace(/^(?:[-*+]|\d+[.)])\s+/, "")))
    .filter((line) => line.length > 0);
  const text = lines.slice(0, 2).join(" ");
  return text ? (text.length > 280 ? `${text.slice(0, 279).trimEnd()}…` : text) : null;
}
