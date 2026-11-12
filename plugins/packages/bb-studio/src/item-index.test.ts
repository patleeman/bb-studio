import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "./artifacts/server/store";
import { DashboardStore } from "./dashboards/server/store";
import { designBackupHandlers } from "./design/server/backup";
import { DesignStore } from "./design/server/store";
import { DrawingStore } from "./draw/server/store";
import { StudioHub, type HubSdk } from "./hub";
import { ItemIndex } from "./item-index";
import { runBackup, runRestore } from "./kit/server/index";
import type { StudioItem } from "./kit/contract";
import { MIGRATIONS } from "./migrations";
import { MiniStore } from "./minis/server/store";
import { PageStore } from "./pages/store";

const ITEMS_MIGRATION = MIGRATIONS.findIndex((sql) => sql.includes("CREATE TABLE items ("));
const dbs: Database.Database[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A database with every migration, or only those before the item index. */
function database(upTo = MIGRATIONS.length): Database.Database {
  const db = new Database(":memory:");
  dbs.push(db);
  for (const sql of MIGRATIONS.slice(0, upTo)) db.exec(sql);
  return db;
}

const rows = (db: Database.Database) => db.prepare("SELECT plugin_id, id, family, type, title, project_id, archived_at IS NOT NULL AS archived FROM items ORDER BY plugin_id, id").all();

/** One item of every type, made through each type's own store. */
function seed(db: Database.Database) {
  const page = new PageStore(db).create({ projectId: "proj_a", parentId: null, title: "Plan", actor: "user" });
  const drawing = new DrawingStore(db).create({ name: "Sketch", by: "app" });
  const designs = new DesignStore(db);
  const design = designs.create({ name: "Onboarding deck", projectId: "proj_a", by: "app" });
  const mini = new MiniStore(db).create({ name: "Tracker", projectId: null, by: "user" });
  const dashboard = new DashboardStore(db).create({ name: "Ops", projectId: "proj_b", by: "user" });
  const { artifact } = new ArtifactStore(db).save({ title: "Report", name: "report.md", mime: "text/markdown", bytes: new Uint8Array(Buffer.from("# Report")), projectId: null, by: "agent" });
  return { page, drawing, design, mini, dashboard, artifact, designs };
}

describe("the item index migration", () => {
  it("comes after everything already released", () => {
    // migrations.test.ts pins the first 74 statements; this one was appended after them.
    expect(ITEMS_MIGRATION).toBeGreaterThanOrEqual(74);
    expect(MIGRATIONS.filter((sql) => sql.includes("CREATE TABLE items (")).length).toBe(1);
  });

  it("fills the index from the rows each type already has, changing none of them", () => {
    const db = database(ITEMS_MIGRATION);
    const made = seed(db);
    made.designs.setArchived(made.design.id, true);
    const tables = ["pages", "drawings", "designs", "minis", "dashboards", "artifacts"];
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    for (const sql of MIGRATIONS.slice(ITEMS_MIGRATION)) db.exec(sql);
    expect(rows(db)).toEqual([
      { plugin_id: "artifacts", id: made.artifact.id, family: "app", type: "artifact", title: "Report", project_id: null, archived: 0 },
      { plugin_id: "dashboards", id: made.dashboard.id, family: "app", type: "dashboard", title: "Ops", project_id: "proj_b", archived: 0 },
      { plugin_id: "design", id: made.design.id, family: "page", type: "design", title: "Onboarding deck", project_id: "proj_a", archived: 1 },
      { plugin_id: "excalidraw", id: made.drawing.id, family: "page", type: "whiteboard", title: "Sketch", project_id: null, archived: 0 },
      { plugin_id: "minis", id: made.mini.id, family: "app", type: "mini", title: "Tracker", project_id: null, archived: 0 },
      { plugin_id: "pages", id: made.page.id, family: "page", type: "doc", title: "Plan", project_id: "proj_a", archived: 0 },
    ]);
    // Ids and content rows are as they were.
    expect(tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    // What the migration wrote is what the check would write: nothing to repair.
    expect(new ItemIndex(db).heal()).toEqual({ written: 0, removed: 0 });
  });

  it("handles hundreds of items in one pass", () => {
    const db = database(ITEMS_MIGRATION);
    const insert = db.prepare("INSERT INTO designs (id, name, created_at, updated_at) VALUES (?, ?, 1, 2)");
    for (let n = 0; n < 600; n++) insert.run(`dsn_${n.toString(16).padStart(16, "0")}`, `Design ${n}`);
    for (const sql of MIGRATIONS.slice(ITEMS_MIGRATION)) db.exec(sql);
    expect(new ItemIndex(db).count()).toBe(600);
    expect(new ItemIndex(db).list({ type: "design", limit: 1000 })).toHaveLength(600);
  });
});

describe("the item index in step with each type's store", () => {
  it("follows a create, a rename, a move, an archive and a delete", () => {
    const db = database();
    const index = new ItemIndex(db);
    const { design, designs, dashboard, artifact } = seed(db);
    expect(index.get(design.id)).toMatchObject({ pluginId: "design", family: "page", type: "design", title: "Onboarding deck", projectId: "proj_a", archived: false });
    expect(index.get(dashboard.id)).toMatchObject({ pluginId: "dashboards", family: "app", type: "dashboard" });
    expect(index.get(artifact.id)).toMatchObject({ pluginId: "artifacts", family: "app", type: "artifact" });
    designs.rename(design.id, "Deck v2", "app");
    designs.setProject(design.id, null);
    designs.setArchived(design.id, true);
    expect(index.get(design.id)).toMatchObject({ title: "Deck v2", projectId: null, archived: true });
    designs.delete(design.id);
    expect(index.get(design.id)).toBeNull();
    expect(index.heal()).toEqual({ written: 0, removed: 0 });
  });

  it("lists across types by family, newest first, leaving archived items out unless asked", () => {
    const db = database();
    const index = new ItemIndex(db);
    const { page, drawing, design, mini, dashboard, artifact } = seed(db);
    new DashboardStore(db).setArchived(dashboard.id, true);
    expect(index.list({ family: "page" }).map((item) => item.id).sort()).toEqual([page.id, drawing.id, design.id].sort());
    expect(index.list({ family: "app" }).map((item) => item.id).sort()).toEqual([mini.id, artifact.id].sort());
    expect(index.list({ family: "app", includeArchived: true }).map((item) => item.type).sort()).toEqual(["artifact", "dashboard", "mini"]);
    expect(index.list({ type: "design", projectId: "proj_other" })).toEqual([]);
    expect(index.list({ type: "design", projectId: "proj_a" }).map((item) => item.id)).toEqual([design.id]);
  });
});

describe("the item index check", () => {
  it("rebuilds a row a write missed, corrects one that differs, and drops one whose item is gone", () => {
    const db = database();
    const index = new ItemIndex(db);
    const { design, dashboard, page } = seed(db);
    db.prepare("DELETE FROM items WHERE id = ?").run(design.id);
    db.prepare("UPDATE items SET title = 'stale', family = 'page', type = 'doc' WHERE id = ?").run(dashboard.id);
    db.prepare("INSERT INTO items (plugin_id, id, family, type, title, created_at, updated_at) VALUES ('minis', 'mini_gone', 'app', 'mini', 'Gone', 1, 1)").run();
    db.prepare("INSERT INTO items (plugin_id, id, family, type, title, created_at, updated_at) VALUES ('retired', 'x_1', 'app', 'mini', 'Old', 1, 1)").run();
    expect(index.heal()).toEqual({ written: 2, removed: 2 });
    expect(index.get(design.id)).toMatchObject({ family: "page", type: "design", title: "Onboarding deck" });
    expect(index.get(dashboard.id)).toMatchObject({ family: "app", type: "dashboard", title: "Ops" });
    expect(index.get("mini_gone")).toBeNull();
    expect(index.get("x_1")).toBeNull();
    expect(index.get(page.id)).toMatchObject({ type: "doc" });
    expect(index.heal()).toEqual({ written: 0, removed: 0 });
  });

  it("rebuilds the whole index from the types' tables when it is empty", () => {
    const db = database();
    seed(db);
    const before = rows(db);
    db.exec("DELETE FROM items");
    expect(new ItemIndex(db).heal()).toEqual({ written: 6, removed: 0 });
    expect(rows(db)).toEqual(before);
  });
});

describe("a backup and the item index", () => {
  const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), "item-index-backup-")); dirs.push(dir); return dir; };
  const html = "<!doctype html><title>A</title><p>A</p>";

  async function designBackup() {
    const source = database();
    const store = new DesignStore(source);
    const kept = store.create({ name: "Onboarding", projectId: "proj_a", by: "app" });
    store.writeScreen(kept.id, { id: "1a", html }, "agent");
    const archived = store.create({ name: "Old deck", by: "app" });
    store.setArchived(archived.id, true);
    const dir = join(tempDir(), "section");
    const backup = await runBackup(dir, designBackupHandlers({ db: source, store, changed: () => {} }));
    return { source, dir, backup, ids: [kept.id, archived.id] };
  }
  const restoreInto = (db: Database.Database, dir: string, version: number) =>
    runRestore(dir, designBackupHandlers({ db, store: new DesignStore(db), changed: () => {} }), { dryRun: false, version, projects: { proj_a: "proj_a" } });

  it("round-trips: restored designs are indexed as page types, under the ids they had", async () => {
    const { source, dir, backup, ids } = await designBackup();
    const target = database();
    expect(await restoreInto(target, dir, backup.version)).toMatchObject({ created: 2, failed: 0 });
    expect(rows(target)).toEqual(rows(source));
    expect(rows(target).map((row) => (row as { id: string }).id).sort()).toEqual([...ids].sort());
    expect(new ItemIndex(target).heal()).toEqual({ written: 0, removed: 0 });
  });

  it("carries no index of its own, so a backup made before the index restores the same way", async () => {
    const { dir, backup, source } = await designBackup();
    // The section holds the designs and their screens, as it always did.
    expect(readdirSync(dir).sort()).not.toContain("items.json");
    expect(readdirSync(join(dir, "items"))).toHaveLength(2);
    // A restore that wrote past the triggers (as a database from before them would) is put right by the check.
    const target = database();
    for (const name of ["insert", "update", "delete"]) target.exec(`DROP TRIGGER items_designs_${name}`);
    expect(await restoreInto(target, dir, backup.version)).toMatchObject({ created: 2, failed: 0 });
    expect(rows(target)).toEqual([]);
    expect(new ItemIndex(target).heal()).toEqual({ written: 2, removed: 0 });
    expect(rows(target)).toEqual(rows(source));
  });
});

