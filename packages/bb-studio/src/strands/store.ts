// Strands' rows (migration 115): `strands`, `strand_items` (one per sorted
// turn, plus the workers that joined a strand) and `strand_reads` (how far a
// conversation was read, and its daily Jev count). States are never stored:
// src/strands/states.ts works them out on each read.
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

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
  openedAt: number | null;
  createdAt: number;
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
}

export interface StrandRead { threadId: string; seenSeq: number; day: string | null; jevCalls: number; modelCalls: number; namedAt: number | null; batchedAt: number | null; backfill: string | null }

type StrandRow = {
  id: string; thread_id: string; title: string; summary: string | null; named: number; name_tries: number; summary_at: number | null;
  first_seq: number; last_seq: number; last_at: number; pinned: number; merged_into: string | null; origin: string; task_id: string | null;
  waiting_on: string | null; waiting_at: number | null; opened_at: number | null; created_at: number;
};
type ItemRow = {
  thread_id: string; seq: number; kind: string; ref: string; turn_id: string | null; at: number; line: string | null;
  strand_id: string | null; confidence: number | null; by: string; unsure: number;
};

const strandOf = (row: StrandRow): Strand => ({
  id: row.id, threadId: row.thread_id, title: row.title, summary: row.summary, named: !!row.named, nameTries: row.name_tries, summaryAt: row.summary_at,
  firstSeq: row.first_seq, lastSeq: row.last_seq, lastAt: row.last_at, pinned: !!row.pinned, mergedInto: row.merged_into,
  origin: row.origin as StrandOrigin, taskId: row.task_id, waitingOn: row.waiting_on, waitingAt: row.waiting_at, openedAt: row.opened_at, createdAt: row.created_at,
});
const itemOf = (row: ItemRow): StrandItem => ({
  threadId: row.thread_id, seq: row.seq, kind: row.kind as ItemKind, ref: row.ref, turnId: row.turn_id, at: row.at, line: row.line,
  strandId: row.strand_id, confidence: row.confidence, by: row.by as ItemBy, unsure: !!row.unsure,
});

