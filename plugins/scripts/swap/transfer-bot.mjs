#!/usr/bin/env node
// Moves a Bot from one BB data folder's Studio to another's: the Bot, its
// profile and memory records, skills, runners, automations, todos (loops) and
// Studio's scheduler rows, plus BB's automations plugin rows. Everything that
// can run arrives paused, and a manifest lists what was on so it can be turned
// back on one by one.
//
// The fork's mirror (desktop fork-import plugin-sync) already copies Studio's
// items (pages, designs, drawings, recordings, artifacts, tags, leads) and
// BB's projects, machines and environments. It deliberately skips these
// tables, so this script copies exactly them.
//
// Both servers must be stopped. It opens the source read-only, never touches
// credentials (no secrets folders, no account-pool, no mini_secrets), and a
// second run changes nothing. --dry-run does the whole copy in a transaction
// and rolls it back.
//
//   node transfer-bot.mjs --from <src data dir> --to <dst data dir> [--dry-run]
//     [--rewrite <old>=<new>]... [--manifest <file>] [--keep-state]
import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

/** The tables the mirror skips (plugin-sync SKIPPED_TABLES.studio) plus the Bot's memory and todos. */
export const BOT_TABLE = /^(bots|bot_.+|memory_records|memory_profiles|loop_events|loop_scheduler|automation_.+|runner_.+|space_retired_automations)$/u;
/** Never copied: credentials, per-server warnings, and suggestions rebuilt on the new server. */
export const NEVER = new Set(["mini_secrets", "account_warnings", "next_suggestions"]);
/** Rows here also belong to the new server's own threads; keep its rows and add or update the source's. */
export const MERGE = new Set(["bot_threads", "bot_threads_state", "triggers", "trigger_runs"]);
/** Scheduler rows that belong to the Bot (other owners are the server's own sweeps). */
const BOT_TRIGGER_OWNERS = ["runner", "automation"];
/** Text columns where a path to the old data folder may appear (jobs, instructions, memory, skills). */
export const REWRITE_COLUMNS = { bot_runners: ["job"], bot_automations: ["instruction"], memory_records: ["text"], bot_skills: ["body"] };

