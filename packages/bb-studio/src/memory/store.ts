// Memory records (table memory_records, FTS5 index memory_records_fts) and
// each Bot's core profile pointer (memory_profiles).
//
// A record is never edited in place: a correction is a new record whose
// replaces_id points at the old one, and the old one gets replaced_by_id.
// So the chain is linear: only a current record (no replaced_by_id) can be
// replaced. Archive hides a record from search and the list; it's kept.
import type Database from "better-sqlite3";
import { newId } from "../kit/ids";
import type { MemoryRecordView, MemorySource } from "./contract";
import { cleanTopic } from "./shared";

type RecordRow = {
  rowid: number; id: string; bot_id: string; topic: string; text: string; created_at: number; updated_at: number;
  source_kind: MemorySource["kind"]; source_id: string | null; source_title: string; source_section: string | null;
  replaces_id: string | null; replaced_by_id: string | null; archived: number;
  replaces_text: string | null; replaces_at: number | null; replaced_at: number | null;
};

/** A stored record, without the thread state the views add. */
export type MemoryRecord = Omit<MemoryRecordView, "sourceState">;

export interface ListOptions {
  botId: string;
  query?: string;
  topic?: string;
  sort: "relevance" | "newest" | "oldest" | "topic";
  includeReplaced: boolean;
  includeArchived: boolean;
  limit: number;
}

export interface ProfileRow { bot_id: string; profile_page_id: string; legacy_page_id: string | null; split_at: number | null; created_at: number }

const select = (extra = "") => `SELECT r.rowid, r.*, p.text AS replaces_text, p.created_at AS replaces_at, n.created_at AS replaced_at${extra}
  FROM memory_records r
  LEFT JOIN memory_records p ON p.id = r.replaces_id
  LEFT JOIN memory_records n ON n.id = r.replaced_by_id`;

function view(row: RecordRow): MemoryRecord {
  return {
    id: row.id, botId: row.bot_id, topic: row.topic, text: row.text, createdAt: row.created_at, updatedAt: row.updated_at,
    source: { kind: row.source_kind, id: row.source_id, title: row.source_title, section: row.source_section },
    replacesId: row.replaces_id,
    replaces: row.replaces_id && row.replaces_text !== null ? { id: row.replaces_id, text: row.replaces_text, createdAt: row.replaces_at ?? 0 } : null,
    replacedById: row.replaced_by_id,
    replacedAt: row.replaced_by_id ? row.replaced_at ?? null : null,
    archived: row.archived === 1,
  };
}

/** Words of a search, each as an FTS5 prefix term; empty when there are none. */
export function ftsTerms(query: string): string[] {
  return (query.match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 12).map((word) => `"${word}"*`);
}

export class MemoryStore {
  constructor(readonly db: Database.Database, private readonly changed: () => void = () => {}) {}

  get(id: string): MemoryRecord | null {
    const row = this.db.prepare(`${select()} WHERE r.id = ?`).get(id) as RecordRow | undefined;
    return row ? view(row) : null;
  }

  /** A record of this Bot, or an error that says why not. */
  need(botId: string, id: string): MemoryRecord {
    const record = this.get(id);
    if (!record || record.botId !== botId) throw new Error(`No memory record "${id}".`);
    return record;
  }

  /** The topic as the Bot already spells it ("homelab" stays "homelab" when "Homelab" is added), else cleaned. */
  private topic(botId: string, topic: string): string {
    const clean = cleanTopic(topic);
    if (!clean) throw new Error("A memory record needs a topic.");
    const known = this.db.prepare("SELECT topic FROM memory_records WHERE bot_id = ? AND topic = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 1").get(botId, clean) as { topic: string } | undefined;
    return known?.topic ?? clean;
  }

  private insert(input: { botId: string; topic: string; text: string; source: MemorySource; createdAt: number; replacesId?: string | null }, now: number): string {
    const text = input.text.trim();
    if (!text) throw new Error("A memory record needs text.");
    const id = newId("mem");
    this.db.prepare(`INSERT INTO memory_records (id, bot_id, topic, text, created_at, updated_at, source_kind, source_id, source_title, source_section, replaces_id, replaced_by_id, archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`)
      .run(id, input.botId, this.topic(input.botId, input.topic), text, input.createdAt, now, input.source.kind, input.source.id, input.source.title, input.source.section, input.replacesId ?? null);
    return id;
  }

  add(input: { botId: string; topic: string; text: string; source: MemorySource; createdAt?: number }, now = Date.now()): MemoryRecord {
    const id = this.insert({ ...input, createdAt: input.createdAt ?? now }, now);
    this.changed();
    return this.get(id)!;
  }

  /** Many records at once, in one transaction (the split). */
  addMany(records: readonly { botId: string; topic: string; text: string; source: MemorySource; createdAt: number }[], now = Date.now()): number {
    this.db.transaction(() => { for (const record of records) this.insert(record, now); })();
    if (records.length) this.changed();
    return records.length;
  }

