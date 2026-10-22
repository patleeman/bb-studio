import { createHash } from "node:crypto";
import { BackupWriter } from "../kit/server/index";
import Database from "better-sqlite3";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runBackup, runRestore } from "../kit/server/index";
import { MIGRATIONS } from "../migrations";
import { studioDataBackup } from "./studio-data";

const dbs: Database.Database[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
function database() {
  const db = new Database(":memory:");
  dbs.push(db);
  for (const migration of MIGRATIONS) db.exec(migration);
  return db;
}
async function folder() {
  const dir = await mkdtemp(join(tmpdir(), "studio-bots-backup-"));
  dirs.push(dir);
  return dir;
}
const lead = (db: Database.Database, threadId: string) => db.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES ('proj_personal', ?, 1, 2)").run(threadId);
const bots = (db: Database.Database) => db.prepare("SELECT id, thread_id, provider_id FROM bots ORDER BY id").all();

it("round-trips each Bot's conversation and provider, including additional and external Bots", async () => {
  const source = database();
  lead(source, "thr_main");
  const insert = source.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, provider_id, created_at, updated_at) VALUES (?, ?, '🤖', 'paused', ?, ?, ?, 2)");
  insert.run("bot_main", "Main", "thr_main", "codex", 1);
  insert.run("bot_extra", "Extra", "thr_extra", "claude-code", 2);
  insert.run("bot_external", "External", "thr_external", "hermes", 3);
  const dir = join(await folder(), "studio");
  const backup = await runBackup(dir, studioDataBackup(source, { threadExists: async () => true }));
  const target = database();
  const checked: string[] = [];
  const handlers = studioDataBackup(target, { threadExists: async (id) => { checked.push(id); return true; } });
  const input = { version: backup.version, projects: {} };
  await runRestore(dir, handlers, { ...input, dryRun: true });
  expect(bots(target)).toEqual([]);
  expect(new Set(checked)).toEqual(new Set(["thr_main", "thr_extra", "thr_external"]));
  await runRestore(dir, handlers, { ...input, dryRun: false });
  expect(bots(target)).toEqual(bots(source));
  expect(backup.version).toBe(3);
  await runRestore(dir, handlers, { ...input, dryRun: false });
  expect(bots(target)).toEqual(bots(source));

  // Missing conversations never make additional Bots borrow the primary's.
  for (const mainExists of [true, false]) {
    const missing = database();
    await runRestore(dir, studioDataBackup(missing, { threadExists: async (id) => mainExists && id === "thr_main" }), { ...input, dryRun: false });
    expect(bots(missing)).toEqual([
      { id: "bot_external", thread_id: null, provider_id: "hermes" },
      { id: "bot_extra", thread_id: null, provider_id: "claude-code" },
      { id: "bot_main", thread_id: mainExists ? "thr_main" : null, provider_id: "codex" },
    ]);
  }
});

it.each(["bot_main", "bot_old"])("restores version 1 Bot records without thread/provider fields (primary %s)", async (primaryId) => {
  const dir = await folder();
  await writeFile(join(dir, "bots.json"), JSON.stringify([
    { id: primaryId, name: "Main", avatar: "🤖", state: "paused", memory_page_id: null, created_at: 1, updated_at: 2 },
    { id: "bot_extra", name: "Extra", avatar: "🤖", state: "paused", memory_page_id: null, created_at: 2, updated_at: 2 },
  ]));
  await writeFile(join(dir, "project-leads.json"), JSON.stringify([{ project_id: "proj_personal", lead_thread_id: "thr_main", created_at: 1, updated_at: 2, run: null }]));
  const target = database();
  await runRestore(dir, studioDataBackup(target, { threadExists: async () => true }), { version: 1, projects: {}, dryRun: false });
  expect(target.prepare("SELECT thread_id, provider_id FROM bots WHERE id = ?").get(primaryId)).toEqual({ thread_id: "thr_main", provider_id: null });
  expect(target.prepare("SELECT thread_id, provider_id FROM bots WHERE id = 'bot_extra'").get()).toEqual({ thread_id: null, provider_id: null });
});

it("uses the primary Bot's own verified thread only when the personal lead slot is empty", async () => {
  const source = database();
  source.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, provider_id, created_at, updated_at) VALUES ('bot_main', 'Main', '🤖', 'paused', 'thr_main', 'codex', 1, 2)").run();
  const dir = join(await folder(), "studio");
  const backup = await runBackup(dir, studioDataBackup(source, { threadExists: async () => true }));
  for (const existingLead of [null, "thr_local"]) {
    const target = database();
    if (existingLead) lead(target, existingLead);
    await runRestore(dir, studioDataBackup(target, { threadExists: async () => true }), { version: backup.version, projects: {}, dryRun: false });
    expect(target.prepare("SELECT lead_thread_id FROM project_leads WHERE project_id = 'proj_personal'").get()).toEqual({ lead_thread_id: existingLead ?? "thr_main" });
    expect(bots(target)).toEqual([{ id: "bot_main", thread_id: existingLead ?? "thr_main", provider_id: "codex" }]);
  }
});