/** The last user line kept with an item, for the prompt's "last user line". */
export const LINE_MAX = 300;

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
    return (this.db.prepare("SELECT * FROM strands WHERE thread_id = ? AND merged_into IS NULL ORDER BY last_at DESC, id").all(threadId) as StrandRow[]).map(strandOf);
  }

  /** The newest `limit` strands of a conversation (not merged), for a prompt. */
  recent(threadId: string, limit: number): Strand[] {
    return (this.db.prepare("SELECT * FROM strands WHERE thread_id = ? AND merged_into IS NULL ORDER BY last_at DESC, id LIMIT ?").all(threadId, limit) as StrandRow[]).map(strandOf);
  }

  /** Strands still waiting for the small model's name, oldest first. */
  unnamed(threadId: string, maxTries: number): Strand[] {
    return (this.db.prepare("SELECT * FROM strands WHERE thread_id = ? AND merged_into IS NULL AND named = 0 AND name_tries < ? ORDER BY created_at, id").all(threadId, maxTries) as StrandRow[]).map(strandOf);
  }

  byTask(taskId: string): Strand | null {
    const row = this.db.prepare("SELECT * FROM strands WHERE task_id = ? AND merged_into IS NULL LIMIT 1").get(taskId) as StrandRow | undefined;
    return row ? strandOf(row) : null;
  }

  titles(threadId: string, except: string | null = null): string[] {
    return (this.db.prepare("SELECT title FROM strands WHERE thread_id = ? AND merged_into IS NULL AND named = 1 AND id IS NOT ?").all(threadId, except) as { title: string }[]).map((row) => row.title);
  }

  /** A new strand. With `seq` null it has no message yet: its span starts empty and grows with its first one. */
  create(input: { threadId: string; title: string; summary?: string | null; named?: boolean; origin: StrandOrigin; seq: number | null; at: number; taskId?: string | null }): Strand {
    const id = `str_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const at = this.now();
    this.db.prepare(`INSERT INTO strands (id, thread_id, title, summary, named, summary_at, first_seq, last_seq, last_at, origin, task_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.threadId, input.title, input.summary ?? null, input.named ? 1 : 0, input.summary ? at : null, input.seq ?? Number.MAX_SAFE_INTEGER, input.seq ?? 0, input.at, input.origin, input.taskId ?? null, at);
    return this.get(id)!;
  }

  named(id: string, title: string, summary: string | null): void {
    this.db.prepare("UPDATE strands SET title = ?, summary = COALESCE(?, summary), summary_at = CASE WHEN ? IS NULL THEN summary_at ELSE ? END, named = 1 WHERE id = ?")
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

  /** Folds `from` into `into`: its items move, its span joins. Your choice always wins: a strand you made isn't folded by the model. */
  merge(from: string, into: string): boolean {
    if (from === into) return false;
    const a = this.get(from);
    const b = this.get(into);
    if (!a || !b || a.threadId !== b.threadId || a.mergedInto || b.mergedInto || a.origin === "user") return false;
    this.db.transaction(() => {
      this.db.prepare("UPDATE strand_items SET strand_id = ? WHERE thread_id = ? AND strand_id = ?").run(into, a.threadId, from);
      this.db.prepare("UPDATE strands SET merged_into = ? WHERE id = ?").run(into, from);
      this.db.prepare(`UPDATE strands SET first_seq = MIN(first_seq, ?), last_seq = MAX(last_seq, ?), last_at = MAX(last_at, ?),
        task_id = COALESCE(task_id, ?), pinned = MAX(pinned, ?) WHERE id = ?`).run(a.firstSeq, a.lastSeq, a.lastAt, a.taskId, a.pinned ? 1 : 0, into);
    })();
    return true;
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
  put(item: Omit<StrandItem, "unsure" | "ref"> & { ref?: string; unsure?: boolean }): void {
    this.db.prepare(`INSERT INTO strand_items (thread_id, seq, kind, ref, turn_id, at, line, strand_id, confidence, by, unsure) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, kind, seq, ref) DO UPDATE SET turn_id = COALESCE(excluded.turn_id, turn_id), at = excluded.at, line = COALESCE(excluded.line, line),
        strand_id = excluded.strand_id, confidence = excluded.confidence, by = excluded.by, unsure = excluded.unsure`)
      .run(item.threadId, item.seq, item.kind, item.ref ?? "", item.turnId, item.at, item.line?.slice(0, LINE_MAX) ?? null, item.strandId, item.confidence, item.by, item.unsure ? 1 : 0);
    if (item.strandId) this.touched(item.strandId, item.seq, item.at);
  }

  /** The strand of the turn that was going on at `at`: the newest sorted message at or before it. */
  strandAt(threadId: string, at: number): { strandId: string | null; seq: number } | null {
    const row = this.db.prepare("SELECT strand_id, seq FROM strand_items WHERE thread_id = ? AND at <= ? AND kind IN ('user', 'report') ORDER BY at DESC, seq DESC LIMIT 1").get(threadId, at) as { strand_id: string | null; seq: number } | undefined;
    return row ? { strandId: row.strand_id, seq: row.seq } : null;
  }

  /** The strand of the newest sorted message before `seq` that had one. */
  previous(threadId: string, seq: number): string | null {
    const row = this.db.prepare("SELECT strand_id FROM strand_items WHERE thread_id = ? AND seq < ? AND kind IN ('user', 'report') AND strand_id IS NOT NULL ORDER BY seq DESC LIMIT 1").get(threadId, seq) as { strand_id: string } | undefined;
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

  /** Counts one call (Jev's or the small model's) against today's cap; false when the cap is reached. Both counts start again each day. */
  takeCall(threadId: string, kind: "jev" | "model", day: string, cap: number): boolean {
    const read = this.read(threadId);
    const today = read?.day === day;
    const used = today ? (kind === "jev" ? read!.jevCalls : read!.modelCalls) : 0;
    if (used >= cap) return false;
    this.saveRead(threadId, { day, jevCalls: kind === "jev" ? used + 1 : today ? read!.jevCalls : 0, modelCalls: kind === "model" ? used + 1 : today ? read!.modelCalls : 0 });
    return true;
  }

  /** Calls left today. */
  callsLeft(threadId: string, kind: "jev" | "model", day: string, cap: number): number {
    const read = this.read(threadId);
    return read?.day === day ? Math.max(0, cap - (kind === "jev" ? read.jevCalls : read.modelCalls)) : cap;
  }

  forget(threadId: string): void {
    this.db.transaction(() => {
      for (const table of ["strands", "strand_items", "strand_reads"]) this.db.prepare(`DELETE FROM ${table} WHERE thread_id = ?`).run(threadId);
    })();
  }
}
