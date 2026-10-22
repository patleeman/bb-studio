// Mini apps' tables: the apps and their versions (source, manifest, compiled
// modules), shared state, records, approved capabilities, secrets, the event
// log, takes sent to agents, and the network request log.
//
// Schema: MINI_TABLES below (src/migrations.ts has its copy). Records are JSON; a field the
// manifest lists under a collection's `indexes` gets an expression index on
// (mini_id, collection, json_extract(data, '$.<field>')), shared by every
// mini app that indexes a field of that name.
import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { newId } from "../../kit/ids";
import { LIMITS, type Find, type Manifest, type MiniRecord } from "../shared";
import type { SourceFiles } from "./compile";

/**
 * Mini apps' schema as first released; src/migrations.ts keeps its own copy
 * (append schema changes only at the END of MIGRATIONS there).
 */
export const MINI_TABLES = `CREATE TABLE minis (
       id TEXT PRIMARY KEY, name TEXT NOT NULL, project_id TEXT, icon TEXT, version_id TEXT, thread_id TEXT,
       archived_at INTEGER, template INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
     );
   CREATE INDEX minis_updated ON minis (updated_at);
   CREATE TABLE mini_versions (
       id TEXT PRIMARY KEY, mini_id TEXT NOT NULL, files TEXT NOT NULL, manifest TEXT NOT NULL, modules TEXT NOT NULL,
       html TEXT, note TEXT, by TEXT NOT NULL, created_at INTEGER NOT NULL
     );
   CREATE INDEX mini_versions_mini ON mini_versions (mini_id, created_at);
   CREATE TABLE mini_state (
       mini_id TEXT PRIMARY KEY, state TEXT NOT NULL, version INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
     );
   CREATE TABLE mini_records (
       mini_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, rev INTEGER NOT NULL,
       created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
       PRIMARY KEY (mini_id, collection, id)
     );
   CREATE INDEX mini_records_updated ON mini_records (mini_id, collection, updated_at);
   CREATE TABLE mini_grants (mini_id TEXT NOT NULL, capability TEXT NOT NULL, granted_at INTEGER NOT NULL, PRIMARY KEY (mini_id, capability));
   CREATE TABLE mini_secrets (
       mini_id TEXT NOT NULL, name TEXT NOT NULL, header TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL,
       PRIMARY KEY (mini_id, name)
     );
   CREATE TABLE mini_events (
       seq INTEGER PRIMARY KEY AUTOINCREMENT, mini_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT, data TEXT, by TEXT NOT NULL, at INTEGER NOT NULL
     );
   CREATE INDEX mini_events_mini ON mini_events (mini_id, seq);
   CREATE TABLE mini_takes (id TEXT PRIMARY KEY, mini_id TEXT NOT NULL, label TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE mini_fetch_log (
       id INTEGER PRIMARY KEY AUTOINCREMENT, mini_id TEXT NOT NULL, at INTEGER NOT NULL, method TEXT NOT NULL, url TEXT NOT NULL,
       status INTEGER, error TEXT, ms INTEGER NOT NULL, bytes INTEGER NOT NULL
     );
   CREATE INDEX mini_fetch_log_mini ON mini_fetch_log (mini_id, id);`;

export type Actor = "user" | "agent";

export interface MiniRow {
  id: string;
  name: string;
  project_id: string | null;
  icon: string | null;
  version_id: string | null;
  thread_id: string | null;
  archived_at: number | null;
  template: number;
  created_at: number;
  updated_at: number;
  updated_by: string;
}

export interface VersionRow {
  id: string;
  mini_id: string;
  files: string;
  manifest: string;
  modules: string;
  html: string | null;
  note: string | null;
  by: string;
  created_at: number;
}

export interface Version {
  id: string;
  miniId: string;
  files: SourceFiles;
  manifest: Manifest;
  modules: Record<string, string>;
  html: string | null;
  note: string | null;
  by: string;
  createdAt: number;
}

