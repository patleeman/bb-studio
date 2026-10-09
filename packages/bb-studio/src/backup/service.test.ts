import Database from "better-sqlite3";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { restoreDecision, mapProject } from "@bb-studio/kit/backup";
import { backupSectionDir, runBackup, runRestore, type BackupHandlers } from "@bb-studio/kit/server";
import { zipFiles } from "../export-zip";
import { MIGRATIONS } from "../migrations";
import { SpaceStore } from "../spaces";
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
  const spaces = new SpaceStore(sourceDb);
  const tags = new TagStore(sourceDb);
  const services = new StudioServices(sourceDb);
  const space = spaces.create({ name: "Launch" });
  spaces.add(space.id, [{ pluginId: "bb-project", id: "p_old" }]);
  const tag = tags.ensure("draft");
  tags.apply([{ pluginId: "notes", id: "n1" }], [tag.id], []);
  services.addComment({ ref: { pluginId: "notes", id: "n1" }, parentId: null, anchor: null, actor: { kind: "user" }, body: "Check this" });
  services.addVersion({ pluginId: "notes", id: "n1" }, Buffer.from("v1"), "First", { kind: "user" });
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
  new SpaceStore(targetDb);
  const targetNotes = new Map<string, { id: string; title: string; projectId: string | null; updatedAt: number }>();
  let changed = 0;
  const target = new BackupService({
    dataDir: targetDir,
    sdk: bb({ dataDir: targetDir, projects: [{ id: "p_new", name: "App", sources: [{ path: "/code/app", isDefault: true }] }], addOns: { notes: notesAddOn(targetNotes) }, installed: ["notes"] }),
    bbVersion: async () => null,
    studioData: studioDataBackup(targetDb, { threadExists: async () => false, changed: () => changed++ }),
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
  const restoredSpace = new SpaceStore(targetDb).find("Launch")!;
  expect(restoredSpace.projectIds).toEqual(["p_new"]);
  const targetServices = new StudioServices(targetDb);
  expect(targetServices.comments({ pluginId: "notes", id: "n1" }).map((comment) => comment.body)).toEqual(["Check this"]);
  expect(Buffer.from(targetServices.versionBytes({ pluginId: "notes", id: "n1" }, targetServices.versions({ pluginId: "notes", id: "n1" })[0]!.id)!).toString()).toBe("v1");
  expect(changed).toBe(1);

  const again = await target.restore(file, { dryRun: false });
  for (const section of again.sections.filter((each) => each.report)) expect(section.report).toMatchObject({ created: 0, updated: 0, failed: 0 });
  expect(targetNotes.size).toBe(2);
  expect(new TagStore(targetDb).list()).toHaveLength(1);
  expect(new SpaceStore(targetDb).list()).toHaveLength(2);
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

it("restores the Chief of Staff as the default space's lead, from new backups and old chief-of-staff.json, only into an empty slot", async () => {
  const sourceDir = await temp();
  const sourceDb = studioDb();
  const top = new SpaceStore(sourceDb).list().find((space) => space.isDefault)!.id;
  sourceDb.prepare("INSERT INTO space_leads (space_id, lead_thread_id, created_at, updated_at) VALUES (?, 'thr_chief', 1, 5)").run(top);
  sourceDb.prepare("INSERT INTO space_runs (space_id, enabled, cadence, time, cron, automation_id, automation_project_id) VALUES (?, 1, 'daily', '08:30', NULL, 'a1', 'p')").run(top);
  const service = (dir: string, db: Database.Database, exists: boolean) => new BackupService({
    dataDir: dir, sdk: bb({ dataDir: dir, projects: [], addOns: {}, installed: [] }), bbVersion: async () => null,
    studioData: studioDataBackup(db, { threadExists: async () => exists }),
  });
  const file = join(sourceDir, "backup.zip");
  await service(sourceDir, sourceDb, true).backup(file);
  const leadOf = (db: Database.Database) => db.prepare("SELECT l.lead_thread_id FROM space_leads l JOIN spaces s ON s.id = l.space_id WHERE s.is_default = 1").get();

  // A new backup: the default space's lead, restored even over an empty lead row, heartbeat off.
  const targetDb = studioDb();
  const targetTop = new SpaceStore(targetDb).list().find((space) => space.isDefault)!.id;
  targetDb.prepare("INSERT INTO space_leads (space_id, lead_thread_id, created_at, updated_at) VALUES (?, NULL, 1, 1)").run(targetTop);
  await service(await temp(), targetDb, true).restore(file, { dryRun: false });
  expect(leadOf(targetDb)).toEqual({ lead_thread_id: "thr_chief" });
  expect(targetDb.prepare("SELECT enabled, cadence, time, automation_id FROM space_runs WHERE space_id = ?").get(targetTop)).toEqual({ enabled: 0, cadence: "daily", time: "08:30", automation_id: null });

  // An older backup: no lead in spaces.json, the Chief of Staff in chief-of-staff.json.
  const files = await Promise.all((await readZip(file)).map(async (entry) => {
    let bytes = await readEntry(file, entry);
    if (entry.name.endsWith("/spaces.json")) bytes = Buffer.from(JSON.stringify(JSON.parse(bytes.toString()).map((space: Record<string, unknown>) => ({ ...space, lead: null, run: null }))));
    if (entry.name.endsWith("/chief-of-staff.json")) bytes = Buffer.from(JSON.stringify([{ thread_id: "thr_old", origin_space_id: null, updated_at: 5, run: { cadence: "hourly", time: "09:00", cron: null } }]));
    return { name: entry.name, bytes };
  }));
  expect(files.some((entry) => entry.name.endsWith("/chief-of-staff.json"))).toBe(true);
  const old = join(sourceDir, "old.zip");
  await writeFile(old, zipFiles(files));
  const oldDb = studioDb();
  const oldTop = new SpaceStore(oldDb).list().find((space) => space.isDefault)!.id;
  await service(await temp(), oldDb, true).restore(old, { dryRun: false });
  expect(leadOf(oldDb)).toEqual({ lead_thread_id: "thr_old" });
  expect(oldDb.prepare("SELECT space_id FROM space_threads WHERE thread_id = 'thr_old'").get()).toEqual({ space_id: oldTop });
  expect(oldDb.prepare("SELECT enabled, cadence FROM space_runs WHERE space_id = ?").get(oldTop)).toEqual({ enabled: 0, cadence: "hourly" });

  const missingDb = studioDb();
  new SpaceStore(missingDb);
  await service(await temp(), missingDb, false).restore(old, { dryRun: false });
  expect(leadOf(missingDb)).toBeUndefined();

  const takenDb = studioDb();
  const takenTop = new SpaceStore(takenDb).list().find((space) => space.isDefault)!.id;
  takenDb.prepare("INSERT INTO space_leads (space_id, lead_thread_id, created_at, updated_at) VALUES (?, 'thr_local', 1, 9)").run(takenTop);
  await service(await temp(), takenDb, true).restore(old, { dryRun: false });
  await service(await temp(), takenDb, true).restore(file, { dryRun: false });
  expect(leadOf(takenDb)).toEqual({ lead_thread_id: "thr_local" });
});
