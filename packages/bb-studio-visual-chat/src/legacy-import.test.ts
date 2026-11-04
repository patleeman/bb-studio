import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importLegacyCanvases, legacyDatabasePath, legacyDatabasePaths, openLegacyReadOnly } from "./legacy-import";
import { CANVAS_MIGRATIONS } from "./migrations";
import { CanvasStore } from "./store";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A data dir with the first Canvas plugin's database at plugins/canvas/data.db, built with its first `upTo` migrations. */
function legacyDataDir(upTo = 3, dataDir = mkdtempSync(join(tmpdir(), "canvas-legacy-"))): { dataDir: string; path: string } {
  dirs.push(dataDir);
  mkdirSync(join(dataDir, "plugins", "canvas"), { recursive: true });
  const path = legacyDatabasePath(dataDir, "canvas");
  const db = new Database(path);
  for (const migration of CANVAS_MIGRATIONS.slice(0, upTo)) db.exec(migration);
  // This store writes the composition columns (migration 5), which the old plugin's file never had: add them for the fixture only.
  if (upTo >= 3) db.exec(CANVAS_MIGRATIONS[4]!);
  const store = new CanvasStore(db, () => 5_000);
  if (upTo >= 3) {
    const a = store.create({ threadId: "thr_old_a", title: "Release", look: "instrument", execution: { providerId: "claude-code", model: "claude-haiku-5-5", reasoningLevel: null } });
    store.edit(a.id, [{ op: "add", item: { id: "issues", kind: "stat", title: "Open issues", data: { value: 12 } } }, { op: "board", title: "Release" }], "agent");
    store.beginTurn(a.id, "user", "How is the release going?");
    store.attach(a.id, "thr_old_a2");
    store.create({ threadId: "thr_old_b", title: "Weather" });
  } else {
    db.prepare("INSERT INTO canvases (id, thread_id, title, created_at, updated_at) VALUES ('cnv_00000000000000aa', 'thr_old_c', 'Old schema', 1, 1)").run();
  }
  db.close();
  return { dataDir, path };
}

function fresh() {
  const db = new Database(":memory:");
  for (const migration of CANVAS_MIGRATIONS) db.exec(migration);
  return { db, store: new CanvasStore(db) };
}