const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
const columns = (db, schema, table) => db.prepare("SELECT name, pk FROM pragma_table_info(?, ?)").all(table, schema);
const hasTrigger = (db, table, suffix) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND name LIKE ?").get(table, `%${suffix}`);
const count = (db, schema, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${schema}.${quote(table)}`).get().n;

function refuseCredentials(path) {
  if (/account-pool|secrets|auth\.json|auth-secret/u.test(path)) throw new Error(`Refusing a credentials path: ${path}`);
}

/** Refuses a database another process has open (its server is running). Falls back to the WAL when lsof is missing. */
function refuseRunning(path) {
  const lsof = spawnSync("lsof", ["-t", "--", path], { encoding: "utf8" });
  if (lsof.error) {
    const wal = `${path}-wal`;
    if (existsSync(wal) && statSync(wal).size > 0) throw new Error(`${path} has a write-ahead log: its server looks like it is running. Stop it first.`);
    return;
  }
  const holders = lsof.stdout.split("\n").filter((pid) => pid && pid !== String(process.pid));
  if (holders.length) throw new Error(`${path} is open in process ${holders.join(", ")}: its server looks like it is running. Stop it first.`);
}

/** Copies one table's rows by policy. Returns { policy, before, after }. */
function copyTable(db, table) {
  const shared = columns(db, "src", table).map((c) => c.name);
  const own = new Set(columns(db, "main", table).map((c) => c.name));
  const list = shared.filter((name) => own.has(name));
  const key = columns(db, "main", table).filter((c) => c.pk > 0).map((c) => c.name);
  const cols = list.map(quote).join(", ");
  const before = count(db, "main", table);
  const appendOnly = hasTrigger(db, table, "_no_delete");
  let policy;
  let where = "";
  if (table === "triggers") where = ` WHERE owner IN (${BOT_TRIGGER_OWNERS.map(() => "?").join(", ")})`;
  const args = table === "triggers" ? BOT_TRIGGER_OWNERS : [];
  if (appendOnly) {
    policy = "append";
    db.prepare(`INSERT OR IGNORE INTO main.${quote(table)} (${cols}) SELECT ${cols} FROM src.${quote(table)}`).run();
  } else if (MERGE.has(table)) {
    policy = "merge";
    if (table === "triggers" && key.length) {
      // The Bot's schedules end up exactly the source's; the server's own sweeps stay.
      const k = key.map(quote).join(", ");
      db.prepare(`DELETE FROM main.triggers${where} AND (${k}) NOT IN (SELECT ${k} FROM src.triggers${where})`).run(...args, ...args);
    }
    db.prepare(`INSERT OR REPLACE INTO main.${quote(table)} (${cols}) SELECT ${cols} FROM src.${quote(table)}${where}`).run(...args);
    if (table === "triggers") db.prepare(`UPDATE main.triggers SET lease_until = NULL${where}`).run(...args);
  } else {
    policy = "replace";
    db.prepare(`DELETE FROM main.${quote(table)}`).run();
    db.prepare(`INSERT INTO main.${quote(table)} (${cols}) SELECT ${cols} FROM src.${quote(table)}`).run();
  }
  return { policy, before, after: count(db, "main", table), source: count(db, "src", table) };
}

function rewritePaths(db, rewrites) {
  const done = {};
  for (const [table, cols] of Object.entries(REWRITE_COLUMNS)) {
    if (!tables(db).includes(table)) continue;
    for (const column of cols) {
      for (const [from, to] of rewrites) {
        const { changes } = db.prepare(`UPDATE ${quote(table)} SET ${quote(column)} = replace(${quote(column)}, ?, ?) WHERE instr(${quote(column)}, ?) > 0`).run(from, to, from);
        if (changes) done[`${table}.${column}`] = (done[`${table}.${column}`] ?? 0) + Number(changes);
      }
    }
  }
  return done;
}

/** Turns off everything that can run, and records what was on. */
function pauseAll(db) {
  const has = new Set(tables(db));
  const ids = (sql) => (has.has(sql.match(/FROM (\w+)/u)[1]) ? db.prepare(sql).all().map((row) => row.id) : []);
  const wasOn = {
    bots: ids("SELECT id FROM bots WHERE state = 'active'"),
    runners: ids("SELECT id FROM bot_runners WHERE state = 'active'"),
    botAutomations: ids("SELECT id FROM bot_automations WHERE state = 'active'"),
  };
  if (has.has("bots")) db.prepare("UPDATE bots SET state = 'paused' WHERE state = 'active'").run();
  if (has.has("bot_runners")) db.prepare("UPDATE bot_runners SET state = 'paused' WHERE state = 'active'").run();
  if (has.has("bot_automations")) db.prepare("UPDATE bot_automations SET state = 'paused' WHERE state = 'active'").run();
  if (has.has("bot_cache_settings")) db.prepare("UPDATE bot_cache_settings SET enabled = 0").run();
  return wasOn;
}

/** BB's automations plugin: the source's rows, all disabled. Run history is copied too (append). */
function copyBbAutomations(db) {
  const cols = columns(db, "src", "automations").map((c) => c.name).filter((name) => columns(db, "main", "automations").some((c) => c.name === name));
  const list = cols.map(quote).join(", ");
  const enabled = db.prepare("SELECT id FROM src.automations WHERE enabled = 1 ORDER BY id").all().map((row) => row.id);
  const targets = db.prepare("SELECT DISTINCT target_thread_id AS id FROM src.automations WHERE enabled = 1 AND target_thread_id IS NOT NULL").all().map((row) => row.id);
  const before = count(db, "main", "automations");
  db.prepare("DELETE FROM main.automations").run();
  db.prepare(`INSERT INTO main.automations (${list}) SELECT ${list} FROM src.automations`).run();
  db.prepare("UPDATE main.automations SET enabled = 0, next_run_at = NULL").run();
  if (tables(db).includes("automation_runs")) {
    const runCols = columns(db, "src", "automation_runs").map((c) => quote(c.name)).join(", ");
    db.prepare(`INSERT OR IGNORE INTO main.automation_runs (${runCols}) SELECT ${runCols} FROM src.automation_runs`).run();
  }
  return { before, after: count(db, "main", "automations"), enabledAtSource: enabled, targetThreads: targets };
}

function withAttached(targetPath, sourcePath, dryRun, work) {
  refuseCredentials(targetPath);
  refuseCredentials(sourcePath);
  refuseRunning(targetPath);
  const db = new DatabaseSync(targetPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    // Rows are copied table by table, so a parent may arrive after its child.
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("ATTACH DATABASE ? AS src").run(`file:${sourcePath}?mode=ro`);
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work(db);
      db.exec(dryRun ? "ROLLBACK" : "COMMIT");
      // Leave no write-ahead log behind, so the folder looks like a cleanly stopped server's.
      if (!dryRun) db.exec("PRAGMA main.wal_checkpoint(TRUNCATE)");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

/**
 * The whole move. `from` and `to` are BB data folders (or copies of them).
 * Returns the manifest: per-table counts, what was on, and the threads to take over.
 */
export function transferBot({ from, to, dryRun = false, rewrites = [], keepState = false }) {
  const src = (dir, ...parts) => resolve(dir, "plugins", ...parts);
  const studio = withAttached(src(to, "studio", "data.db"), src(from, "studio", "data.db"), dryRun, (db) => {
    const ours = new Set(tables(db));
    const theirs = db.prepare("SELECT name FROM src.sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
    const result = { tables: {}, skipped: [] };
    for (const table of theirs) {
      if (!(BOT_TABLE.test(table) || MERGE.has(table)) || NEVER.has(table) || table.includes("_fts")) continue;
      if (!ours.has(table)) { result.skipped.push(table); continue; }
      result.tables[table] = copyTable(db, table);
    }
    // The fork's own Memory split leaves memory records the source never had; replace already dropped them.
    result.rewritten = rewritePaths(db, rewrites);
    result.wasOn = keepState ? null : pauseAll(db);
    const runnerThreads = ours.has("bot_runners") ? db.prepare("SELECT id, thread_id FROM bot_runners ORDER BY id").all() : [];
    result.runnerThreads = runnerThreads.map((row) => ({ runner: row.id, thread: row.thread_id }));
    result.botThreads = db.prepare("SELECT id, thread_id FROM bots").all().map((row) => ({ bot: row.id, thread: row.thread_id }));
    result.leftoverOldPaths = Object.entries(REWRITE_COLUMNS).flatMap(([table, cols]) =>
      ours.has(table) ? cols.map((column) => ({ at: `${table}.${column}`, rows: db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)} WHERE instr(${quote(column)}, '/.bb/') > 0`).get().n })).filter((row) => row.rows) : []);
    return result;
  });
  const automationsPath = src(to, "automations", "data.db");
  const automations = existsSync(automationsPath) && existsSync(src(from, "automations", "data.db"))
    ? withAttached(automationsPath, src(from, "automations", "data.db"), dryRun, copyBbAutomations)
    : null;
  return { dryRun, from: resolve(from), to: resolve(to), at: new Date().toISOString(), studio, automations };
}

