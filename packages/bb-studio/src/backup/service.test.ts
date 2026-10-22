import Database from "better-sqlite3";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { restoreDecision, mapProject } from "../kit/backup";
import { backupSectionDir, runBackup, runRestore, type BackupHandlers } from "../kit/server/index";
import { zipFiles } from "../export-zip";
import { MIGRATIONS } from "../migrations";
import { TagStore } from "../tags";
import { StudioServices } from "../services";
import { BackupService, formatRestore, mapProjects, restoreFailed } from "./service";
import { studioDataBackup } from "./studio-data";
import { readEntry, readZip } from "./zip";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "studio-backup-"));
  dirs.push(dir);
  return dir;
}

function studioDb() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return db;
}

/** A stand-in add-on keeping notes in memory, restoring by id. */
function notesAddOn(notes: Map<string, { id: string; title: string; projectId: string | null; updatedAt: number }>): BackupHandlers {
  return {
    version: 1,
    async backup(writer) {
      for (const note of notes.values()) await writer.json(`items/${note.id}.json`, note);
      return { counts: { notes: notes.size } };
    },
    async restore(reader, { dryRun, projects, tally }) {
      for (const name of await reader.list("items")) {
        const note = await reader.json<{ id: string; title: string; projectId: string | null; updatedAt: number }>(`items/${name}`);
        const decision = restoreDecision(notes.get(note.id)?.updatedAt, note.updatedAt);
        tally.decided(decision, note);
        const mapped = mapProject(projects, note.projectId);
        if (mapped.unmapped && (decision === "create" || decision === "update")) tally.unmapped(note);
        if (!dryRun && (decision === "create" || decision === "update")) notes.set(note.id, { ...note, projectId: mapped.projectId });
      }
    },
  };
}

function bb(options: {
  dataDir: string;
  projects: { id: string; name: string; kind?: string; sources: { path: string; isDefault?: boolean }[] }[];
  addOns: Record<string, BackupHandlers>;
  installed: string[];
}) {
  return {
    plugins: {
      list: async () => ({ plugins: options.installed.map((id) => ({ id, name: id, enabled: true, version: "0.1.0" })) }),
      experimental_discoverRpc: async () => Object.keys(options.addOns).map((pluginId) => ({ pluginId })),
      async callRpc({ pluginId, method, input }: { pluginId: string; method: string; input?: unknown }) {
        const handlers = options.addOns[pluginId]!;
        const { session, ...rest } = input as { session: string; dryRun: boolean; version: number; projects: Record<string, string | null> };
        const dir = backupSectionDir(options.dataDir, session, pluginId);
        return method === "studio_backup" ? runBackup(dir, handlers) : runRestore(dir, handlers, rest);
      },
    },
    projects: { list: async () => options.projects },
  };
}

it("maps projects by id, Personal, path, then a unique name", () => {
  const local = [
    { id: "proj_personal_here", name: "Personal", kind: "personal", sources: [] },
    { id: "p_path", name: "Renamed", sources: [{ path: "/code/app", isDefault: true }] },
    { id: "p_name", name: "Notes", sources: [{ path: "/elsewhere" }] },
    { id: "p_same", name: "Same", sources: [] },
  ];
  expect(mapProjects([
    { id: "p_same", name: "x", path: null, personal: false },
    { id: "proj_personal", name: "Personal", path: null, personal: true },
    { id: "p1", name: "App", path: "/code/app", personal: false },
    { id: "p2", name: "notes", path: "/old/notes", personal: false },
    { id: "p3", name: "Gone", path: "/gone", personal: false },
  ], local)).toEqual({ p_same: "p_same", proj_personal: "proj_personal_here", p1: "p_path", p2: "p_name", p3: null });
});

