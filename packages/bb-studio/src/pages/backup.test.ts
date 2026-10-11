import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackup, runRestore } from "@bb-studio/kit/server";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as Y from "yjs";
import { pagesBackup, type BackupHub } from "./backup";
import { createThread, listThreads } from "./comments";
import { readMarkdown, seedMarkdown, textBlocks } from "./doc";
import { MIGRATIONS, PageStore } from "./store";

let root: string;
const dbs: Database.Database[] = [];

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "pages-backup-")); });
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  rmSync(root, { recursive: true, force: true });
});

function open(name: string) {
  const db = new Database(join(root, `${name}.sqlite`));
  dbs.push(db);
  for (const sql of MIGRATIONS) db.exec(sql);
  return { db, store: new PageStore(db, () => 0) };
}

async function seed() {
  const source = open("source");
  const { store, db } = source;
  const parent = store.create({ projectId: "proj_a", parentId: null, title: "Plan", actor: "user" });
  const child = store.create({ projectId: "proj_a", parentId: parent.id, title: "Notes", actor: "user" });
  const doc = new Y.Doc();
  seedMarkdown(doc, "Budget is 10k\n");
  await createThread(doc, "user", { block: textBlocks(doc)[0]!.id, text: "Final?" }, "user");
  store.saveContent(parent.id, Y.encodeStateAsUpdate(doc), readMarkdown(doc), "user");
  store.addSnapshot(parent.id, Y.encodeStateAsUpdate(doc), "First", "user");
  store.addFile(parent.id, "a.png", "image/png", new Uint8Array([1, 2, 3]));
  store.setTemplate(child.id, true);
  store.addChat(parent.id, "thr_gone");
  // Fixed times so a later run compares equal.
  db.prepare("UPDATE pages SET updated_at = 1000").run();
  return { ...source, parent: parent.id, child: child.id };
}

async function backup(db: Database.Database) {
  const dir = join(root, "section");
  rmSync(dir, { recursive: true, force: true });
  const result = await runBackup(dir, pagesBackup({ db }));
  return { dir, result };
}

const restore = (dir: string, db: Database.Database, options: { dryRun?: boolean; projects?: Record<string, string | null>; hub?: BackupHub; events?: unknown[] } = {}) =>
  runRestore(dir, pagesBackup({ db, hub: options.hub, publish: (event) => options.events?.push(event) }), {
    dryRun: options.dryRun ?? false,
    version: 1,
    projects: options.projects ?? { proj_a: "proj_a" },
  });

const state = (store: PageStore, id: string) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, store.get(id)!.state!);
  return doc;
};

it("round-trips pages, versions, files and comments into an empty store, and a re-run changes nothing", async () => {
  const { db, parent, child } = await seed();
  const { dir, result } = await backup(db);
  expect(result.counts).toEqual({ pages: 2, versions: 1, files: 1 });
  expect(result.notes[0]).toMatch(/chats/);

  const target = open("target");
  const events: unknown[] = [];
  const report = await restore(dir, target.db, { events });
  expect(report).toMatchObject({ created: 2, updated: 0, failed: 0, unmapped: 0 });
  expect(events).toContainEqual({ type: "page", pageId: parent });

  const doc = state(target.store, parent);
  expect(readMarkdown(doc)).toContain("Budget is 10k");
  expect(listThreads(doc)[0]!.comments[0]!.text).toBe("Final?");
  expect(target.store.get(parent)!.markdown).toContain("Budget is 10k");
  expect(target.store.snapshots(parent).map((snap) => snap.label)).toEqual(["First"]);
  expect([...target.store.files(parent)[0]!.data]).toEqual([1, 2, 3]);
  expect(target.store.meta(child)).toMatchObject({ parent_id: parent, project_id: "proj_a", template: 1, updated_at: 1000 });
  expect(target.store.chats(parent)).toEqual([]);

  const again = await restore(dir, target.db);
  expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2, failed: 0 });
  expect(target.store.snapshots(parent)).toHaveLength(1);
  expect(target.store.files(parent)).toHaveLength(1);
});

it("keeps a newer local page and updates an older one", async () => {
  const { db, parent, child } = await seed();
  const { dir } = await backup(db);
  const target = open("target");
  await restore(dir, target.db);
  target.db.prepare("UPDATE pages SET title = 'Local', updated_at = 2000 WHERE id = ?").run(parent);
  target.db.prepare("UPDATE pages SET title = 'Old', updated_at = 10 WHERE id = ?").run(child);
  const report = await restore(dir, target.db);
  expect(report).toMatchObject({ kept: 1, updated: 1 });
  expect(target.store.meta(parent)!.title).toBe("Local");
  expect(target.store.meta(child)).toMatchObject({ title: "Notes", updated_at: 1000 });
});

