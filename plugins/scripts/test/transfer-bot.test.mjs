import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { transferBot } from "../swap/transfer-bot.mjs";

const SCHEMA = `
  CREATE TABLE _bb_migrations (id INTEGER PRIMARY KEY);
  CREATE TABLE bots (id TEXT PRIMARY KEY, state TEXT NOT NULL, thread_id TEXT, memory_page_id TEXT);
  CREATE TABLE bot_runners (id TEXT PRIMARY KEY, bot_id TEXT, state TEXT NOT NULL, job TEXT NOT NULL, thread_id TEXT);
  CREATE TABLE bot_automations (id TEXT PRIMARY KEY, state TEXT NOT NULL, instruction TEXT NOT NULL);
  CREATE TABLE bot_skills (bot_id TEXT, name TEXT, body TEXT, PRIMARY KEY (bot_id, name));
  CREATE TABLE bot_skill_versions (id TEXT PRIMARY KEY, body TEXT);
  CREATE TRIGGER bot_skill_versions_no_delete BEFORE DELETE ON bot_skill_versions BEGIN SELECT RAISE(ABORT, 'append only'); END;
  CREATE TABLE bot_threads (thread_id TEXT PRIMARY KEY, kind TEXT);
  CREATE TABLE bot_loops (id TEXT PRIMARY KEY, record TEXT);
  CREATE TABLE bot_cache_settings (bot_id TEXT PRIMARY KEY, enabled INTEGER);
  CREATE TABLE memory_records (id TEXT PRIMARY KEY, text TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
  CREATE VIRTUAL TABLE memory_records_fts USING fts5(text, content='memory_records', content_rowid='rowid');
  CREATE TRIGGER memory_records_fts_insert AFTER INSERT ON memory_records BEGIN INSERT INTO memory_records_fts (rowid, text) VALUES (NEW.rowid, NEW.text); END;
  CREATE TRIGGER memory_records_fts_delete AFTER DELETE ON memory_records BEGIN INSERT INTO memory_records_fts (memory_records_fts, rowid, text) VALUES ('delete', OLD.rowid, OLD.text); END;
  CREATE TRIGGER memory_records_fts_update AFTER UPDATE ON memory_records BEGIN INSERT INTO memory_records_fts (memory_records_fts, rowid, text) VALUES ('delete', OLD.rowid, OLD.text); INSERT INTO memory_records_fts (rowid, text) VALUES (NEW.rowid, NEW.text); END;
  CREATE TABLE memory_profiles (bot_id TEXT PRIMARY KEY, markdown TEXT);
  CREATE TABLE triggers (id TEXT PRIMARY KEY, owner TEXT NOT NULL, owner_id TEXT NOT NULL, spec TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'on', lease_until INTEGER);
  CREATE TABLE mini_secrets (id TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT);
`;
const AUTOMATIONS = `
  CREATE TABLE automations (id TEXT PRIMARY KEY, target_thread_id TEXT, enabled INTEGER NOT NULL, next_run_at INTEGER);
  CREATE TABLE automation_runs (id TEXT PRIMARY KEY, automation_id TEXT);
`;

function dataDir(root, name, fill) {
  const dir = join(root, name);
  for (const plugin of ["studio", "automations"]) mkdirSync(join(dir, "plugins", plugin), { recursive: true });
  const studio = new DatabaseSync(join(dir, "plugins/studio/data.db"));
  studio.exec(SCHEMA);
  const automations = new DatabaseSync(join(dir, "plugins/automations/data.db"));
  automations.exec(AUTOMATIONS);
  fill(studio, automations);
  studio.close();
  automations.close();
  return dir;
}