export interface LiveEvent { seq: number; type: "state" | "event" | "command" | "result"; name: string | null; data: unknown; by: Actor; at: number }
export interface FetchLogRow { at: number; method: string; url: string; status: number | null; error: string | null; ms: number; bytes: number }

const parse = (text: string | null): unknown => (text === null ? null : JSON.parse(text));

export function toVersion(row: VersionRow): Version {
  return {
    id: row.id,
    miniId: row.mini_id,
    files: JSON.parse(row.files) as SourceFiles,
    manifest: JSON.parse(row.manifest) as Manifest,
    modules: JSON.parse(row.modules) as Record<string, string>,
    html: row.html,
    note: row.note,
    by: row.by,
    createdAt: row.created_at,
  };
}

function toRecord(row: { id: string; rev: number; data: string; created_by: string; created_at: number; updated_at: number }): MiniRecord {
  return { id: row.id, rev: row.rev, data: JSON.parse(row.data) as Record<string, unknown>, createdBy: row.created_by === "agent" ? "agent" : "user", createdAt: row.created_at, updatedAt: row.updated_at };
}

/** A JSON path for json_extract, from a checked field name such as `owner.id`. */
const jsonPath = (field: string) => `$.${field}`;
const FIELD = /^[a-zA-Z_][a-zA-Z0-9_.]{0,63}$/;

export class RecordConflict extends Error {
  constructor(readonly current: MiniRecord) {
    super(`The record changed since you read it (now rev ${current.rev}). Read it again and retry.`);
  }
}

export class MiniStore {
  constructor(private readonly db: Database.Database, private readonly now: () => number = Date.now) {}

  // ---- Apps ------------------------------------------------------------------

  create(input: { name: string; projectId: string | null; threadId?: string | null; by: Actor }): MiniRow {
    const id = newId("mini");
    const at = this.now();
    this.db.prepare("INSERT INTO minis (id, name, project_id, icon, version_id, thread_id, archived_at, template, created_at, updated_at, updated_by) VALUES (?, ?, ?, NULL, NULL, ?, NULL, 0, ?, ?, ?)")
      .run(id, input.name.slice(0, LIMITS.name), input.projectId, input.threadId ?? null, at, at, input.by);
    return this.get(id)!;
  }

  get(id: string): MiniRow | null {
    return (this.db.prepare("SELECT * FROM minis WHERE id = ?").get(id) as MiniRow | undefined) ?? null;
  }

  list(options: { includeArchived?: boolean; limit?: number } = {}): MiniRow[] {
    return this.db.prepare(`SELECT * FROM minis ${options.includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY updated_at DESC LIMIT ?`).all(options.limit ?? 1000) as MiniRow[];
  }

  touch(id: string, by: Actor) {
    this.db.prepare("UPDATE minis SET updated_at = ?, updated_by = ? WHERE id = ?").run(this.now(), by, id);
  }

  rename(id: string, name: string, by: Actor) {
    this.db.prepare("UPDATE minis SET name = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(name.slice(0, LIMITS.name), this.now(), by, id);
  }

  setIcon(id: string, icon: string | null) {
    this.db.prepare("UPDATE minis SET icon = ? WHERE id = ?").run(icon, id);
  }

  setProject(id: string, projectId: string | null) {
    this.db.prepare("UPDATE minis SET project_id = ?, updated_at = ? WHERE id = ?").run(projectId, this.now(), id);
  }

  setArchived(id: string, archived: boolean) {
    this.db.prepare("UPDATE minis SET archived_at = ? WHERE id = ?").run(archived ? this.now() : null, id);
  }

  setTemplate(id: string, template: boolean) {
    this.db.prepare("UPDATE minis SET template = ? WHERE id = ?").run(template ? 1 : 0, id);
  }

  delete(id: string) {
    this.db.transaction(() => {
      for (const table of ["mini_versions", "mini_state", "mini_records", "mini_grants", "mini_secrets", "mini_events", "mini_takes", "mini_fetch_log"]) {
        this.db.prepare(`DELETE FROM ${table} WHERE mini_id = ?`).run(id);
      }
      this.db.prepare("DELETE FROM minis WHERE id = ?").run(id);
    })();
  }

  // ---- Versions ----------------------------------------------------------------

  addVersion(miniId: string, input: { files: SourceFiles; manifest: Manifest; modules: Record<string, string>; html: string | null; note: string | null; by: Actor }): Version {
    const id = newId("mv");
    const at = this.now();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO mini_versions (id, mini_id, files, manifest, modules, html, note, by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, miniId, JSON.stringify(input.files), JSON.stringify(input.manifest), JSON.stringify(input.modules), input.html, input.note, input.by, at);
      this.db.prepare("UPDATE minis SET version_id = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(id, at, input.by, miniId);
      // Keep the newest versions; the current one is always among them.
      this.db.prepare("DELETE FROM mini_versions WHERE mini_id = ? AND id NOT IN (SELECT id FROM mini_versions WHERE mini_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)").run(miniId, miniId, LIMITS.versions);
      this.ensureIndexes(input.manifest);
    })();
    return this.version(miniId, id)!;
  }