it("backs up every add-on and Studio's data, then restores it on another BB without duplicates", async () => {
  const sourceDir = await temp();
  const sourceDb = studioDb();
  const tags = new TagStore(sourceDb);
  const services = new StudioServices(sourceDb);
  sourceDb.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES ('p_old', 'thr_lead', 1, 1)").run();
  sourceDb.prepare("INSERT INTO project_runs (project_id, enabled, cadence, time, cron, automation_id, automation_project_id) VALUES ('p_old', 1, 'daily', '09:00', NULL, 'a1', 'p_old')").run();
  const tag = tags.ensure("draft");
  tags.apply([{ pluginId: "notes", id: "n1" }], [tag.id], []);
  services.addComment({ ref: { pluginId: "notes", id: "n1" }, parentId: null, anchor: null, actor: { kind: "user" }, body: "Check this" });
  services.addVersion({ pluginId: "notes", id: "n1" }, Buffer.from("v1"), "First", { kind: "user" });
  services.linkThread({ threadId: "thr_saved", ref: { pluginId: "notes", id: "n1" }, role: "created", state: "idle", createdAt: 1, updatedAt: 1, metadata: {} });
  services.replaceLinks({ pluginId: "notes", id: "n1" }, "notes", [{ from: { pluginId: "notes", id: "n1" }, to: { pluginId: "notes", id: "n2" }, kind: "related", source: "notes" }]);
  const sourceNotes = new Map([
    ["n1", { id: "n1", title: "Plan", projectId: "p_old", updatedAt: 10 }],
    ["n2", { id: "n2", title: "Elsewhere", projectId: "p_gone", updatedAt: 10 }],
  ]);
  const source = new BackupService({
    dataDir: sourceDir,
    sdk: bb({
      dataDir: sourceDir,
      projects: [{ id: "p_old", name: "App", sources: [{ path: "/code/app", isDefault: true }] }, { id: "p_gone", name: "Gone", sources: [{ path: "/gone" }] }],
      addOns: { notes: notesAddOn(sourceNotes) },
      installed: ["notes", "talk"],
    }),
    bbVersion: async () => "0.44.0",
    studioData: studioDataBackup(sourceDb, { threadExists: async () => true }),
  });
  const file = join(sourceDir, "out", "backup.zip");
  const made = await source.backup(file);
  const byId = Object.fromEntries(made.manifest.sections.map((section) => [section.pluginId, section]));
  expect(byId.notes).toMatchObject({ status: "included", counts: { notes: 2 } });
  expect(byId.talk).toMatchObject({ status: "skipped" });
  expect(byId.pages).toMatchObject({ status: "skipped", reason: "Not installed on this BB." });
  expect(byId.studio).toMatchObject({ status: "included" });
  expect(made.manifest.excluded.map((entry) => entry.what)).toContain("Studio Code workspaces");
  const entries = await readZip(file);
  expect(entries[0]!.name).toBe("manifest.json");
  expect(JSON.parse((await readEntry(file, entries[0]!)).toString()).bb.version).toBe("0.44.0");

  // A new computer: different project ids, an empty Studio.
  const targetDir = await temp();
  const targetDb = studioDb();
  for (const table of ["item_links", "item_threads", "item_comments", "item_blobs", "item_versions"]) {
    targetDb.exec(`ALTER TABLE ${table} ADD COLUMN future TEXT NOT NULL DEFAULT ''`);
  }
  const targetNotes = new Map<string, { id: string; title: string; projectId: string | null; updatedAt: number }>();
  let changed = 0;
  const target = new BackupService({
    dataDir: targetDir,
    sdk: bb({ dataDir: targetDir, projects: [{ id: "p_new", name: "App", sources: [{ path: "/code/app", isDefault: true }] }], addOns: { notes: notesAddOn(targetNotes) }, installed: ["notes"] }),
    bbVersion: async () => null,
    studioData: studioDataBackup(targetDb, { threadExists: async (id) => id === "thr_saved", changed: () => changed++ }),
  });

  const plan = await target.restore(file, { dryRun: true });
  expect(targetNotes.size).toBe(0);
  expect(new TagStore(targetDb).list()).toEqual([]);
  expect(plan.sections.find((section) => section.pluginId === "notes")?.report).toMatchObject({ created: 2, unmapped: 1 });
  expect(plan.projects.unmapped).toEqual([{ name: "Gone", path: "/gone" }]);
  expect(formatRestore(plan)).toMatch(/Dry run/);

  const done = await target.restore(file, { dryRun: false });
  expect(restoreFailed(done)).toBe(false);
  expect(targetNotes.get("n1")?.projectId).toBe("p_new");
  expect(targetNotes.get("n2")?.projectId).toBeNull();
  const restoredTag = new TagStore(targetDb).list().find((each) => each.name === "draft")!;
  expect(new TagStore(targetDb).assignments().get("notes:n1")).toEqual([restoredTag.id]);
  // The lead's thread isn't on this BB; its heartbeat settings come back, off.
  expect(targetDb.prepare("SELECT * FROM project_leads").all()).toEqual([]);
  expect(targetDb.prepare("SELECT project_id, enabled, cadence, automation_id FROM project_runs").all()).toEqual([{ project_id: "p_new", enabled: 0, cadence: "daily", automation_id: null }]);
  const targetServices = new StudioServices(targetDb);
  expect(targetServices.comments({ pluginId: "notes", id: "n1" }).map((comment) => comment.body)).toEqual(["Check this"]);
  expect(Buffer.from(targetServices.versionBytes({ pluginId: "notes", id: "n1" }, targetServices.versions({ pluginId: "notes", id: "n1" })[0]!.id)!).toString()).toBe("v1");
  expect(changed).toBe(1);

  const again = await target.restore(file, { dryRun: false });
  for (const section of again.sections.filter((each) => each.report)) expect(section.report).toMatchObject({ created: 0, updated: 0, failed: 0 });
  expect(targetNotes.size).toBe(2);
  expect(new TagStore(targetDb).list()).toHaveLength(1);
  expect(targetServices.comments({ pluginId: "notes", id: "n1" })).toHaveLength(1);
});

