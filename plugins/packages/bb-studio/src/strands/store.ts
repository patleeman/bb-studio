// Strands' rows (migration 115): `strands`, `strand_items` (one per sorted
// turn, plus the workers that joined a strand) and `strand_reads` (how far a
// conversation was read, and its daily Jev count). States are never stored:
// src/strands/states.ts works them out on each read.
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ReplyBy, ReplyTag } from "./reply";

export type StrandOrigin = "jev" | "model" | "user" | "task" | "backfill";
export type ItemKind = "user" | "reply" | "worker" | "ask" | "report";
/** Who put an item in its strand. "fallback": the previous turn's strand, with no one to ask. "pending": the same, until the small model's batch sorts it. */
export type ItemBy = "jev" | "model" | "user" | "inherit" | "fallback" | "pending";

export interface Strand {
  id: string;
  threadId: string;
  title: string;
  summary: string | null;
  named: boolean;
  nameTries: number;
  summaryAt: number | null;
  firstSeq: number;
  lastSeq: number;
  lastAt: number;
  pinned: boolean;
  mergedInto: string | null;
  origin: StrandOrigin;
  taskId: string | null;
  waitingOn: string | null;
  waitingAt: number | null;
  /** An agent said it is done (strand_note); its next activity makes it live again. */
  doneAt: number | null;
  openedAt: number | null;
  createdAt: number;
  /** The strand it branched from ("Release 1.0.13" from "Context cuts"); null for a root. */
  parentId: string | null;
  /** The conversation's whole-conversation strand (roundups, "where do we stand"): one per conversation. */
  trunk: boolean;
}

export interface StrandItem {
  threadId: string;
  seq: number;
  kind: ItemKind;
  ref: string;
  turnId: string | null;
  at: number;
  line: string | null;
  strandId: string | null;
  confidence: number | null;
  by: ItemBy;
  unsure: boolean;
  /** Other strands the message is also about (the 1:04 "both are built" message is in two). */
  also: string[];
  /** A report the reply passed over quietly: filed, but not what the user was following (see previous()). */
  quiet: boolean;
}

export interface StrandRead { threadId: string; seenSeq: number; day: string | null; jevCalls: number; modelCalls: number; namedAt: number | null; batchedAt: number | null; backfill: string | null }

type StrandRow = {
  id: string; thread_id: string; title: string; summary: string | null; named: number; name_tries: number; summary_at: number | null;
  first_seq: number; last_seq: number; last_at: number; pinned: number; merged_into: string | null; origin: string; task_id: string | null;
  waiting_on: string | null; waiting_at: number | null; done_at?: number | null; opened_at: number | null; created_at: number;
  parent_id?: string | null; kind?: string | null;
};
type ItemRow = {
  thread_id: string; seq: number; kind: string; ref: string; turn_id: string | null; at: number; line: string | null;
  strand_id: string | null; confidence: number | null; by: string; unsure: number; also_strands?: string | null; quiet?: number | null;
};

const strandOf = (row: StrandRow): Strand => ({
  id: row.id, threadId: row.thread_id, title: row.title, summary: row.summary, named: !!row.named, nameTries: row.name_tries, summaryAt: row.summary_at,
  firstSeq: row.first_seq, lastSeq: row.last_seq, lastAt: row.last_at, pinned: !!row.pinned, mergedInto: row.merged_into,
  origin: row.origin as StrandOrigin, taskId: row.task_id, waitingOn: row.waiting_on, waitingAt: row.waiting_at, doneAt: row.done_at ?? null, openedAt: row.opened_at, createdAt: row.created_at,
  parentId: row.parent_id ?? null, trunk: row.kind === TRUNK,
});
const itemOf = (row: ItemRow): StrandItem => ({
  threadId: row.thread_id, seq: row.seq, kind: row.kind as ItemKind, ref: row.ref, turnId: row.turn_id, at: row.at, line: row.line,
  strandId: row.strand_id, confidence: row.confidence, by: row.by as ItemBy, unsure: !!row.unsure, also: alsoOf(row.also_strands), quiet: row.quiet === 1,
});

function alsoOf(value: string | null | undefined): string[] {
  if (!value) return [];
  try { const list = JSON.parse(value) as unknown; return Array.isArray(list) ? list.filter((each): each is string => typeof each === "string") : []; } catch { return []; }
}

/** A reply: its item, its tag (null while untagged), ask sentence, who tagged it (null: not yet), and whether the user is past it. */
export interface ReplyRow { seq: number; turnId: string | null; at: number; strandId: string | null; tag: ReplyTag | null; ask: string | null; by: ReplyBy | null; resolved: boolean; /** The reply's first sentence (a folded run of status replies says it). */ line: string | null }
type ReplyDbRow = { seq: number; turn_id: string | null; at: number; strand_id: string | null; reply_tag: string | null; reply_ask: string | null; reply_by: string | null; resolved: number; line: string | null };