function setup(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "bb-transfer-bot-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const from = dataDir(root, "live", (s, a) => {
    s.exec(`
      INSERT INTO bots VALUES ('bot_main', 'active', 'thr_main', 'pg_live');
      INSERT INTO bot_runners VALUES ('run_a', 'bot_main', 'active', 'read /u/.bb/thread-storage/thr_main/staff/A.md', 'thr_ra'), ('run_b', 'bot_main', 'paused', 'b', 'thr_rb');
      INSERT INTO bot_automations VALUES ('aut_1', 'active', 'check /u/.bb/thread-storage/thr_main/x'), ('aut_2', 'done', 'y');
      INSERT INTO bot_skills VALUES ('bot_main', 'one', 'use /u/.bb/bin/bb'), ('bot_main', 'two', 'b');
      INSERT INTO bot_skill_versions VALUES ('v1', 'a'), ('v2', 'b');
      INSERT INTO bot_threads VALUES ('thr_main', 'conversation'), ('thr_w1', 'worker');
      INSERT INTO bot_loops VALUES ('loop_1', '{}');
      INSERT INTO bot_cache_settings VALUES ('bot_main', 1);
      INSERT INTO memory_records (id, text) VALUES ('mem_1', 'likes tea'), ('mem_2', 'lives in town');
      INSERT INTO memory_profiles VALUES ('bot_main', 'core');
      INSERT INTO triggers VALUES ('trg_runner_run_a', 'runner', 'run_a', '{}', 'on', 123), ('trg_sweep', 'thread-sweeps', 'x', '{}', 'on', NULL);
      INSERT INTO mini_secrets VALUES ('sec', 'TOPSECRET');
      INSERT INTO pages VALUES ('pg_live', 'Live page');
    `);
    a.exec(`INSERT INTO automations VALUES ('auto_1', NULL, 1, 99), ('auto_2', 'thr_t', 1, 99), ('auto_3', NULL, 0, NULL);
            INSERT INTO automation_runs VALUES ('r1', 'auto_1');`);
  });
  const to = dataDir(root, "studio", (s, a) => {
    s.exec(`
      INSERT INTO bots VALUES ('bot_main', 'stopped', 'thr_main', 'pg_fork_split');
      INSERT INTO bot_runners VALUES ('run_a', 'bot_main', 'paused', 'old', 'thr_ra');
      INSERT INTO bot_skill_versions VALUES ('v1', 'a'), ('v_fork', 'f');
      INSERT INTO bot_threads VALUES ('thr_fork_only', 'worker');
      INSERT INTO memory_records (id, text) VALUES ('mem_1', 'likes tea'), ('mem_fork_dup', 'likes tea (split again)');
      INSERT INTO triggers VALUES ('trg_runner_gone', 'runner', 'run_gone', '{}', 'on', NULL), ('trg_fork_own', 'cache-warm', 'y', '{}', 'on', NULL);
      INSERT INTO mini_secrets VALUES ('mine', 'KEEP');
      INSERT INTO pages VALUES ('pg_fork', 'Fork page');
    `);
    a.exec("INSERT INTO automations VALUES ('auto_old', NULL, 0, NULL);");
  });
  return { root, from, to };
}

const read = (dir, sql, plugin = "studio") => {
  const db = new DatabaseSync(join(dir, "plugins", plugin, "data.db"), { readOnly: true });
  try { return db.prepare(sql).all().map((row) => ({ ...row })); } finally { db.close(); }
};

test("copies the Bot tables, paused, and leaves items, secrets and the server's own rows alone", (t) => {
  const { from, to } = setup(t);
  const manifest = transferBot({ from, to, rewrites: [["/u/.bb/thread-storage/", "/u/.bb-studio/thread-storage/"], ["/u/.bb/bin/bb", "/u/.bb-studio/bin/bb"]] });

  assert.deepEqual(read(to, "SELECT id, state, memory_page_id FROM bots"), [{ id: "bot_main", state: "paused", memory_page_id: "pg_live" }]);
  assert.deepEqual(read(to, "SELECT id, state FROM bot_runners ORDER BY id"), [{ id: "run_a", state: "paused" }, { id: "run_b", state: "paused" }]);
  assert.deepEqual(read(to, "SELECT state FROM bot_automations ORDER BY id").map((r) => r.state), ["paused", "done"]);
  assert.deepEqual(manifest.studio.wasOn, { bots: ["bot_main"], runners: ["run_a"], botAutomations: ["aut_1"] });
  assert.equal(read(to, "SELECT enabled FROM bot_cache_settings")[0].enabled, 0);
  // The fork's duplicate memory split is gone, and search follows.
  assert.deepEqual(read(to, "SELECT id FROM memory_records ORDER BY id").map((r) => r.id), ["mem_1", "mem_2"]);
  assert.deepEqual(read(to, "SELECT rowid FROM memory_records_fts WHERE memory_records_fts MATCH 'split'"), []);
  assert.equal(read(to, "SELECT COUNT(*) AS n FROM memory_records_fts WHERE memory_records_fts MATCH 'town'")[0].n, 1);
  // Append-only history gains the source's rows and keeps its own.
  assert.deepEqual(read(to, "SELECT id FROM bot_skill_versions ORDER BY id").map((r) => r.id), ["v1", "v2", "v_fork"]);
  assert.equal(manifest.studio.tables.bot_skill_versions.policy, "append");
  // Merge: the fork's own worker stays.
  assert.deepEqual(read(to, "SELECT thread_id FROM bot_threads ORDER BY 1").map((r) => r.thread_id), ["thr_fork_only", "thr_main", "thr_w1"]);
  // Triggers: the Bot's are exactly the source's (lease cleared); the server's own sweeps stay; the source's sweeps aren't imported.
  assert.deepEqual(read(to, "SELECT id, lease_until FROM triggers ORDER BY id"), [{ id: "trg_fork_own", lease_until: null }, { id: "trg_runner_run_a", lease_until: null }]);
  // Never: secrets and items.
  assert.deepEqual(read(to, "SELECT id, value FROM mini_secrets"), [{ id: "mine", value: "KEEP" }]);
  assert.deepEqual(read(to, "SELECT id FROM pages"), [{ id: "pg_fork" }]);
  // Paths to the old data folder are rewritten.
  assert.match(read(to, "SELECT job FROM bot_runners WHERE id = 'run_a'")[0].job, /\/u\/\.bb-studio\/thread-storage\/thr_main/);
  assert.equal(read(to, "SELECT body FROM bot_skills WHERE name = 'one'")[0].body, "use /u/.bb-studio/bin/bb");
  assert.deepEqual(manifest.studio.leftoverOldPaths, []);
  // BB automations: all of them, all off, and the manifest says which were on.
  assert.deepEqual(read(to, "SELECT id, enabled, next_run_at FROM automations ORDER BY id", "automations"),
    [{ id: "auto_1", enabled: 0, next_run_at: null }, { id: "auto_2", enabled: 0, next_run_at: null }, { id: "auto_3", enabled: 0, next_run_at: null }]);
  assert.deepEqual(manifest.automations.enabledAtSource, ["auto_1", "auto_2"]);
  assert.deepEqual(manifest.automations.targetThreads, ["thr_t"]);
  assert.deepEqual(manifest.studio.runnerThreads, [{ runner: "run_a", thread: "thr_ra" }, { runner: "run_b", thread: "thr_rb" }]);
});