  /** A correction: a new record replacing `id`, which stays as history. Only a current record can be replaced. */
  replace(botId: string, id: string, input: { text: string; topic?: string; source: MemorySource }, now = Date.now()): { record: MemoryRecord; replaced: MemoryRecord } {
    const newIdValue = this.db.transaction(() => {
      const old = this.need(botId, id);
      if (old.replacedById) throw new Error(`Memory record ${id} was already replaced by ${old.replacedById}; update that one instead.`);
      const next = this.insert({ botId, topic: input.topic ?? old.topic, text: input.text, source: input.source, createdAt: now, replacesId: id }, now);
      this.db.prepare("UPDATE memory_records SET replaced_by_id = ?, updated_at = ? WHERE id = ?").run(next, now, id);
      return next;
    })();
    this.changed();
    return { record: this.get(newIdValue)!, replaced: this.get(id)! };
  }

  archive(botId: string, id: string, archived: boolean, now = Date.now()): MemoryRecord {
    this.need(botId, id);
    this.db.prepare("UPDATE memory_records SET archived = ?, updated_at = ? WHERE id = ?").run(archived ? 1 : 0, now, id);
    this.changed();
    return this.get(id)!;
  }

  private where(options: ListOptions, terms: string[] | null, join: "AND" | "OR"): { sql: string; params: unknown[] } {
    const clauses = ["r.bot_id = ?"];
    const params: unknown[] = [options.botId];
    if (terms?.length) { clauses.push("memory_records_fts MATCH ?"); params.push(terms.join(` ${join} `)); }
    if (options.topic) { clauses.push("r.topic = ? COLLATE NOCASE"); params.push(cleanTopic(options.topic)); }
    if (!options.includeArchived) clauses.push("r.archived = 0");
    if (!options.includeReplaced) clauses.push("r.replaced_by_id IS NULL");
    return { sql: clauses.join(" AND "), params };
  }

  /**
   * Records of a Bot, current ones first. With a query, FTS5 ranks them
   * (topic weighs double); when every word together matches nothing, any
   * word does.
   */
  list(options: ListOptions): { records: MemoryRecord[]; total: number } {
    const terms = options.query ? ftsTerms(options.query) : [];
    if (options.query && !terms.length) return { records: [], total: 0 };
    const order = {
      relevance: terms.length ? "score, r.created_at DESC" : "r.created_at DESC",
      newest: "r.created_at DESC",
      oldest: "r.created_at ASC",
      topic: "r.topic COLLATE NOCASE, r.created_at DESC",
    }[options.sort];
    const run = (join: "AND" | "OR") => {
      const { sql, params } = this.where(options, terms, join);
      const from = terms.length ? `${select(", bm25(memory_records_fts, 2.0, 1.0) AS score")} JOIN memory_records_fts ON memory_records_fts.rowid = r.rowid` : select();
      const rows = this.db.prepare(`${from} WHERE ${sql} ORDER BY (r.replaced_by_id IS NOT NULL), ${order}, r.id LIMIT ?`).all(...params, options.limit) as RecordRow[];
      const count = this.db.prepare(`SELECT COUNT(*) AS n FROM memory_records r${terms.length ? " JOIN memory_records_fts ON memory_records_fts.rowid = r.rowid" : ""} WHERE ${sql}`).get(...params) as { n: number };
      return { records: rows.map(view), total: count.n };
    };
    const all = run("AND");
    return all.total || terms.length < 2 ? all : run("OR");
  }

  /** Topics of a Bot's current records, most used first. */
  topics(botId: string): { topic: string; count: number }[] {
    return this.db.prepare(`SELECT topic, COUNT(*) AS count FROM memory_records WHERE bot_id = ? AND archived = 0 AND replaced_by_id IS NULL
      GROUP BY topic COLLATE NOCASE ORDER BY count DESC, MAX(created_at) DESC, topic COLLATE NOCASE`).all(botId) as { topic: string; count: number }[];
  }

  counts(botId: string): { current: number; replaced: number; archived: number } {
    const row = this.db.prepare(`SELECT
      COALESCE(SUM(archived = 0 AND replaced_by_id IS NULL), 0) AS current,
      COALESCE(SUM(archived = 0 AND replaced_by_id IS NOT NULL), 0) AS replaced,
      COALESCE(SUM(archived = 1), 0) AS archived
      FROM memory_records WHERE bot_id = ?`).get(botId) as { current: number; replaced: number; archived: number };
    return row;
  }

  // Core profiles -------------------------------------------------------------

  profile(botId: string): ProfileRow | null {
    return (this.db.prepare("SELECT * FROM memory_profiles WHERE bot_id = ?").get(botId) as ProfileRow | undefined) ?? null;
  }

  /** A (new) profile page for a Bot; a split's marker and old page are kept when the profile is remade. */
  setProfile(botId: string, pageId: string, now = Date.now()): void {
    this.db.prepare(`INSERT INTO memory_profiles (bot_id, profile_page_id, legacy_page_id, split_at, created_at) VALUES (?, ?, NULL, NULL, ?)
      ON CONFLICT (bot_id) DO UPDATE SET profile_page_id = excluded.profile_page_id`).run(botId, pageId, now);
  }

  /** The split's marker: the profile it made, the page it read, and when. */
  markSplit(botId: string, profilePageId: string, legacyPageId: string, now = Date.now()): void {
    this.db.prepare(`INSERT INTO memory_profiles (bot_id, profile_page_id, legacy_page_id, split_at, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (bot_id) DO UPDATE SET profile_page_id = excluded.profile_page_id, legacy_page_id = excluded.legacy_page_id, split_at = excluded.split_at`).run(botId, profilePageId, legacyPageId, now, now);
  }
}