/** A reply's columns and whether it's resolved: answered (Jev), marked done, or open when its strand was marked done (a stored fact: reopening the strand doesn't bring it back). */
const REPLY_COLUMNS = `r.seq, r.turn_id, r.at, r.strand_id, r.reply_tag, r.reply_ask, r.reply_by, r.line,
  (r.reply_resolved_at IS NOT NULL) AS resolved`;
const replyOf = (row: ReplyDbRow): ReplyRow => ({
  seq: row.seq, turnId: row.turn_id, at: row.at, strandId: row.strand_id,
  tag: row.reply_tag === "needs-you" || row.reply_tag === "status" ? row.reply_tag : null,
  ask: row.reply_ask, by: row.reply_by === "jev" || row.reply_by === "none" ? row.reply_by : null, resolved: !!row.resolved, line: row.line,
});

/** The last user line kept with an item, for the prompt's "last user line". */
export const LINE_MAX = 300;

/** Not a message whose reply passed over it quietly (strand_items.quiet): filed, but not what the user was following. Rows from before the flag count as read. */
const NOT_QUIET = "(i.quiet IS NULL OR i.quiet = 0)";

type MergeMark = { from: string; value: unknown };
const marksOf = (value: string | null | undefined): MergeMark[] => {
  try { const list = value ? JSON.parse(value) as unknown : []; return Array.isArray(list) ? list.filter((each): each is MergeMark => !!each && typeof each === "object" && typeof (each as MergeMark).from === "string") : []; } catch { return []; }
};

/** strands.kind of the whole-conversation strand. */
export const TRUNK = "trunk";
export const TRUNK_TITLE = "Whole conversation";

/** The strand_reads row that counts today's calls across every conversation. */
export const ALL_CONVERSATIONS = "strands:all-conversations";

export class StrandStore {
  constructor(readonly db: Database.Database, private readonly now: () => number = Date.now) {}

  static ready(db: Database.Database): boolean {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'strand_items'").get();
  }

  // ---- strands ----

  get(id: string): Strand | null {
    const row = this.db.prepare("SELECT * FROM strands WHERE id = ?").get(id) as StrandRow | undefined;
    return row ? strandOf(row) : null;
  }

  /** A conversation's strands that weren't merged into another, newest activity first. */
  list(threadId: string): Strand[] {
    return (this.db.prepare("SELECT * FROM strands WHERE thread_id = ? AND merged_into IS NULL ORDER BY last_at DESC, rowid DESC").all(threadId) as StrandRow[]).map(strandOf);
  }

  /** The newest `limit` strands of a conversation (not merged; not the whole-conversation strand, which a prompt offers on its own), for a prompt. */
  recent(threadId: string, limit: number): Strand[] {
    return (this.db.prepare("SELECT * FROM strands WHERE thread_id = ? AND merged_into IS NULL AND kind IS NOT 'trunk' ORDER BY last_at DESC, rowid DESC LIMIT ?").all(threadId, limit) as StrandRow[]).map(strandOf);
  }

  /** The conversation's whole-conversation strand, made on first use. */
  trunk(threadId: string, at: number): Strand {
    const row = this.db.prepare("SELECT * FROM strands WHERE thread_id = ? AND kind = 'trunk' AND merged_into IS NULL LIMIT 1").get(threadId) as StrandRow | undefined;
    if (row) return strandOf(row);
    const strand = this.create({ threadId, title: TRUNK_TITLE, named: true, origin: "jev", seq: null, at });
    this.db.prepare("UPDATE strands SET kind = 'trunk' WHERE id = ?").run(strand.id);
    return this.get(strand.id)!;
  }

  /** The conversation's whole-conversation strand, if it has one. */
  trunkOf(threadId: string): Strand | null {
    const row = this.db.prepare("SELECT * FROM strands WHERE thread_id = ? AND kind = 'trunk' AND merged_into IS NULL LIMIT 1").get(threadId) as StrandRow | undefined;
    return row ? strandOf(row) : null;
  }

  /** Records the strand a strand branched from (never itself, never a loop). */
  setParent(id: string, parentId: string | null): boolean {
    for (let at = parentId, steps = 0; at && steps < 50; steps++) { if (at === id) return false; at = this.get(at)?.parentId ?? null; }
    this.db.prepare("UPDATE strands SET parent_id = ? WHERE id = ?").run(parentId, id);
    return true;
  }