function parseArgs(argv) {
  const out = { rewrites: [], dryRun: false, keepState: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--from") out.from = argv[++i];
    else if (arg === "--to") out.to = argv[++i];
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--keep-state") out.keepState = true;
    else if (arg === "--manifest") out.manifest = argv[++i];
    else if (arg === "--rewrite") {
      const [from, to] = argv[++i].split("=");
      if (!from || to === undefined) throw new Error("--rewrite takes <old>=<new>");
      out.rewrites.push([from, to]);
    } else throw new Error(`Unknown argument ${arg}`);
  }
  if (!out.from || !out.to) throw new Error("Usage: transfer-bot.mjs --from <data dir> --to <data dir> [--dry-run] [--rewrite old=new]... [--manifest file]");
  if (resolve(out.from) === resolve(out.to)) throw new Error("--from and --to are the same folder");
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const manifest = transferBot(args);
    const text = JSON.stringify(manifest, null, 2);
    if (args.manifest) writeFileSync(args.manifest, `${text}\n`, { mode: 0o600 });
    const rows = Object.entries(manifest.studio.tables).map(([table, r]) => `${table.padEnd(28)} ${r.policy.padEnd(7)} ${String(r.before).padStart(5)} -> ${String(r.after).padStart(5)} (source ${r.source})`);
    console.log([`${manifest.dryRun ? "DRY RUN, nothing written" : "Written"}: ${join(manifest.to, "plugins/studio/data.db")}`, ...rows,
      manifest.automations ? `BB automations ${manifest.automations.before} -> ${manifest.automations.after} (all off; ${manifest.automations.enabledAtSource.length} were on)` : "BB automations: skipped",
      manifest.studio.wasOn ? `Paused: bots ${manifest.studio.wasOn.bots.length}, runners ${manifest.studio.wasOn.runners.length}, Bot automations ${manifest.studio.wasOn.botAutomations.length}` : "States kept",
      `Rewritten: ${JSON.stringify(manifest.studio.rewritten)}; still naming /.bb/: ${JSON.stringify(manifest.studio.leftoverOldPaths)}`].join("\n"));
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
}