it("keeps a primary Bot conversation assigned to another project's lead in place", async () => {
  const source = database();
  source.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, provider_id, created_at, updated_at) VALUES ('bot_main', 'Main', '🤖', 'paused', 'thr_main', 'codex', 1, 2)").run();
  const dir = join(await folder(), "studio");
  const backup = await runBackup(dir, studioDataBackup(source, { threadExists: async () => true }));
  const target = database();
  target.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES ('proj_other', 'thr_main', 1, 2)").run();
  const result = await runRestore(dir, studioDataBackup(target, { threadExists: async () => true }), { version: backup.version, projects: {}, dryRun: false });
  expect(target.prepare("SELECT project_id, lead_thread_id FROM project_leads").all()).toEqual([{ project_id: "proj_other", lead_thread_id: "thr_main" }]);
  expect(bots(target)).toEqual([{ id: "bot_main", thread_id: null, provider_id: "codex" }]);
  expect(result.notes).toContain("The primary Bot's conversation already leads another project here; it was left unattached.");
});

it("preserves all current skill fields and reads old skill records", async () => {
  const source = database();
  source.exec("INSERT INTO bots (id, name, avatar, state, created_at, updated_at) VALUES ('bot_main', 'Main', 'B', 'paused', 1, 2)");
  source.exec(`INSERT INTO bot_skills (bot_id, name, description, body, created_at, updated_at, state, pinned, used_at, lint_warnings)
    VALUES ('bot_main', 'deploy', 'Deploy', 'Steps', 1, 2, 'archived', 1, 42, '["Check target"]')`);
  const dir = join(await folder(), "studio");
  await runBackup(dir, studioDataBackup(source, { threadExists: async () => true }));
  const target = database();
  await runRestore(dir, studioDataBackup(target, { threadExists: async () => true }), { version: 1, projects: {}, dryRun: false });
  expect(target.prepare("SELECT * FROM bot_skills").all()).toEqual(source.prepare("SELECT * FROM bot_skills").all());
  await writeFile(join(dir, "bot-skills.json"), JSON.stringify([{ bot_id: "bot_main", name: "old", description: "Old", body: "Steps", created_at: 1, updated_at: 2 }]));
  await runRestore(dir, studioDataBackup(target, { threadExists: async () => true }), { version: 1, projects: {}, dryRun: false });
  expect(target.prepare("SELECT state, pinned, used_at, lint_warnings FROM bot_skills WHERE name = 'old'").get()).toEqual({ state: "active", pinned: 0, used_at: null, lint_warnings: "[]" });
});

it("captures version blobs before the writer yields to deletion", async () => {
  const db = database();
  const bytes = Buffer.from("version content");
  const sha = createHash("sha256").update(bytes).digest("hex");
  db.prepare("INSERT INTO item_blobs (sha256, bytes) VALUES (?, ?)").run(sha, bytes);
  db.prepare("INSERT INTO item_versions (id, plugin_id, item_id, sha256, label, actor, created_at) VALUES ('v1', 'pages', 'p1', ?, 'Saved', '{}', 1)").run(sha);
  const dir = join(await folder(), "studio");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(dir));
  class Deleting extends BackupWriter {
    override async json(...args: Parameters<BackupWriter["json"]>) {
      db.exec("DELETE FROM item_versions; DELETE FROM item_blobs");
      return super.json(...args);
    }
  }
  await studioDataBackup(db, { threadExists: async () => true }).backup(new Deleting(dir));
  const target = database();
  const report = await runRestore(dir, studioDataBackup(target, { threadExists: async () => true }), { version: 1, projects: {}, dryRun: false });
  expect(report.failed).toBe(0);
  expect(target.prepare("SELECT bytes FROM item_blobs WHERE sha256 = ?").get(sha)).toEqual({ bytes });
});

it("fails unavailable thread checks before restoring any links or Bots, and can retry", async () => {
  const source = database();
  lead(source, "thr_main");
  const dir = join(await folder(), "studio");
  const backup = await runBackup(dir, studioDataBackup(source, { threadExists: async () => true }));
  const target = database();
  await expect(runRestore(dir, studioDataBackup(target, { threadExists: async () => { throw new Error("offline"); } }), { version: backup.version, projects: {}, dryRun: false })).rejects.toThrow("offline");
  expect(target.prepare("SELECT * FROM project_leads").all()).toEqual([]);
  await runRestore(dir, studioDataBackup(target, { threadExists: async () => true }), { version: backup.version, projects: {}, dryRun: false });
  expect(target.prepare("SELECT lead_thread_id FROM project_leads").all()).toEqual([{ lead_thread_id: "thr_main" }]);
});

it("omits only confirmed missing threads during restore", async () => {
  const source = database();
  lead(source, "thr_missing");
  const dir = join(await folder(), "studio");
  const backup = await runBackup(dir, studioDataBackup(source, { threadExists: async () => true }));
  const target = database();
  const result = await runRestore(dir, studioDataBackup(target, { threadExists: async () => { throw { status: 404 }; } }), { version: backup.version, projects: {}, dryRun: false });
  expect(result.notes.join(" ")).toContain("isn't");
  expect(target.prepare("SELECT * FROM project_leads").all()).toEqual([]);
});