it("writes nothing on a dry run but reports the same counts", async () => {
  const { db } = await seed();
  const { dir } = await backup(db);
  const target = open("target");
  const dry = await restore(dir, target.db, { dryRun: true });
  expect(dry).toMatchObject({ created: 2 });
  expect(target.db.prepare("SELECT (SELECT COUNT(*) FROM pages) + (SELECT COUNT(*) FROM snapshots) + (SELECT COUNT(*) FROM files) AS n").get()).toEqual({ n: 0 });
  const real = await restore(dir, target.db);
  expect({ ...real, problems: [] }).toEqual({ ...dry, problems: [] });
});

it("fails a malformed item without stopping the others", async () => {
  const { db, parent } = await seed();
  const { dir } = await backup(db);
  writeFileSync(join(dir, "items", `${parent}.json`), JSON.stringify({ id: parent, title: "Broken" }));
  writeFileSync(join(dir, "items", "pg_junk.json"), "{not json");
  const target = open("target");
  const report = await restore(dir, target.db);
  expect(report).toMatchObject({ created: 1, failed: 2 });
  expect(report.problems.map((problem) => problem.title)).toContain("Broken");
  // The child's parent wasn't restored, so it is top-level.
  expect(target.store.list()[0]).toMatchObject({ title: "Notes", parent_id: null });
});

it("restores pages from a project this BB doesn't have as global pages", async () => {
  const { db, parent } = await seed();
  const { dir } = await backup(db);
  const target = open("target");
  const report = await restore(dir, target.db, { projects: { proj_a: null } });
  expect(report).toMatchObject({ created: 2, unmapped: 2 });
  expect(target.store.meta(parent)!.project_id).toBeNull();
});

it("doesn't overwrite a page open in an editor", async () => {
  const { db, parent } = await seed();
  const { dir } = await backup(db);
  const target = open("target");
  await restore(dir, target.db);
  target.db.prepare("UPDATE pages SET updated_at = 10").run();
  const evicted: string[] = [];
  const hub: BackupHub = {
    activity: (id) => (id === parent ? "editing" : "idle"),
    evict: (id) => void evicted.push(id),
    flushAll: () => {},
  };
  const report = await restore(dir, target.db, { hub });
  expect(report).toMatchObject({ updated: 1, failed: 1 });
  expect(report.problems[0]!.reason).toMatch(/open in an editor/);
  expect(target.store.meta(parent)!.updated_at).toBe(10);
  expect(evicted).not.toContain(parent);
  expect(evicted).toHaveLength(1);
});

it("refuses a restored parent that would put a page below itself", async () => {
  const { db, parent, child } = await seed();
  const { dir } = await backup(db);
  const target = open("target");
  await restore(dir, target.db);
  // Since the backup, the parent moved under the child; the child is older than the backup.
  target.db.prepare("UPDATE pages SET parent_id = ?, updated_at = 2000 WHERE id = ?").run(child, parent);
  target.db.prepare("UPDATE pages SET parent_id = NULL, updated_at = 10 WHERE id = ?").run(child);
  const report = await restore(dir, target.db);
  expect(report).toMatchObject({ updated: 1, kept: 1, failed: 0 });
  expect(target.store.meta(child)!.parent_id).toBeNull();
  expect(target.store.meta(parent)!.parent_id).toBe(child);
  expect(report.notes.join("\n")).toMatch(/keeps its current place/);
});

it("fails a page whose content file is corrupt", async () => {
  const { db, parent } = await seed();
  const { dir } = await backup(db);
  writeFileSync(join(dir, "files", parent, "state.bin"), new Uint8Array([1, 2, 3, 4, 5]));
  const target = open("target");
  const report = await restore(dir, target.db);
  expect(report).toMatchObject({ created: 1, failed: 1 });
  expect(report.problems[0]!.reason).toMatch(/valid page document/);
  expect(target.store.meta(parent)).toBeNull();
});

it("backs up the rest when a version or file is deleted while the backup is writing", async () => {
  const { db } = await seed();
  const handlers = pagesBackup({ db });
  const dir = join(root, "racing");
  const racing = {
    ...handlers,
    backup: (writer: Parameters<typeof handlers.backup>[0]) => {
      const proxy = Object.create(writer) as typeof writer;
      proxy.bytesAt = async (path, bytes) => {
        if (path.endsWith("/state.bin")) db.prepare("DELETE FROM snapshots").run(), db.prepare("DELETE FROM files").run();
        return writer.bytesAt(path, bytes);
      };
      return handlers.backup(proxy);
    },
  };
  const result = await runBackup(dir, racing);
  expect(result.counts).toEqual({ pages: 2, versions: 0, files: 0 });
  const target = open("target");
  expect(await restore(dir, target.db)).toMatchObject({ created: 2, failed: 0 });
});