  version(miniId: string, versionId: string): Version | null {
    const row = this.db.prepare("SELECT * FROM mini_versions WHERE mini_id = ? AND id = ?").get(miniId, versionId) as VersionRow | undefined;
    return row ? toVersion(row) : null;
  }

  current(miniId: string): Version | null {
    const row = this.get(miniId);
    return row?.version_id ? this.version(miniId, row.version_id) : null;
  }

  versions(miniId: string): { id: string; note: string | null; by: string; createdAt: number }[] {
    return (this.db.prepare("SELECT id, note, by, created_at FROM mini_versions WHERE mini_id = ? ORDER BY created_at DESC, rowid DESC").all(miniId) as { id: string; note: string | null; by: string; created_at: number }[])
      .map((row) => ({ id: row.id, note: row.note, by: row.by, createdAt: row.created_at }));
  }

  /** One expression index per field name, shared across mini apps. */
  private ensureIndexes(manifest: Manifest) {
    for (const { indexes } of Object.values(manifest.collections)) {
      for (const field of indexes) {
        if (!FIELD.test(field)) continue;
        const name = `mini_records_f_${createHash("sha1").update(field).digest("hex").slice(0, 12)}`;
        this.db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON mini_records (mini_id, collection, json_extract(data, '${jsonPath(field)}'))`);
      }
    }
  }

  // ---- State, events, takes (as live artifacts have) ---------------------------

  state(miniId: string): { state: unknown; version: number } {
    const row = this.db.prepare("SELECT state, version FROM mini_state WHERE mini_id = ?").get(miniId) as { state: string; version: number } | undefined;
    return row ? { state: parse(row.state), version: row.version } : { state: null, version: 0 };
  }

  setState(miniId: string, state: unknown, by: Actor): { state: unknown; version: number } {
    const text = JSON.stringify(state ?? null);
    if (text.length > LIMITS.stateBytes) throw new Error(`The state is ${Math.ceil(text.length / 1024)} KB; the limit is ${LIMITS.stateBytes / 1024} KB. Keep data in records.`);
    const version = this.state(miniId).version + 1;
    this.db.prepare("INSERT INTO mini_state (mini_id, state, version, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(mini_id) DO UPDATE SET state = excluded.state, version = excluded.version, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
      .run(miniId, text, version, by, this.now());
    this.log(miniId, "state", null, null, by);
    return { state: JSON.parse(text), version };
  }

  log(miniId: string, type: LiveEvent["type"], name: string | null, data: unknown, by: Actor) {
    const text = data === undefined || data === null ? null : JSON.stringify(data);
    if (text && text.length > LIMITS.stateBytes) throw new Error("The event's data is too large.");
    this.db.prepare("INSERT INTO mini_events (mini_id, type, name, data, by, at) VALUES (?, ?, ?, ?, ?, ?)").run(miniId, type, name, text, by, this.now());
    this.db.prepare("DELETE FROM mini_events WHERE mini_id = ? AND seq <= (SELECT seq FROM mini_events WHERE mini_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?)").run(miniId, miniId, LIMITS.events);
  }

  events(miniId: string, since: number): LiveEvent[] {
    return (this.db.prepare("SELECT seq, type, name, data, by, at FROM mini_events WHERE mini_id = ? AND seq > ? ORDER BY seq LIMIT 200").all(miniId, since) as { seq: number; type: LiveEvent["type"]; name: string | null; data: string | null; by: Actor; at: number }[])
      .map((row) => ({ ...row, data: parse(row.data) }));
  }

  lastSeq(miniId: string): number {
    return (this.db.prepare("SELECT MAX(seq) AS seq FROM mini_events WHERE mini_id = ?").get(miniId) as { seq: number | null }).seq ?? 0;
  }

  addTake(miniId: string, label: string, data: unknown): { id: string } {
    const text = JSON.stringify(data ?? null);
    if (text.length > LIMITS.stateBytes) throw new Error("What the mini app sent is too large.");
    const id = `take_${randomBytes(8).toString("hex")}`;
    this.db.prepare("INSERT INTO mini_takes (id, mini_id, label, data, created_at) VALUES (?, ?, ?, ?, ?)").run(id, miniId, label, text, this.now());
    this.db.prepare("DELETE FROM mini_takes WHERE mini_id = ? AND id NOT IN (SELECT id FROM mini_takes WHERE mini_id = ? ORDER BY created_at DESC LIMIT ?)").run(miniId, miniId, LIMITS.takes);
    return { id };
  }

  take(id: string): { miniId: string; label: string; data: unknown; createdAt: number } | null {
    const row = this.db.prepare("SELECT mini_id, label, data, created_at FROM mini_takes WHERE id = ?").get(id) as { mini_id: string; label: string; data: string; created_at: number } | undefined;
    return row ? { miniId: row.mini_id, label: row.label, data: parse(row.data), createdAt: row.created_at } : null;
  }

  // ---- Records ------------------------------------------------------------------

  private dataBytes(miniId: string): number {
    return (this.db.prepare("SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM mini_records WHERE mini_id = ?").get(miniId) as { bytes: number }).bytes;
  }

  private checkData(miniId: string, text: string, replacing = 0) {
    if (text.length > LIMITS.recordBytes) throw new Error(`A record may be ${LIMITS.recordBytes / 1024} KB as JSON; this one is ${Math.ceil(text.length / 1024)} KB.`);
    if (this.dataBytes(miniId) - replacing + text.length > LIMITS.dataBytes) throw new Error(`The mini app's records are over ${LIMITS.dataBytes / 1024 / 1024} MB. Remove some first.`);
  }

  getRecord(miniId: string, collection: string, id: string): MiniRecord | null {
    const row = this.db.prepare("SELECT id, rev, data, created_by, created_at, updated_at FROM mini_records WHERE mini_id = ? AND collection = ? AND id = ?").get(miniId, collection, id) as Parameters<typeof toRecord>[0] | undefined;
    return row ? toRecord(row) : null;
  }

  insert(miniId: string, collection: string, data: Record<string, unknown>, by: Actor, id?: string): MiniRecord {
    const text = JSON.stringify(data);
    this.checkData(miniId, text);
    const key = id ?? `r_${randomBytes(8).toString("hex")}`;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new Error("A record id is 1-64 letters, digits, _ or -.");
    if (this.getRecord(miniId, collection, key)) throw new Error(`A record ${key} already exists in ${collection}.`);
    const at = this.now();
    this.db.prepare("INSERT INTO mini_records (mini_id, collection, id, data, rev, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)").run(miniId, collection, key, text, by, at, at);
    return this.getRecord(miniId, collection, key)!;
  }

  /** Replaces a record's data; with `rev`, only if it's still that revision. */
  update(miniId: string, collection: string, id: string, data: Record<string, unknown>, rev?: number): MiniRecord {
    const current = this.getRecord(miniId, collection, id);
    if (!current) throw new Error(`No record ${id} in ${collection}.`);
    if (rev !== undefined && current.rev !== rev) throw new RecordConflict(current);
    const text = JSON.stringify(data);
    this.checkData(miniId, text, JSON.stringify(current.data).length);
    this.db.prepare("UPDATE mini_records SET data = ?, rev = rev + 1, updated_at = ? WHERE mini_id = ? AND collection = ? AND id = ?").run(text, this.now(), miniId, collection, id);
    return this.getRecord(miniId, collection, id)!;
  }

  /** Merges fields into a record; a null field is removed. */
  patch(miniId: string, collection: string, id: string, fields: Record<string, unknown>): MiniRecord {
    return this.db.transaction(() => {
      const current = this.getRecord(miniId, collection, id);
      if (!current) throw new Error(`No record ${id} in ${collection}.`);
      const data: Record<string, unknown> = { ...current.data };
      for (const [key, value] of Object.entries(fields)) {
        if (value === null) delete data[key];
        else data[key] = value;
      }
      return this.update(miniId, collection, id, data);
    }).immediate();
  }

  remove(miniId: string, collection: string, id: string): boolean {
    return this.db.prepare("DELETE FROM mini_records WHERE mini_id = ? AND collection = ? AND id = ?").run(miniId, collection, id).changes > 0;
  }

  /** Records matching `where`, in `order`. Filters and order work on any field; indexed ones are fast. */
  find(miniId: string, collection: string, query: Find): MiniRecord[] {
    const { sql, params } = this.where(miniId, collection, query.where);
    let order = "updated_at DESC";
    if (query.order) {
      const desc = query.order.startsWith("-");
      const field = query.order.replace(/^[-+]/, "");
      if (field === "createdAt" || field === "updatedAt") order = `${field === "createdAt" ? "created_at" : "updated_at"} ${desc ? "DESC" : "ASC"}`;
      else if (field === "id") order = `id ${desc ? "DESC" : "ASC"}`;
      else if (FIELD.test(field)) order = `json_extract(data, '${jsonPath(field)}') ${desc ? "DESC" : "ASC"}, created_at`;
      else throw new Error(`Can't order by "${query.order}".`);
    }
    const rows = this.db.prepare(`SELECT id, rev, data, created_by, created_at, updated_at FROM mini_records WHERE ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, query.limit ?? 100, query.offset ?? 0) as Parameters<typeof toRecord>[0][];
    return rows.map(toRecord);
  }

  count(miniId: string, collection: string, where: Find["where"]): number {
    const { sql, params } = this.where(miniId, collection, where);
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM mini_records WHERE ${sql}`).get(...params) as { n: number }).n;
  }

  private where(miniId: string, collection: string, where: Find["where"]): { sql: string; params: unknown[] } {
    const terms = ["mini_id = ?", "collection = ?"];
    const params: unknown[] = [miniId, collection];
    const value = (input: unknown) => (typeof input === "boolean" ? (input ? 1 : 0) : input);
    for (const [field, condition] of Object.entries(where ?? {})) {
      if (!FIELD.test(field)) throw new Error(`Can't filter on "${field}".`);
      const column = field === "id" ? "id" : `json_extract(data, '${jsonPath(field)}')`;
      if (condition === null) terms.push(`${column} IS NULL`);
      else if (typeof condition !== "object") {
        terms.push(`${column} = ?`);
        params.push(value(condition));
      } else if ("in" in condition) {
        const list = (condition as { in: unknown[] }).in;
        if (list.length === 0) terms.push("0");
        else {
          terms.push(`${column} IN (${list.map(() => "?").join(", ")})`);
          params.push(...list.map(value));
        }
      } else {
        const ops = { gt: ">", gte: ">=", lt: "<", lte: "<=", ne: "IS NOT" } as const;
        for (const [op, symbol] of Object.entries(ops)) {
          const operand = (condition as Record<string, unknown>)[op];
          if (operand === undefined) continue;
          terms.push(`${column} ${symbol} ?`);
          params.push(value(operand));
        }
      }
    }
    return { sql: terms.join(" AND "), params };
  }

  collections(miniId: string): { name: string; count: number }[] {
    return (this.db.prepare("SELECT collection AS name, COUNT(*) AS count FROM mini_records WHERE mini_id = ? GROUP BY collection ORDER BY collection").all(miniId) as { name: string; count: number }[]);
  }

  allRecords(miniId: string): { collection: string; record: MiniRecord }[] {
    return (this.db.prepare("SELECT collection, id, rev, data, created_by, created_at, updated_at FROM mini_records WHERE mini_id = ? ORDER BY collection, created_at").all(miniId) as (Parameters<typeof toRecord>[0] & { collection: string })[])
      .map((row) => ({ collection: row.collection, record: toRecord(row) }));
  }

  /** Copies another mini app's records (Duplicate with data). */
  copyRecords(fromId: string, toId: string) {
    this.db.prepare("INSERT INTO mini_records (mini_id, collection, id, data, rev, created_by, created_at, updated_at) SELECT ?, collection, id, data, rev, created_by, created_at, updated_at FROM mini_records WHERE mini_id = ?").run(toId, fromId);
  }

  // ---- Grants and secrets ---------------------------------------------------------

  grants(miniId: string): string[] {
    return (this.db.prepare("SELECT capability FROM mini_grants WHERE mini_id = ? ORDER BY capability").all(miniId) as { capability: string }[]).map((row) => row.capability);
  }

  grant(miniId: string, capabilities: readonly string[]) {
    const insert = this.db.prepare("INSERT OR IGNORE INTO mini_grants (mini_id, capability, granted_at) VALUES (?, ?, ?)");
    this.db.transaction(() => capabilities.forEach((cap) => insert.run(miniId, cap, this.now())))();
  }

  revoke(miniId: string, capabilities: readonly string[]) {
    const remove = this.db.prepare("DELETE FROM mini_grants WHERE mini_id = ? AND capability = ?");
    this.db.transaction(() => capabilities.forEach((cap) => remove.run(miniId, cap)))();
  }

  secrets(miniId: string): { name: string; header: string; updatedAt: number }[] {
    return (this.db.prepare("SELECT name, header, updated_at FROM mini_secrets WHERE mini_id = ? ORDER BY name").all(miniId) as { name: string; header: string; updated_at: number }[])
      .map((row) => ({ name: row.name, header: row.header, updatedAt: row.updated_at }));
  }

  secret(miniId: string, name: string): { header: string; value: string } | null {
    return (this.db.prepare("SELECT header, value FROM mini_secrets WHERE mini_id = ? AND name = ?").get(miniId, name) as { header: string; value: string } | undefined) ?? null;
  }

  setSecret(miniId: string, name: string, header: string, value: string) {
    this.db.prepare("INSERT INTO mini_secrets (mini_id, name, header, value, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(mini_id, name) DO UPDATE SET header = excluded.header, value = excluded.value, updated_at = excluded.updated_at")
      .run(miniId, name, header, value, this.now());
  }

  removeSecret(miniId: string, name: string) {
    this.db.prepare("DELETE FROM mini_secrets WHERE mini_id = ? AND name = ?").run(miniId, name);
  }

  // ---- Network log -------------------------------------------------------------------

  logFetch(miniId: string, entry: FetchLogRow) {
    this.db.prepare("INSERT INTO mini_fetch_log (mini_id, at, method, url, status, error, ms, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(miniId, entry.at, entry.method, entry.url.slice(0, 2000), entry.status, entry.error, entry.ms, entry.bytes);
    this.db.prepare("DELETE FROM mini_fetch_log WHERE mini_id = ? AND id <= (SELECT id FROM mini_fetch_log WHERE mini_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)").run(miniId, miniId, LIMITS.fetchLog);
  }

  fetchLog(miniId: string, limit = 50): FetchLogRow[] {
    return this.db.prepare("SELECT at, method, url, status, error, ms, bytes FROM mini_fetch_log WHERE mini_id = ? ORDER BY id DESC LIMIT ?").all(miniId, limit) as FetchLogRow[];
  }
}
