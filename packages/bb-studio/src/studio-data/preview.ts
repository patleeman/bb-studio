// What Settings shows about "Bring over BB Studio data": whether this install
// can take it (own-data.ts), and, once bb's copy is staged, what it holds and
// which threads come over with it (threads.ts). Read-only: the staged copy is
// opened read-only and nothing is written.
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BB_KV_FILE, BEFORE_DIR, REPLACED_DIR, STAGED_DIR, importPath, readJournal, readJson, type ImportJournal } from "./journal";
import { studioOwnData, type OwnData } from "./own-data";
import { schemaProblem } from "./start";
import type { KvFile } from "./swap";
import { studioThreads, type StudioThreads } from "./threads";

export interface StagedPreview {
  bots: number;
  pages: number;
  tasks: number;
  memories: number;
  threads: StudioThreads;
  /** Mini apps that keep API keys, and watchers with environment values: they come along. */
  minisWithSecrets: number;
  watchersWithEnv: number;
  /** Why this Studio can't take bb's copy (a newer schema), or null. */
  problem: string | null;
}

export interface StudioDataStatus {
  ownData: OwnData;
  journal: Pick<ImportJournal, "state" | "error" | "stagedAt" | "appliedAt" | "restoredAt" | "stopped"> | null;
  /** Where the set-aside data is, while it's kept. */
  keptIn: string | null;
  preview: StagedPreview | null;
}

function count(db: Database.Database, sql: string): number {
  try {
    return (db.prepare(sql).get() as { n: number }).n;
  } catch (error) {
    if (/no such (table|column)/.test(String((error as Error)?.message ?? error))) return 0;
    throw error;
  }
}

export function previewStaged(dataDir: string, migrations: readonly string[]): StagedPreview | null {
  const path = join(importPath(dataDir, STAGED_DIR), "data.db");
  if (!existsSync(path)) return null;
  let kv: KvFile["plugin_kv"] = [];
  try { kv = readJson<KvFile>(importPath(dataDir, BB_KV_FILE)).plugin_kv ?? []; } catch { kv = []; }
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return {
      bots: count(db, "SELECT COUNT(*) AS n FROM bots"),
      pages: count(db, "SELECT COUNT(*) AS n FROM pages WHERE archived_at IS NULL"),
      tasks: Math.max(count(db, "SELECT COUNT(*) AS n FROM tasks"), count(db, "SELECT COUNT(*) AS n FROM bot_loops")),
      memories: count(db, "SELECT COUNT(*) AS n FROM memory_records WHERE archived = 0"),
      threads: studioThreads(db, kv),
      minisWithSecrets: count(db, "SELECT COUNT(DISTINCT mini_id) AS n FROM mini_secrets"),
      watchersWithEnv: count(db, "SELECT COUNT(*) AS n FROM bot_automations WHERE kind = 'watcher' AND env_json IS NOT NULL AND env_json NOT IN ('', '{}', 'null')"),
      problem: schemaProblem(db, migrations),
    };
  } finally {
    db.close();
  }
}

export function studioDataStatus(dataDir: string, liveDb: Database.Database, migrations: readonly string[]): StudioDataStatus {
  const journal = readJournal(dataDir);
  const known = journal === null || journal === "unreadable" ? null : journal;
  const keptIn = known?.state === "applied" || known?.state === "restore-requested" || (known?.state === "rollback-failed" && known.undoing !== "restoring") ? importPath(dataDir, BEFORE_DIR)
    : known?.state === "restored" || (known?.state === "rollback-failed" && known.undoing === "restoring") ? importPath(dataDir, REPLACED_DIR)
    : null;
  const staged = known && (known.state === "staged" || known.state === "ready" || known.state === "refused" || known.state === "failed");
  return {
    ownData: studioOwnData(liveDb),
    journal: known ? { state: known.state, error: known.error, stagedAt: known.stagedAt, appliedAt: known.appliedAt ?? null, restoredAt: known.restoredAt ?? null, stopped: known.stopped ?? null } : null,
    keptIn,
    preview: staged ? previewStaged(dataDir, migrations) : null,
  };
}
