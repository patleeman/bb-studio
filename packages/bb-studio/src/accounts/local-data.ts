import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PinnedThread } from "./contract";
import type { PoolSignals } from "./pool-view";

export const PIN_IDLE_MS = 65 * 60_000;
const MAX_PINS = 400;
const POOL_PLUGIN = "account-pool";

function open(path: string): Database.Database | null {
  if (!existsSync(path)) return null;
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 1000");
    return db;
  } catch {
    return null;
  }
}

export function sourceDataDir(dataDir: string): string | null {
  try {
    const state = JSON.parse(readFileSync(join(dataDir, "fork-import.json"), "utf8")) as { version?: number; sourceDataDir?: unknown };
    return state.version === 1 && typeof state.sourceDataDir === "string" ? state.sourceDataDir : null;
  } catch {
    return null;
  }
}

function sessionOf(affinityKey: string): string | null {
  try {
    const parsed: unknown = JSON.parse(affinityKey);
    const id = Array.isArray(parsed) ? parsed[2] : null;
    if (typeof id !== "string") return null;
    const at = id.indexOf(":");
    return at === -1 ? id : id.slice(at + 1);
  } catch {
    return null;
  }
}

export function readPins(dataDir: string, now = Date.now()): Map<string, PinnedThread[]> {
  const result = new Map<string, PinnedThread[]>();
  const pool = open(join(dataDir, "plugins", POOL_PLUGIN, "data.db"));
  if (!pool) return result;
  let rows: { affinity_key: string; account_id: string }[];
  try {
    rows = pool.prepare("SELECT affinity_key, account_id FROM pool_affinity WHERE last_used_at > ? ORDER BY last_used_at DESC LIMIT ?").all(now - PIN_IDLE_MS, MAX_PINS) as typeof rows;
  } catch {
    return result;
  } finally {
    pool.close();
  }
  const accountOf = new Map<string, string>();
  for (const row of rows) {
    const session = sessionOf(row.affinity_key);
    if (session && !accountOf.has(session)) accountOf.set(session, row.account_id);
  }
  if (!accountOf.size) return result;
  const bb = open(join(dataDir, "bb.db"));
  if (!bb) return result;
  try {
    const sessions = [...accountOf.keys()];
    const marks = sessions.map(() => "?").join(",");
    const found = bb.prepare(`SELECT e.provider_thread_id AS session, t.id AS threadId, coalesce(nullif(t.title, ''), t.title_fallback, t.id) AS title FROM events e JOIN threads t ON t.id = e.thread_id WHERE e.type = 'thread/identity' AND e.provider_thread_id IN (${marks}) AND t.deleted_at IS NULL`).all(...sessions) as { session: string; threadId: string; title: string }[];
    const seen = new Set<string>();
    for (const row of found) {
      const accountId = accountOf.get(row.session);
      if (!accountId || seen.has(`${accountId}:${row.threadId}`)) continue;
      seen.add(`${accountId}:${row.threadId}`);
      const list = result.get(accountId) ?? [];
      list.push({ threadId: row.threadId, title: row.title });
      result.set(accountId, list);
    }
  } catch {
    return result;
  } finally {
    bb.close();
  }
  return result;
}

export function readPoolSignals(dataDir: string, accountIds: readonly string[]): PoolSignals {
  const rejected = new Set<string>();
  const bb = open(join(dataDir, "bb.db"));
  if (bb) {
    try {
      const rows = bb.prepare("SELECT key FROM plugin_kv WHERE plugin_id = ? AND key LIKE 'rejected-refresh:%'").all(POOL_PLUGIN) as { key: string }[];
      for (const row of rows) rejected.add(row.key.slice("rejected-refresh:".length));
    } catch {
      rejected.clear();
    } finally {
      bb.close();
    }
  }
  const secrets = join(dataDir, "plugins", POOL_PLUGIN, "secrets", "accounts");
  const missingLogin = new Set<string>();
  if (existsSync(join(dataDir, "plugins", POOL_PLUGIN))) {
    for (const id of accountIds) {
      if (/^[0-9a-f-]{36}$/i.test(id) && !existsSync(join(secrets, `account-${id}.json`))) missingLogin.add(id);
    }
  }
  return { rejected, missingLogin };
}

export function isMirrored(dataDir: string, threadId: string): boolean {
  const fork = open(join(dataDir, "fork-import.db"));
  if (!fork) return false;
  try {
    return !!fork.prepare("SELECT 1 FROM mirrored_threads WHERE thread_id = ? AND taken_over_at IS NULL").get(threadId);
  } catch {
    return false;
  } finally {
    fork.close();
  }
}