test("a second run changes nothing", (t) => {
  const { from, to } = setup(t);
  transferBot({ from, to });
  const snapshot = () => ["bots", "bot_runners", "bot_automations", "bot_skills", "bot_skill_versions", "bot_threads", "memory_records", "triggers"]
    .map((table) => JSON.stringify(read(to, `SELECT * FROM ${table} ORDER BY 1`)));
  const first = snapshot();
  const again = transferBot({ from, to });
  assert.deepEqual(snapshot(), first);
  // The manifest is the same too: what was on is read from the source each time.
  assert.deepEqual(again.studio.wasOn, { bots: ["bot_main"], runners: ["run_a"], botAutomations: ["aut_1"] });
});

test("a dry run writes nothing", (t) => {
  const { from, to } = setup(t);
  const manifest = transferBot({ from, to, dryRun: true });
  assert.equal(manifest.studio.tables.memory_records.after, 2);
  assert.deepEqual(read(to, "SELECT id, state FROM bots"), [{ id: "bot_main", state: "stopped" }]);
  assert.equal(read(to, "SELECT COUNT(*) AS n FROM memory_records")[0].n, 2);
  assert.deepEqual(read(to, "SELECT id FROM automations", "automations"), [{ id: "auto_old" }]);
});

test("refuses a running target and the same folder, and leaves the source untouched", async (t) => {
  const { from, to } = setup(t);
  const holder = spawnSync("sh", ["-c", "command -v lsof"], { encoding: "utf8" });
  if (holder.status === 0) {
    const script = `const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(${JSON.stringify(join(to, "plugins/studio/data.db"))}); process.stdout.write("open\\n"); setTimeout(() => db.close(), 5000);`;
    const child = spawn(process.execPath, ["--no-warnings", "-e", script], { stdio: ["ignore", "pipe", "ignore"] });
    await new Promise((done) => child.stdout.once("data", done));
    assert.throws(() => transferBot({ from, to }), /is open in process/);
    child.kill();
    await new Promise((done) => child.once("exit", done));
  }
  const script = new URL("../swap/transfer-bot.mjs", import.meta.url).pathname;
  const same = spawnSync(process.execPath, [script, "--from", from, "--to", from], { encoding: "utf8" });
  assert.equal(same.status, 1);
  assert.match(same.stderr, /same folder/);
  const before = JSON.stringify(read(from, "SELECT * FROM bots"));
  const cli = spawnSync(process.execPath, [script, "--from", from, "--to", to], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Paused: bots 1, runners 1, Bot automations 1/);
  assert.equal(JSON.stringify(read(from, "SELECT * FROM bots")), before);
});

test("leaves no write-ahead log behind", (t) => {
  const { from, to } = setup(t);
  const db = new DatabaseSync(join(to, "plugins/studio/data.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.close();
  transferBot({ from, to });
  const wal = join(to, "plugins/studio/data.db-wal");
  assert.ok(!existsSync(wal) || statSync(wal).size === 0);
  transferBot({ from, to });
});