const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("importing the old Canvas plugin's canvases", () => {
  it("copies every canvas, item, change, turn and alias, keeping ids and threads, and never writes the legacy file", () => {
    const { path } = legacyDataDir();
    const before = { hash: digest(path), mtime: statSync(path).mtimeMs };
    const { db, store } = fresh();
    const result = importLegacyCanvases(db, path, openLegacyReadOnly, () => 9_000);
    expect(result.status).toBe("imported");
    if (result.status !== "imported") return;
    expect(result.counts.canvases).toBe(2);
    expect(result.counts.canvas_items).toBe(1);
    expect(result.counts.canvas_changes).toBeGreaterThan(0);
    expect(result.counts.canvas_turns).toBe(1);
    expect(result.counts.canvas_thread_aliases).toBe(1);
    // Lookups by the hidden thread, and by the thread it had before a switch, still find the canvas.
    const view = store.byThread("thr_old_a2");
    expect(view?.title).toBe("Release");
    expect(store.byThread("thr_old_a")?.id).toBe(view?.id);
    expect(view?.look).toBe("instrument");
    expect(view?.model).toBe("claude-haiku-5-5");
    expect(store.items(view!.id).map((item) => item.id)).toEqual(["issues"]);
    expect(store.byThread("thr_old_b")?.title).toBe("Weather");
    expect(db.prepare("SELECT source, at FROM canvas_legacy_import").get()).toEqual({ source: path, at: 9_000 });
    expect(digest(path)).toBe(before.hash);
    expect(statSync(path).mtimeMs).toBe(before.mtime);
  });

  it("runs once", () => {
    const { path } = legacyDataDir();
    const { db } = fresh();
    expect(importLegacyCanvases(db, path).status).toBe("imported");
    db.prepare("DELETE FROM canvases").run();
    expect(importLegacyCanvases(db, path)).toEqual({ status: "skipped", reason: "already-imported" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM canvases").get()).toEqual({ n: 0 });
  });

  it("leaves a store that already has canvases alone", () => {
    const { path } = legacyDataDir();
    const { db, store } = fresh();
    store.create({ threadId: "thr_new" });
    expect(importLegacyCanvases(db, path)).toEqual({ status: "skipped", reason: "store-not-empty" });
    expect(store.byThread("thr_old_a")).toBeNull();
  });

  it("does nothing without a legacy file, or with a database that isn't Canvas's", () => {
    const { db } = fresh();
    expect(importLegacyCanvases(db, join(tmpdir(), "no-such-dir", "data.db"))).toEqual({ status: "skipped", reason: "no-legacy-file" });
    const dataDir = mkdtempSync(join(tmpdir(), "canvas-legacy-"));
    dirs.push(dataDir);
    const other = join(dataDir, "data.db");
    new Database(other).exec("CREATE TABLE notes (id TEXT)");
    expect(importLegacyCanvases(db, other)).toEqual({ status: "skipped", reason: "not-a-canvas-database" });
    // Nothing recorded: a later start with the real file still imports.
    expect(db.prepare("SELECT COUNT(*) AS n FROM canvas_legacy_import").get()).toEqual({ n: 0 });
  });

  it("imports from an older schema, with defaults for the columns it lacks", () => {
    const { path } = legacyDataDir(1);
    const { db, store } = fresh();
    expect(importLegacyCanvases(db, path).status).toBe("imported");
    const row = store.byThread("thr_old_c");
    expect(row?.title).toBe("Old schema");
    expect(row?.look).toBeNull();
  });

  it("imports BB Studio Canvas's file first, with its pages and found pictures, and falls back to Canvas's", () => {
    // Both older plugins have files: BB Studio Canvas's (every migration, a page and a cached picture) wins.
    const { dataDir, path: canvasPath } = legacyDataDir();
    mkdirSync(join(dataDir, "plugins", "studio-canvas"), { recursive: true });
    const studioPath = legacyDatabasePath(dataDir, "studio-canvas");
    const old = new Database(studioPath);
    for (const migration of CANVAS_MIGRATIONS) old.exec(migration);
    const oldStore = new CanvasStore(old, () => 7_000);
    const board = oldStore.create({ threadId: "thr_studio_a", title: "Chromatic", look: "editorial", execution: { providerId: "claude-code", model: "claude-sonnet-5-5", reasoningLevel: "low" } });
    oldStore.setPage(board.id, '<h1 data-cv-id="title">Seven cartridges</h1>', "agent", "Chromatic");
    oldStore.setCaption(board.id, "Start with Link's Awakening.");
    old.prepare("INSERT INTO canvas_image_cache (key, image, at) VALUES ('q:tetris dx', '{\"url\":\"https://upload.wikimedia.org/t.jpg\",\"alt\":\"Tetris DX\",\"source\":\"https://en.wikipedia.org/wiki/Tetris_DX\"}', 7000)").run();
    old.prepare("INSERT INTO canvas_legacy_import (id, source, at, counts) VALUES (1, 'its own import', 1, '{}')").run();
    old.close();
    const before = [digest(studioPath), digest(canvasPath)];
    const { db, store } = fresh();
    const result = importLegacyCanvases(db, legacyDatabasePaths(dataDir));
    expect(result).toMatchObject({ status: "imported", source: studioPath, counts: { canvases: 1, canvas_image_cache: 1 } });
    const view = store.byThread("thr_studio_a")!;
    expect(view).toMatchObject({ title: "Chromatic", page: '<h1 data-cv-id="title">Seven cartridges</h1>', caption: "Start with Link's Awakening.", model: "claude-sonnet-5-5", reasoning_level: "low" });
    expect(store.byThread("thr_old_a")).toBeNull();
    // Its own record of the earlier import isn't copied: this store's says where these came from.
    expect(db.prepare("SELECT source FROM canvas_legacy_import").all()).toEqual([{ source: studioPath }]);
    expect([digest(studioPath), digest(canvasPath)]).toEqual(before);

    // No BB Studio Canvas file: the first Canvas plugin's.
    const { dataDir: onlyOld, path } = legacyDataDir();
    const second = fresh();
    expect(importLegacyCanvases(second.db, legacyDatabasePaths(onlyOld))).toMatchObject({ status: "imported", source: path, counts: { canvases: 2 } });
    expect(second.store.byThread("thr_old_b")?.title).toBe("Weather");
  });
});