describe("items listed with their family and type", () => {
  const item = (id: string, kind: string, href: string): StudioItem => ({ id, kind, title: id, icon: null, projectId: null, parentId: null, createdAt: 1, updatedAt: 1, updatedBy: null, preview: null, facts: [], badge: null, thumbnailUrl: null, href, archived: false });
  const provider = (pluginId: string, kind: string, items: StudioItem[]) => ({
    pluginId, name: pluginId,
    handlers: {
      studio_describe: () => ({ pluginId, version: 2 as const, panel: null, kinds: [{ id: kind, label: kind, plural: kind, icon: "File", columns: [], actions: [], create: { mode: "rpc" as const }, canArchive: true, capabilities: { create: true, move: true, archive: true, delete: true, rename: true, duplicate: false, export: false, comments: false, versions: false, links: false }, mentionProviderId: null, blurb: "" }] }),
      studio_list: () => ({ items }),
      studio_get: ({ ids }: { ids: string[] }) => ({ items: items.filter((each) => ids.includes(each.id)) }),
      studio_create: () => ({ item: items[0]! }),
    } as never,
  });
  const sdk: HubSdk = { plugins: { list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [], callRpc: async () => { throw new Error("no RPC expected"); } } };

  it("lists a design as a page type, a dashboard and an artifact as app types, and a recording as neither", async () => {
    const db = database();
    const { design, dashboard, artifact } = seed(db);
    const index = new ItemIndex(db);
    const hub = new StudioHub(sdk, [
      provider("design", "design", [item(design.id, "design", `/plugins/studio/studio/designs/${design.id}`)]),
      provider("dashboards", "dashboard", [item(dashboard.id, "dashboard", `/plugins/studio/studio/dashboards/${dashboard.id}`)]),
      provider("artifacts", "artifact", [item(artifact.id, "artifact", `/plugins/studio/studio/artifacts/${artifact.id}`)]),
      provider("talk", "recording", [item("rec_1", "recording", "/plugins/studio/studio/recordings/rec_1")]),
    ], { itemTypes: (pluginId) => index.types(pluginId) });
    const { items } = await hub.overview();
    expect(items.map(({ pluginId, id, kind, family, type }) => ({ pluginId, id, kind, family, type }))).toEqual([
      { pluginId: "design", id: design.id, kind: "design", family: "page", type: "design" },
      { pluginId: "dashboards", id: dashboard.id, kind: "dashboard", family: "app", type: "dashboard" },
      { pluginId: "artifacts", id: artifact.id, kind: "artifact", family: "app", type: "artifact" },
      { pluginId: "talk", id: "rec_1", kind: "recording", family: undefined, type: undefined },
    ]);
    // One item read by id, and one a create returns, carry them too; the older fields are all still there.
    expect((await hub.get("design", [design.id]))[0]).toMatchObject({ kind: "design", family: "page", type: "design", href: `/plugins/studio/studio/designs/${design.id}` });
    expect((await hub.call("dashboards", "studio_create", { kind: "dashboard", projectId: null })).item).toMatchObject({ kind: "dashboard", family: "app", type: "dashboard" });
  });

  it("falls back to the kind's own family when the index has no row yet", async () => {
    const hub = new StudioHub(sdk, [provider("minis", "mini", [item("mini_0123456789abcdef", "mini", "/plugins/studio/studio/minis/mini_0123456789abcdef")])], { itemTypes: () => new Map() });
    expect((await hub.overview()).items[0]).toMatchObject({ family: "app", type: "mini" });
  });
});
