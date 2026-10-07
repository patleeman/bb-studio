import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { runBackup, runRestore } from "@bb-studio/kit/server";
import { createDrawBackup } from "./backup";
import { DrawingStore, MIGRATIONS } from "./store";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "draw-backup-"));
  cleanup.push(dir);
  return dir;
}

function fileStore(now: () => number = Date.now) {
  const db = new Database(join(tempDir(), "draw.db"));
  for (const statement of MIGRATIONS) db.exec(statement);
  const store = new DrawingStore(db, now);
  const notified: string[] = [];
  const handlers = createDrawBackup({ db, store, changed: (id) => notified.push(id) });
  return { db, store, handlers, notified };
}

function seed(store: DrawingStore, name: string, projectId: string | null) {
  const row = store.create({ name, projectId, by: "app" });
  const data = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "test",
    elements: [{ id: "img1", type: "image", fileId: "f".repeat(40), x: 1, y: 2, version: 3 }],
    appState: { viewBackgroundColor: "#fafafa" },
    files: { ["f".repeat(40)]: { id: "f".repeat(40), mimeType: "image/png", created: 7, dataURL: `data:image/png;base64,${PNG.toString("base64")}` } },
  });
  store.write(row.id, data, "editor");
  return store.get(row.id)!;
}

async function backupOf(handlers: ReturnType<typeof fileStore>["handlers"]) {
  const dir = join(tempDir(), "excalidraw");
  const result = await runBackup(dir, handlers);
  return { dir, result };
}

const restore = (dir: string, handlers: ReturnType<typeof fileStore>["handlers"], options: { dryRun?: boolean; projects?: Record<string, string | null> } = {}) =>
  runRestore(dir, handlers, { dryRun: options.dryRun ?? false, version: 1, projects: options.projects ?? { proj_a: "proj_a" } });

describe("Studio Draw backup", () => {
  it("round-trips drawings with their scene and image files", async () => {
    const source = fileStore();
    const row = seed(source.store, "Plan", "proj_a");
    source.store.setTemplate(row.id, true);
    source.store.setArchived(row.id, true);
    const original = source.store.get(row.id)!;
    const { dir, result } = await backupOf(source.handlers);
    expect(result.counts).toEqual({ drawings: 1, images: 1 });
    expect(result.files).toBe(2);

    const item = JSON.parse(readFileSync(join(dir, "items", `${row.id}.json`), "utf8"));
    expect(JSON.stringify(item)).not.toContain("base64");
    expect(item.files["f".repeat(40)]).toMatchObject({ mimeType: "image/png", path: `files/${row.id}/1` });
    expect(readFileSync(join(dir, "files", row.id, "1"))).toEqual(PNG);

    const target = fileStore();
    const report = await restore(dir, target.handlers);
    expect(report).toMatchObject({ created: 1, updated: 0, failed: 0, unmapped: 0 });
    const restored = target.store.get(row.id)!;
    expect({ ...restored, data: undefined }).toEqual({ ...original, data: undefined });
    expect(JSON.parse(restored.data)).toEqual(JSON.parse(original.data));
    expect(target.notified).toEqual([row.id]);

    const again = await restore(dir, target.handlers);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(target.store.get(row.id)).toEqual(restored);
  });

  it("keeps a newer local copy and updates an older one", async () => {
    let now = 1_000;
    const source = fileStore(() => now);
    const newerHere = seed(source.store, "Newer here", null);
    const newerInBackup = seed(source.store, "Newer in backup", null);
    const { dir } = await backupOf(source.handlers);

    const target = fileStore(() => now);
    await restore(dir, target.handlers);
    now = 9_000;
    target.store.rename(newerHere.id, "Edited here", "editor");
    // Make the target's copy of the other drawing older than the backup.
    target.db.prepare("UPDATE drawings SET updated_at = 1, name = 'Old' WHERE id = ?").run(newerInBackup.id);

    const report = await restore(dir, target.handlers);
    expect(report).toMatchObject({ kept: 1, updated: 1, created: 0 });
    expect(target.store.get(newerHere.id)!.name).toBe("Edited here");
    expect(target.store.get(newerInBackup.id)!).toMatchObject({ name: "Newer in backup", updated_at: newerInBackup.updated_at });
  });

  it("writes nothing on a dry run but counts the same", async () => {
    const source = fileStore();
    seed(source.store, "One", "proj_a");
    seed(source.store, "Two", null);
    const { dir } = await backupOf(source.handlers);
    const target = fileStore();
    const report = await restore(dir, target.handlers, { dryRun: true });
    expect(report).toMatchObject({ created: 2 });
    expect(target.store.list({ includeArchived: true })).toEqual([]);
    expect(target.notified).toEqual([]);
  });

  it("reports a malformed item as failed and restores the rest", async () => {
    const source = fileStore();
    const good = seed(source.store, "Good", null);
    const { dir } = await backupOf(source.handlers);
    writeFileSync(join(dir, "items", "drw_0000000000000000.json"), JSON.stringify({ id: "drw_0000000000000000", name: 5 }));
    writeFileSync(join(dir, "items", "drw_1111111111111111.json"), "{not json");
    const escape = JSON.parse(readFileSync(join(dir, "items", `${good.id}.json`), "utf8"));
    escape.id = "drw_2222222222222222";
    writeFileSync(join(dir, "items", "drw_2222222222222222.json"), JSON.stringify(escape));

    const target = fileStore();
    const report = await restore(dir, target.handlers);
    expect(report).toMatchObject({ created: 1, failed: 3 });
    expect(report.problems.map((problem) => problem.id).sort()).toEqual(["drw_0000000000000000", "drw_1111111111111111", "drw_2222222222222222"]);
    expect(target.store.list().map((row) => row.id)).toEqual([good.id]);
  });

  it("restores a drawing from an unknown project as a global one", async () => {
    const source = fileStore();
    const row = seed(source.store, "Elsewhere", "proj_gone");
    const mapped = seed(source.store, "Mapped", "proj_a");
    const { dir } = await backupOf(source.handlers);
    const target = fileStore();
    const report = await restore(dir, target.handlers, { projects: { proj_gone: null, proj_a: "proj_b" } });
    expect(report).toMatchObject({ created: 2, unmapped: 1 });
    expect(target.store.get(row.id)!.project_id).toBeNull();
    expect(target.store.get(mapped.id)!.project_id).toBe("proj_b");
  });

  it("backs up an empty store as an empty section", async () => {
    const { handlers } = fileStore();
    const { dir, result } = await backupOf(handlers);
    expect(result.counts).toEqual({ drawings: 0, images: 0 });
    expect(readdirSync(dir)).toEqual([]);
  });
});
