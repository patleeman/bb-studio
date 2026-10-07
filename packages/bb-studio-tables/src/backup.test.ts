import Database from "better-sqlite3";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runBackup, runRestore } from "@bb-studio/kit/server";
import { tablesBackup } from "./backup";
import { MIGRATIONS, TableStore } from "./store";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function open() {
  const db = new Database(":memory:");
  db.exec(MIGRATIONS[0]!);
  return new TableStore(db);
}

async function backupOf(store: TableStore): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tables-backup-"));
  dirs.push(root);
  const dir = join(root, "studio-tables");
  await runBackup(dir, tablesBackup(store));
  return dir;
}

const restore = (store: TableStore, dir: string, options: { dryRun?: boolean; projects?: Record<string, string | null> } = {}) =>
  runRestore(dir, tablesBackup(store), { dryRun: options.dryRun ?? false, version: 1, projects: options.projects ?? { proj_a: "proj_b" } });

it("round-trips tables into an empty store and a second restore changes nothing", async () => {
  const source = open();
  const table = source.create("Inventory", "proj_a", [{ id: "qty", name: "Quantity", type: "number", options: [] }], [{ qty: 3 }]);
  source.create("Global", null);
  const dir = await backupOf(source);

  const target = open();
  expect(await restore(target, dir, { dryRun: true })).toMatchObject({ created: 2, failed: 0 });
  expect(target.list()).toEqual([]);

  expect(await restore(target, dir)).toMatchObject({ created: 2, updated: 0, unmapped: 0 });
  const restored = target.get(table.id)!;
  expect(restored).toMatchObject({ title: "Inventory", projectId: "proj_b", updatedAt: table.updatedAt, createdAt: table.createdAt });
  expect(restored.rows.map((row) => row.values.qty)).toEqual([3]);

  expect(await restore(target, dir)).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
  expect(target.list()).toHaveLength(2);
});

it("keeps newer local edits and replaces older copies", async () => {
  const source = open();
  const newer = source.create("Newer here", null);
  const older = source.create("Older here", null);
  const dir = await backupOf(source);

  const target = open();
  await restore(target, dir);
  target.put({ ...target.get(newer.id)!, title: "Edited after the backup", updatedAt: newer.updatedAt + 1000 });
  target.put({ ...target.get(older.id)!, title: "Stale", updatedAt: older.updatedAt - 1000 });

  const report = await restore(target, dir);
  expect(report).toMatchObject({ kept: 1, updated: 1 });
  expect(report.problems[0]).toMatchObject({ id: newer.id });
  expect(target.get(newer.id)!.title).toBe("Edited after the backup");
  expect(target.get(older.id)!.title).toBe("Older here");
});

it("restores tables from unknown projects as global and reports bad files", async () => {
  const source = open();
  const table = source.create("Elsewhere", "proj_gone");
  const dir = await backupOf(source);
  await mkdir(join(dir, "items"), { recursive: true });
  await writeFile(join(dir, "items", "tbl_bad.json"), JSON.stringify({ id: "tbl_bad", title: 1 }));

  const target = open();
  const report = await restore(target, dir, { projects: {} });
  expect(report).toMatchObject({ created: 1, unmapped: 1, failed: 1 });
  expect(target.get(table.id)!.projectId).toBeNull();
  expect(target.get("tbl_bad")).toBeNull();
});