  /** Remembers, for unmerge, what merging `from` changed in a row's column (its value before). */
  private markMerge(table: "strands" | "strand_items", column: "merge_parent" | "merge_also", rowid: number, from: string, value: unknown): void {
    const row = this.db.prepare(`SELECT ${column} AS marks FROM ${table} WHERE rowid = ?`).get(rowid) as { marks: string | null } | undefined;
    this.db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`).run(JSON.stringify([...marksOf(row?.marks), { from, value }]), rowid);
  }

  /** Takes back what merging `from` changed: returns each row's earlier value, and forgets the mark. */
  private takeMarks(table: "strands" | "strand_items", column: "merge_parent" | "merge_also", threadId: string, from: string): { rowid: number; value: unknown }[] {
    const rows = this.db.prepare(`SELECT rowid AS rowid, ${column} AS marks FROM ${table} WHERE thread_id = ? AND ${column} LIKE ?`).all(threadId, `%${from}%`) as { rowid: number; marks: string }[];
    const out: { rowid: number; value: unknown }[] = [];
    for (const row of rows) {
      const marks = marksOf(row.marks);
      const mine = marks.filter((mark) => mark.from === from);
      if (!mine.length) continue;
      out.push({ rowid: row.rowid, value: mine[0]!.value });
      const rest = marks.filter((mark) => mark.from !== from);
      this.db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`).run(rest.length ? JSON.stringify(rest) : null, row.rowid);
    }
    return out;
  }

  /** Marks a report the reply passed over quietly: filed, but not what the user was following. */
  markQuiet(threadId: string, kind: ItemKind, seq: number): void {
    this.db.prepare("UPDATE strand_items SET quiet = 1 WHERE thread_id = ? AND kind = ? AND seq = ? AND ref = ''").run(threadId, kind, seq);
  }

  /** Strands still waiting for the small model's name, oldest first. */
  unnamed(threadId: string, maxTries: number): Strand[] {
    return (this.db.prepare("SELECT * FROM strands WHERE thread_id = ? AND merged_into IS NULL AND named = 0 AND name_tries < ? ORDER BY created_at, rowid").all(threadId, maxTries) as StrandRow[]).map(strandOf);
  }

  byTask(taskId: string): Strand | null {
    const row = this.db.prepare("SELECT * FROM strands WHERE task_id = ? AND merged_into IS NULL LIMIT 1").get(taskId) as StrandRow | undefined;
    return row ? strandOf(row) : null;
  }

  titles(threadId: string, except: string | null = null): string[] {
    return (this.db.prepare("SELECT title FROM strands WHERE thread_id = ? AND merged_into IS NULL AND named = 1 AND id IS NOT ?").all(threadId, except) as { title: string }[]).map((row) => row.title);
  }

  /** A new strand. With `seq` null it has no message yet: its span starts empty and grows with its first one. */
  create(input: { threadId: string; title: string; summary?: string | null; named?: boolean; origin: StrandOrigin; seq: number | null; at: number; taskId?: string | null; parentId?: string | null }): Strand {
    const id = `str_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const at = this.now();
    this.db.prepare(`INSERT INTO strands (id, thread_id, title, summary, named, summary_at, first_seq, last_seq, last_at, origin, task_id, created_at, parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.threadId, input.title, input.summary ?? null, input.named ? 1 : 0, input.summary ? at : null, input.seq ?? Number.MAX_SAFE_INTEGER, input.seq ?? 0, input.at, input.origin, input.taskId ?? null, at, input.parentId ?? null);
    return this.get(id)!;
  }

  named(id: string, title: string, summary: string | null): void {
    this.db.prepare("UPDATE strands SET title = ?, summary = COALESCE(?, summary), summary_at = CASE WHEN ? IS NULL THEN summary_at ELSE ? END, named = 1 WHERE id = ? AND named = 0")
      .run(title, summary, summary, this.now(), id);
  }

  triedName(id: string): void {
    this.db.prepare("UPDATE strands SET name_tries = name_tries + 1 WHERE id = ?").run(id);
  }

  summarized(id: string, summary: string): void {
    this.db.prepare("UPDATE strands SET summary = ?, summary_at = ? WHERE id = ?").run(summary, this.now(), id);
  }

  /** A summary refresh was tried (with or without a new summary): the next is a day away. */
  summaryTried(id: string): void {
    this.db.prepare("UPDATE strands SET summary_at = ? WHERE id = ?").run(this.now(), id);
  }

  opened(id: string): void {
    this.db.prepare("UPDATE strands SET opened_at = ? WHERE id = ?").run(this.now(), id);
  }

  /** Folds `from` into `into`: its items move, its span joins. Your choice always wins: the model never folds a strand you made; you can fold any. */
  merge(from: string, into: string, byUser = false): boolean {
    if (from === into) return false;
    const a = this.get(from);
    const b = this.get(into);
    if (!a || !b || a.threadId !== b.threadId || a.mergedInto || b.mergedInto || (a.origin === "user" && !byUser) || a.trunk !== b.trunk) return false;
    this.db.transaction(() => {
      // Each item remembers where it was, so the merge can be undone.
      this.db.prepare("UPDATE strand_items SET prev_strand_id = strand_id, strand_id = ? WHERE thread_id = ? AND strand_id = ?").run(into, a.threadId, from);
      this.db.prepare("UPDATE strands SET merged_into = ? WHERE id = ?").run(into, from);
      // The messages also about `from` are also about `into` now: never the strand they are in, never twice.
      const also = this.db.prepare("SELECT rowid AS row, strand_id, also_strands FROM strand_items WHERE thread_id = ? AND also_strands LIKE ?").all(a.threadId, `%${from}%`) as { row: number; strand_id: string | null; also_strands: string }[];
      const write = this.db.prepare("UPDATE strand_items SET also_strands = ? WHERE rowid = ?");
      for (const item of also) {
        if (!alsoOf(item.also_strands).includes(from)) continue;
        const next = [...new Set(alsoOf(item.also_strands).map((id) => (id === from ? into : id)))].filter((id) => id !== item.strand_id);
        this.markMerge("strand_items", "merge_also", item.row, from, item.also_strands);
        write.run(next.length ? JSON.stringify(next) : null, item.row);
      }
      // Its branches now grow from the strand it joined (or, where that would loop, from its own parent); the joined strand keeps its own parent, or takes this one's.
      const children = this.db.prepare("SELECT rowid AS row, id FROM strands WHERE thread_id = ? AND parent_id = ? AND merged_into IS NULL AND id != ?").all(a.threadId, from, into) as { row: number; id: string }[];
      for (const child of children) {
        this.markMerge("strands", "merge_parent", child.row, from, from);
        if (!this.setParent(child.id, into)) this.setParent(child.id, a.parentId && a.parentId !== child.id ? a.parentId : null);
      }
      // Merged into its own branch: the branch now grows from where the merged strand did.
      if (b.parentId === from) {
        const row = this.db.prepare("SELECT rowid AS row FROM strands WHERE id = ?").get(into) as { row: number };
        this.markMerge("strands", "merge_parent", row.row, from, from);
        if (!this.setParent(into, a.parentId)) this.setParent(into, null);
      } else if (!b.parentId && a.parentId && a.parentId !== into) {
        const row = this.db.prepare("SELECT rowid AS row FROM strands WHERE id = ?").get(into) as { row: number };
        this.markMerge("strands", "merge_parent", row.row, from, null);
        this.setParent(into, a.parentId);
      }
      this.db.prepare(`UPDATE strands SET first_seq = MIN(first_seq, ?), last_seq = MAX(last_seq, ?), last_at = MAX(last_at, ?),
        task_id = COALESCE(task_id, ?), pinned = MAX(pinned, ?) WHERE id = ?`).run(a.firstSeq, a.lastSeq, a.lastAt, a.taskId, a.pinned ? 1 : 0, into);
    })();
    return true;
  }

  rename(id: string, title: string): void {
    this.db.prepare("UPDATE strands SET title = ?, named = 1 WHERE id = ?").run(title, id);
  }

  /** An agent's note (strand_note): who or what it waits on (null clears it), and done (null clears it). */
  note(id: string, note: { waitingOn?: string | null; done?: boolean }, at: number): void {
    if (note.waitingOn !== undefined) this.db.prepare("UPDATE strands SET waiting_on = ?, waiting_at = ? WHERE id = ?").run(note.waitingOn, note.waitingOn === null ? null : at, id);
    if (note.done !== undefined) this.db.prepare("UPDATE strands SET done_at = ? WHERE id = ?").run(note.done ? at : null, id);
    // Marked done: the asks open in it now are settled, once. An ask its turn makes after this still counts.
    if (note.done) this.db.prepare("UPDATE strand_items SET reply_resolved_at = ? WHERE strand_id = ? AND kind = 'reply' AND reply_tag = 'needs-you' AND reply_resolved_at IS NULL").run(at, id);
  }

  setPinned(id: string, pinned: boolean): void {
    this.db.prepare("UPDATE strands SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, id);
  }

  /** A strand's span again from its messages (after some moved out). With none left, it keeps its last activity and starts empty. */
  recompute(id: string): void {
    const strand = this.get(id);
    if (!strand) return;
    const span = this.db.prepare("SELECT MIN(seq) AS first, MAX(seq) AS last, MAX(at) AS at FROM strand_items WHERE thread_id = ? AND strand_id = ? AND kind IN ('user', 'report')").get(strand.threadId, id) as { first: number | null; last: number | null; at: number | null };
    this.db.prepare("UPDATE strands SET first_seq = ?, last_seq = ?, last_at = ? WHERE id = ?")
      .run(span.first ?? Number.MAX_SAFE_INTEGER, span.last ?? 0, span.at ?? strand.lastAt, id);
  }

  /**
   * The user moves a turn (its message, reply and the workers it started) to
   * another strand; with `andLater`, the turns after it in the same strand
   * go too ("New strand from here"). Answers the strands it moved out of.
   */
  moveTurn(threadId: string, seq: number, to: string, andLater = false): string[] {
    const head = this.db.prepare("SELECT * FROM strand_items WHERE thread_id = ? AND seq = ? AND kind IN ('user', 'report') LIMIT 1").get(threadId, seq) as ItemRow | undefined;
    if (!head) return [];
    const from = head.strand_id;
    const turnIds = [head.turn_id];
    const seqs = [seq];
    if (andLater && from) {
      const later = this.db.prepare("SELECT seq, turn_id FROM strand_items WHERE thread_id = ? AND strand_id = ? AND seq > ? AND kind IN ('user', 'report')").all(threadId, from, seq) as { seq: number; turn_id: string | null }[];
      for (const row of later) { seqs.push(row.seq); turnIds.push(row.turn_id); }
    }
    const move = this.db.prepare("UPDATE strand_items SET prev_strand_id = strand_id, strand_id = ?, by = 'user', unsure = 0, confidence = NULL, also_strands = NULL WHERE thread_id = ? AND ((seq = ? AND kind IN ('user', 'report', 'worker')) OR (? IS NOT NULL AND turn_id = ?))");
    this.db.transaction(() => {
      seqs.forEach((each, index) => move.run(to, threadId, each, turnIds[index] ?? null, turnIds[index] ?? null));
    })();
    this.recompute(to);
    if (from && from !== to) this.recompute(from);
    return from && from !== to ? [from] : [];
  }

  /** Undoes a merge: the items that came from `from` go back, and it shows again. */
  unmerge(from: string): boolean {
    const strand = this.get(from);
    if (!strand?.mergedInto) return false;
    const into = strand.mergedInto;
    this.db.transaction(() => {
      this.db.prepare("UPDATE strand_items SET strand_id = ?, prev_strand_id = NULL WHERE thread_id = ? AND strand_id = ? AND prev_strand_id = ?").run(from, strand.threadId, into, from);
      this.db.prepare("UPDATE strands SET merged_into = NULL WHERE id = ?").run(from);
      // What the merge changed in also lists and parents goes back.
      for (const mark of this.takeMarks("strand_items", "merge_also", strand.threadId, from)) this.db.prepare("UPDATE strand_items SET also_strands = ? WHERE rowid = ?").run(typeof mark.value === "string" ? mark.value : null, mark.rowid);
      for (const mark of this.takeMarks("strands", "merge_parent", strand.threadId, from)) this.db.prepare("UPDATE strands SET parent_id = ? WHERE rowid = ?").run(typeof mark.value === "string" ? mark.value : null, mark.rowid);
    })();
    this.recompute(from);
    this.recompute(into);
    return true;
  }

  /** Undoes the last move of a turn: its items go back to the strand they were in. Answers that strand, or null. */
  unmoveTurn(threadId: string, seq: number): string | null {
    const head = this.db.prepare("SELECT * FROM strand_items WHERE thread_id = ? AND seq = ? AND kind IN ('user', 'report') LIMIT 1").get(threadId, seq) as (ItemRow & { prev_strand_id: string | null }) | undefined;
    const back = head?.prev_strand_id ?? null;
    const target = back ? this.get(back) : null;
    if (!head || !back || !target || target.mergedInto) return null;
    this.db.prepare("UPDATE strand_items SET strand_id = prev_strand_id, prev_strand_id = NULL WHERE thread_id = ? AND prev_strand_id IS NOT NULL AND ((seq = ? AND kind IN ('user', 'report', 'worker')) OR (? IS NOT NULL AND turn_id = ?))")
      .run(threadId, seq, head.turn_id, head.turn_id);
    this.recompute(back);
    if (head.strand_id && head.strand_id !== back) this.recompute(head.strand_id);
    return back;
  }

  /** A turn joined a strand: its span grows. A waiting note clears on the next activity. */
  private touched(id: string, seq: number, at: number): void {
    this.db.prepare(`UPDATE strands SET first_seq = MIN(first_seq, ?), last_seq = MAX(last_seq, ?), last_at = MAX(last_at, ?),
      waiting_on = CASE WHEN waiting_at IS NOT NULL AND ? > waiting_at THEN NULL ELSE waiting_on END WHERE id = ?`).run(seq, seq, at, at, id);
  }

  // ---- items ----

  item(threadId: string, kind: ItemKind, seq: number, ref = ""): StrandItem | null {
    const row = this.db.prepare("SELECT * FROM strand_items WHERE thread_id = ? AND kind = ? AND seq = ? AND ref = ?").get(threadId, kind, seq, ref) as ItemRow | undefined;
    return row ? itemOf(row) : null;
  }

  /** Puts an item in a strand (or in none), replacing what it had. */
  put(item: Omit<StrandItem, "unsure" | "ref" | "also" | "quiet"> & { ref?: string; unsure?: boolean; also?: readonly string[]; quiet?: boolean }): void {
    const also = (item.also ?? []).filter((id) => id !== item.strandId);
    this.db.prepare(`INSERT INTO strand_items (thread_id, seq, kind, ref, turn_id, at, line, strand_id, confidence, by, unsure, also_strands, quiet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, kind, seq, ref) DO UPDATE SET turn_id = COALESCE(excluded.turn_id, turn_id), at = excluded.at, line = COALESCE(excluded.line, line),
        strand_id = excluded.strand_id, confidence = excluded.confidence, by = excluded.by, unsure = excluded.unsure, also_strands = excluded.also_strands, quiet = excluded.quiet`)
      .run(item.threadId, item.seq, item.kind, item.ref ?? "", item.turnId, item.at, item.line?.slice(0, LINE_MAX) ?? null, item.strandId, item.confidence, item.by, item.unsure ? 1 : 0, also.length ? JSON.stringify([...new Set(also)]) : null, item.quiet ? 1 : null);
    if (item.strandId) this.touched(item.strandId, item.seq, item.at);
    // A strand the message is also about counts it as activity too.
    for (const id of new Set(also)) this.touched(id, item.seq, item.at);
  }

  /** A turn's reply item, by the turn's id: its line is the reply's end (context for the next sort). */
  replyItem(threadId: string, turnId: string): StrandItem | null {
    const row = this.db.prepare("SELECT * FROM strand_items WHERE thread_id = ? AND kind = 'reply' AND turn_id = ? ORDER BY seq DESC LIMIT 1").get(threadId, turnId) as ItemRow | undefined;
    return row ? itemOf(row) : null;
  }

  /** The newest sorted message before `seq` (user or report) whose reply the user read (it has a reply line): what a short answer answers. */
  before(threadId: string, seq: number): StrandItem | null {
    const row = this.db.prepare(`SELECT i.* FROM strand_items i WHERE i.thread_id = ? AND i.seq < ? AND i.kind IN ('user', 'report') AND ${NOT_QUIET}
      ORDER BY i.seq DESC LIMIT 1`).get(threadId, seq) as ItemRow | undefined;
    return row ? itemOf(row) : null;
  }

  /** The strand of the turn that was going on at `at`: the newest sorted message at or before it. */
  strandAt(threadId: string, at: number): { strandId: string | null; seq: number } | null {
    const row = this.db.prepare("SELECT strand_id, seq FROM strand_items WHERE thread_id = ? AND at <= ? AND kind IN ('user', 'report') ORDER BY at DESC, seq DESC LIMIT 1").get(threadId, at) as { strand_id: string | null; seq: number } | undefined;
    return row ? { strandId: row.strand_id, seq: row.seq } : null;
  }

  /**
   * The strand of the newest sorted message before `seq` that had one. Only
   * turns whose reply the user read count: a report the reply passed over
   * quietly is filed too, but it isn't what the user was following.
   */
  previous(threadId: string, seq: number): string | null {
    const row = this.db.prepare(`SELECT i.strand_id FROM strand_items i WHERE i.thread_id = ? AND i.seq < ? AND i.kind IN ('user', 'report') AND i.strand_id IS NOT NULL AND ${NOT_QUIET}
      ORDER BY i.seq DESC LIMIT 1`).get(threadId, seq) as { strand_id: string } | undefined;
    return row?.strand_id ?? null;
  }

  /** The strand a turn id was sorted into, for a message's tag. */
  byTurn(threadId: string, turnId: string): StrandItem | null {
    const row = this.db.prepare("SELECT * FROM strand_items WHERE thread_id = ? AND turn_id = ? AND kind IN ('user', 'report') ORDER BY seq LIMIT 1").get(threadId, turnId) as ItemRow | undefined;
    return row ? itemOf(row) : null;
  }

  /** The newest `limit` sorted messages, newest first. */
  items(threadId: string, limit: number, kinds: readonly ItemKind[] = ["user", "report"]): StrandItem[] {
    const marks = kinds.map(() => "?").join(",");
    return (this.db.prepare(`SELECT * FROM strand_items WHERE thread_id = ? AND kind IN (${marks}) ORDER BY seq DESC LIMIT ?`).all(threadId, ...kinds, limit) as ItemRow[]).map(itemOf);
  }

  /** Items still waiting for the small model's batch, oldest first. */
  pending(threadId: string, limit: number): StrandItem[] {
    return (this.db.prepare("SELECT * FROM strand_items WHERE thread_id = ? AND by = 'pending' ORDER BY seq LIMIT ?").all(threadId, limit) as ItemRow[]).map(itemOf);
  }

  /** A strand's newest message from the user (or report): what it opens at, and its last user line. */
  latest(strandId: string, threadId: string): StrandItem | null {
    const row = this.db.prepare("SELECT * FROM strand_items WHERE thread_id = ? AND strand_id = ? AND kind IN ('user', 'report') ORDER BY seq DESC LIMIT 1").get(threadId, strandId) as ItemRow | undefined;
    return row ? itemOf(row) : null;
  }

  /** A strand's first messages, for its name. */
  first(strandId: string, threadId: string, limit: number): StrandItem[] {
    return (this.db.prepare("SELECT * FROM strand_items WHERE thread_id = ? AND strand_id = ? AND kind IN ('user', 'report') ORDER BY seq LIMIT ?").all(threadId, strandId, limit) as ItemRow[]).map(itemOf);
  }

  /** A strand's newest messages, oldest of them first. */
  newest(strandId: string, threadId: string, limit: number): StrandItem[] {
    return (this.db.prepare("SELECT * FROM strand_items WHERE thread_id = ? AND strand_id = ? AND kind IN ('user', 'report') ORDER BY seq DESC LIMIT ?").all(threadId, strandId, limit) as ItemRow[]).map(itemOf).reverse();
  }

  /** How many messages each strand has, and how many of those were an unsure sort. */
  counts(threadId: string): Map<string, { messages: number; unsure: number }> {
    const rows = this.db.prepare("SELECT strand_id, COUNT(*) AS n, SUM(unsure) AS u FROM strand_items WHERE thread_id = ? AND kind IN ('user', 'report') AND strand_id IS NOT NULL GROUP BY strand_id").all(threadId) as { strand_id: string; n: number; u: number }[];
    return new Map(rows.map((row) => [row.strand_id, { messages: row.n, unsure: row.u ?? 0 }]));
  }

  // ---- replies that need the user (src/strands/reply.ts) ----

  /** Tags a turn's reply item (it must exist): needs-you or status with its ask sentence; null: Jev couldn't, it stays untagged ("none"). */
  tagReply(threadId: string, seq: number, verdict: { tag: ReplyTag; ask: string | null } | null, line: string | null = null): void {
    this.db.prepare("UPDATE strand_items SET reply_tag = ?, reply_ask = ?, reply_by = ?, line = COALESCE(?, line) WHERE thread_id = ? AND kind = 'reply' AND seq = ? AND ref = ''")
      .run(verdict?.tag ?? null, verdict?.ask?.slice(0, LINE_MAX) ?? null, verdict ? "jev" : "none", line?.slice(0, LINE_MAX) ?? null, threadId, seq);
  }

  /** Keeps a reply's quick replies (the buttons it offered), so a message that is one of them is known to answer it. */
  setQuickReplies(threadId: string, seq: number, quick: readonly string[]): void {
    if (!quick.length) return;
    this.db.prepare("UPDATE strand_items SET reply_quick = ? WHERE thread_id = ? AND kind = 'reply' AND seq = ? AND ref = ''").run(JSON.stringify(quick.slice(0, 8)), threadId, seq);
  }

  /** The buttons the user could press before `seq`: the newest reply they read (not a quiet one), if it offered quick replies. */
  lastQuickReplies(threadId: string, seq: number): { seq: number; turnId: string | null; strandId: string | null; quick: string[] } | null {
    const row = this.db.prepare(`SELECT seq, turn_id, strand_id, reply_quick FROM strand_items r WHERE r.thread_id = ? AND r.kind = 'reply' AND r.seq < ?
      AND NOT EXISTS (SELECT 1 FROM strand_items h WHERE h.thread_id = r.thread_id AND h.turn_id = r.turn_id AND h.kind IN ('user', 'report') AND h.quiet = 1)
      ORDER BY r.seq DESC LIMIT 1`).get(threadId, seq) as { seq: number; turn_id: string | null; strand_id: string | null; reply_quick: string | null } | undefined;
    if (!row?.reply_quick) return null;
    return { seq: row.seq, turnId: row.turn_id, strandId: row.strand_id, quick: alsoOf(row.reply_quick) };
  }

  /** A reply once tagged (or marked untagged), else null. */
  reply(threadId: string, seq: number): ReplyRow | null {
    const row = this.db.prepare(`SELECT ${REPLY_COLUMNS} FROM strand_items r WHERE r.thread_id = ? AND r.kind = 'reply' AND r.seq = ? AND r.ref = '' AND r.reply_by IS NOT NULL`).get(threadId, seq) as ReplyDbRow | undefined;
    return row ? replyOf(row) : null;
  }

  /**
   * The sorted turn that request `seq` started or joined: the newest
   * message at or before it whose reply (once there) came after it; null
   * while that turn isn't sorted, or the newest is an earlier, finished turn.
   */
  turnOfRequest(threadId: string, seq: number): StrandItem | null {
    const row = this.db.prepare("SELECT * FROM strand_items WHERE thread_id = ? AND kind IN ('user', 'report') AND seq <= ? ORDER BY seq DESC LIMIT 1").get(threadId, seq) as ItemRow | undefined;
    if (!row) return null;
    if (row.seq === seq) return itemOf(row);
    // A turn whose first request was a keepalive or a queued message: it covers `seq` only if its reply came after it.
    const reply = row.turn_id ? this.db.prepare("SELECT seq FROM strand_items WHERE thread_id = ? AND kind = 'reply' AND turn_id = ? ORDER BY seq DESC LIMIT 1").get(threadId, row.turn_id) as { seq: number } | undefined : undefined;
    return reply && reply.seq > seq ? itemOf(row) : null;
  }

  /** The reply of a turn (by its id), tagged or not yet; null when the turn has no reply item. */
  replyOfTurn(threadId: string, turnId: string): ReplyRow | null {
    const row = this.db.prepare(`SELECT ${REPLY_COLUMNS} FROM strand_items r WHERE r.thread_id = ? AND r.kind = 'reply' AND r.turn_id = ? ORDER BY r.seq DESC LIMIT 1`).get(threadId, turnId) as ReplyDbRow | undefined;
    return row ? replyOf(row) : null;
  }

  /**
   * Its tagged replies (the newest 2,000), oldest first, each with whether it
   * is resolved: Jev said a later message answers it, the user marked it
   * done, its strand was marked done after it, or it is older than `since`.
   */
  replies(threadId: string, since: number): ReplyRow[] {
    return (this.db.prepare(`SELECT ${REPLY_COLUMNS} FROM strand_items r WHERE r.thread_id = ? AND r.kind = 'reply' AND r.reply_tag IS NOT NULL ORDER BY r.seq DESC LIMIT 2000`).all(threadId) as ReplyDbRow[])
      .map(replyOf).map((reply) => (reply.at < since && !reply.resolved ? { ...reply, resolved: true } : reply)).reverse();
  }

  /** The needs-you replies still waiting on the user (see replies), oldest first. */
  openReplies(threadId: string, since: number): ReplyRow[] {
    return (this.db.prepare(`SELECT ${REPLY_COLUMNS} FROM strand_items r WHERE r.thread_id = ? AND r.kind = 'reply' AND r.reply_tag = 'needs-you' AND r.at >= ? ORDER BY r.seq`).all(threadId, since) as ReplyDbRow[])
      .map(replyOf).filter((reply) => !reply.resolved);
  }

  /** The user answered a reply (Jev said so) or marked it done. False when it isn't a tagged reply. */
  resolveReply(threadId: string, seq: number): boolean {
    return this.db.prepare("UPDATE strand_items SET reply_resolved_at = COALESCE(reply_resolved_at, ?) WHERE thread_id = ? AND kind = 'reply' AND seq = ? AND ref = '' AND reply_tag IS NOT NULL").run(this.now(), threadId, seq).changes > 0;
  }

  // ---- reads ----

  read(threadId: string): StrandRead | null {
    const row = this.db.prepare("SELECT * FROM strand_reads WHERE thread_id = ?").get(threadId) as { thread_id: string; seen_seq: number; day: string | null; jev_calls: number; model_calls: number; named_at: number | null; batched_at: number | null; backfill: string | null } | undefined;
    return row ? { threadId: row.thread_id, seenSeq: row.seen_seq, day: row.day, jevCalls: row.jev_calls, modelCalls: row.model_calls, namedAt: row.named_at, batchedAt: row.batched_at, backfill: row.backfill } : null;
  }

  saveRead(threadId: string, changes: Partial<Omit<StrandRead, "threadId">>): void {
    const before = this.read(threadId) ?? { threadId, seenSeq: 0, day: null, jevCalls: 0, modelCalls: 0, namedAt: null, batchedAt: null, backfill: null };
    const next = { ...before, ...changes };
    this.db.prepare(`INSERT INTO strand_reads (thread_id, seen_seq, day, jev_calls, model_calls, named_at, batched_at, backfill, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET seen_seq = excluded.seen_seq, day = excluded.day, jev_calls = excluded.jev_calls, model_calls = excluded.model_calls,
        named_at = excluded.named_at, batched_at = excluded.batched_at, backfill = excluded.backfill, read_at = excluded.read_at`)
      .run(threadId, next.seenSeq, next.day, next.jevCalls, next.modelCalls, next.namedAt, next.batchedAt, next.backfill, this.now());
  }

  private used(key: string, kind: "jev" | "model", day: string): number {
    const read = this.read(key);
    return read?.day === day ? (kind === "jev" ? read.jevCalls : read.modelCalls) : 0;
  }

  private count(key: string, kind: "jev" | "model", day: string): void {
    const read = this.read(key);
    const today = read?.day === day;
    this.saveRead(key, { day, jevCalls: (today ? read!.jevCalls : 0) + (kind === "jev" ? 1 : 0), modelCalls: (today ? read!.modelCalls : 0) + (kind === "model" ? 1 : 0) });
  }

  /**
   * Counts one call (Jev's or the small model's) against today's caps: the
   * conversation's, and `totalCap` across every conversation. False when
   * either is reached. Both counts start again each day.
   */
  takeCall(threadId: string, kind: "jev" | "model", day: string, cap: number, totalCap = Number.POSITIVE_INFINITY): boolean {
    return this.db.transaction(() => {
      if (this.used(threadId, kind, day) >= cap || this.used(ALL_CONVERSATIONS, kind, day) >= totalCap) return false;
      this.count(threadId, kind, day);
      this.count(ALL_CONVERSATIONS, kind, day);
      return true;
    })();
  }

  /** Calls left today, under both caps. */
  callsLeft(threadId: string, kind: "jev" | "model", day: string, cap: number, totalCap = Number.POSITIVE_INFINITY): number {
    return Math.max(0, Math.min(cap - this.used(threadId, kind, day), totalCap - this.used(ALL_CONVERSATIONS, kind, day)));
  }

  forget(threadId: string): void {
    this.db.transaction(() => {
      for (const table of ["strands", "strand_items", "strand_reads"]) this.db.prepare(`DELETE FROM ${table} WHERE thread_id = ?`).run(threadId);
    })();
  }
}