it("refuses files that aren't Studio backups or come from a newer Studio", async () => {
  const dir = await temp();
  const service = new BackupService({
    dataDir: dir,
    sdk: bb({ dataDir: dir, projects: [], addOns: {}, installed: [] }),
    bbVersion: async () => null,
    studioData: studioDataBackup(studioDb(), { threadExists: async () => false }),
  });
  const write = async (name: string, files: { name: string; bytes: Buffer }[]) => {
    const file = join(dir, name);
    await writeFile(file, zipFiles(files));
    return file;
  };
  await expect(service.restore(await write("none.zip", [{ name: "a.txt", bytes: Buffer.from("x") }]), { dryRun: true })).rejects.toThrow(/no manifest/);
  await expect(service.restore(await write("other.zip", [{ name: "manifest.json", bytes: Buffer.from("{\"format\":\"other\"}") }]), { dryRun: true })).rejects.toThrow(/isn't a BB Studio backup/);
  await expect(service.restore(await write("newer.zip", [{ name: "manifest.json", bytes: Buffer.from("{\"format\":\"bb-studio-backup\",\"version\":99}") }]), { dryRun: true })).rejects.toThrow(/newer Studio/);
  await expect(service.restore(join(dir, "missing.zip"), { dryRun: true })).rejects.toThrow(/No backup file/);
  expect(await readFile(join(dir, "none.zip"))).toBeTruthy();
});

it("restores the Chief of Staff as the personal project's lead, from new backups and old chief-of-staff.json, only into an empty slot, ignoring old spaces", async () => {
  const sourceDir = await temp();
  const sourceDb = studioDb();
  sourceDb.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES ('proj_personal', 'thr_chief', 1, 5)").run();
  sourceDb.prepare("INSERT INTO project_runs (project_id, enabled, cadence, time, cron, automation_id, automation_project_id) VALUES ('proj_personal', 1, 'daily', '08:30', NULL, 'a1', 'p')").run();
  const service = (dir: string, db: Database.Database, exists: boolean) => new BackupService({
    dataDir: dir, sdk: bb({ dataDir: dir, projects: [], addOns: {}, installed: [] }), bbVersion: async () => null,
    studioData: studioDataBackup(db, { threadExists: async () => exists }),
  });
  const file = join(sourceDir, "backup.zip");
  await service(sourceDir, sourceDb, true).backup(file);
  const leadOf = (db: Database.Database) => db.prepare("SELECT lead_thread_id FROM project_leads WHERE project_id = 'proj_personal'").get();

  // A new backup: restored even over an empty lead row, heartbeat off.
  const targetDb = studioDb();
  targetDb.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES ('proj_personal', NULL, 1, 1)").run();
  await service(await temp(), targetDb, true).restore(file, { dryRun: false });
  expect(leadOf(targetDb)).toEqual({ lead_thread_id: "thr_chief" });
  expect(targetDb.prepare("SELECT enabled, cadence, time, automation_id FROM project_runs WHERE project_id = 'proj_personal'").get()).toEqual({ enabled: 0, cadence: "daily", time: "08:30", automation_id: null });

  // An older backup: Spaces in spaces.json (ignored), the Chief of Staff in chief-of-staff.json.
  const files = await Promise.all((await readZip(file)).filter((entry) => !entry.name.endsWith("/project-leads.json")).map(async (entry) => {
    let bytes = await readEntry(file, entry);
    if (entry.name.endsWith("/chief-of-staff.json")) bytes = Buffer.from(JSON.stringify([{ thread_id: "thr_old", origin_space_id: null, updated_at: 5, run: { cadence: "hourly", time: "09:00", cron: null } }]));
    return { name: entry.name, bytes };
  }));
  const dir = files.find((entry) => entry.name.endsWith("/chief-of-staff.json"))!.name.replace(/chief-of-staff\.json$/, "");
  files.push({ name: `${dir}spaces.json`, bytes: Buffer.from(JSON.stringify([{ id: "spc_x", name: "Launch", lead: { lead_thread_id: "thr_space_lead" } }])) });
  const old = join(sourceDir, "old.zip");
  await writeFile(old, zipFiles(files));
  const oldDb = studioDb();
  await service(await temp(), oldDb, true).restore(old, { dryRun: false });
  expect(leadOf(oldDb)).toEqual({ lead_thread_id: "thr_old" });
  expect(oldDb.prepare("SELECT enabled, cadence FROM project_runs WHERE project_id = 'proj_personal'").get()).toEqual({ enabled: 0, cadence: "hourly" });
  expect(oldDb.prepare("SELECT COUNT(*) AS n FROM spaces").get()).toEqual({ n: 0 });

  const missingDb = studioDb();
  await service(await temp(), missingDb, false).restore(old, { dryRun: false });
  expect(leadOf(missingDb)).toBeUndefined();

  const takenDb = studioDb();
  takenDb.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES ('proj_personal', 'thr_local', 1, 9)").run();
  await service(await temp(), takenDb, true).restore(old, { dryRun: false });
  await service(await temp(), takenDb, true).restore(file, { dryRun: false });
  expect(leadOf(takenDb)).toEqual({ lead_thread_id: "thr_local" });
});

it("backs up the Bot and its skills, and restores them only when this BB has no Bot", async () => {
  const sourceDir = await temp();
  const sourceDb = studioDb();
  sourceDb.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES ('proj_personal', 'thr_bot', 1, 5)").run();
  sourceDb.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, memory_page_id, shape, color, role, created_at, updated_at) VALUES ('bot_main', 'Dot', '🟣', 'paused', 'thr_bot', 1, 'pg_memory', 'star', '#e5484d', 'My chief of staff.', 1, 2)").run();
  sourceDb.prepare("INSERT INTO bot_skills (bot_id, name, description, body, created_at, updated_at) VALUES ('bot_main', 'weekly-review', 'Fridays', 'Steps', 1, 2)").run();
  const service = (dir: string, db: Database.Database) => new BackupService({
    dataDir: dir, sdk: bb({ dataDir: dir, projects: [], addOns: {}, installed: [] }), bbVersion: async () => null,
    studioData: studioDataBackup(db, { threadExists: async () => true }),
  });
  const file = join(sourceDir, "backup.zip");
  await service(sourceDir, sourceDb).backup(file);

  const targetDb = studioDb();
  await service(await temp(), targetDb).restore(file, { dryRun: false });
  expect(targetDb.prepare("SELECT name, avatar, state, thread_id, memory_page_id, shape, color, role FROM bots").get()).toEqual({ name: "Dot", avatar: "🟣", state: "paused", thread_id: "thr_bot", memory_page_id: "pg_memory", shape: "star", color: "#e5484d", role: "My chief of staff." });
  expect(targetDb.prepare("SELECT name, description, body FROM bot_skills").all()).toEqual([{ name: "weekly-review", description: "Fridays", body: "Steps" }]);

  const takenDb = studioDb();
  takenDb.prepare("INSERT INTO bots (id, name, avatar, state, created_at, updated_at) VALUES ('bot_main', 'Mine', '🤖', 'active', 1, 1)").run();
  await service(await temp(), takenDb).restore(file, { dryRun: false });
  expect(takenDb.prepare("SELECT name FROM bots").all()).toEqual([{ name: "Mine" }]);
});

it("reports skipped included sections as unresolved, but not sections absent from the backup", async () => {
  const dataDir = await temp();
  const studioData = studioDataBackup(studioDb(), { threadExists: async () => false });
  const source = new BackupService({ dataDir, sdk: bb({ dataDir, projects: [], addOns: { notes: notesAddOn(new Map()) }, installed: ["notes"] }), bbVersion: async () => null, studioData });
  const file = join(dataDir, "backup.zip");
  await source.backup(file);
  const target = new BackupService({ dataDir, sdk: bb({ dataDir, projects: [], addOns: {}, installed: [] }), bbVersion: async () => null, studioData });
  const result = await target.restore(file, { dryRun: false });
  expect(result.sections.find((section) => section.pluginId === "notes")).toMatchObject({ status: "skipped", unresolved: true });
  expect(restoreFailed(result)).toBe(true);
  expect(restoreFailed({ ...result, sections: result.sections.filter((section) => section.pluginId !== "notes") })).toBe(false);
});
