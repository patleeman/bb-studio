import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { IMPORT_BATCH_CHARS } from "@bb-studio/kit/draw-contract";
// Studio's real store, so the copy is checked against what Studio does with it.
import { DRAWING_TABLES, DrawingStore } from "../../bb-studio/src/draw/server/store";
import { MIGRATED, MIGRATIONS, batches, migrate, type Markers, type StudioImport } from "./migrate";

const scene = (text: string) => JSON.stringify({ type: "excalidraw", version: 2, elements: [{ id: "t", type: "text", text, x: 0, y: 0, version: 1, versionNonce: 1, isDeleted: false }], appState: {}, files: {} });

function oldPlugin() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  const add = (id: string, extra: Record<string, unknown> = {}) => {
    db.prepare(`INSERT INTO drawings (id, name, data, created_at, updated_at, project_id, updated_by, archived_at, template)
      VALUES (@id, @name, @data, 10, 20, @project, 'agent', @archived, @template)`).run({ id, name: `Name ${id}`, data: scene(id), project: "proj_1", archived: null, template: 0, ...extra });
  };
  return { db, add };
}

function studio(options: { failRows?: number } = {}) {
  const db = new Database(":memory:");
  db.exec(DRAWING_TABLES);
  const store = new DrawingStore(db);
  const calls = { rows: 0 };
  let failRows = options.failRows ?? 0;
  const api: StudioImport = {
    importRows: async (drawings) => {
      calls.rows++;
      if (failRows-- > 0) throw new Error("Studio isn't running");
      const result = { imported: [] as string[], existing: [] as string[], skipped: [] as { id: string; reason: string }[] };
      for (const item of drawings) {
        const outcome = store.importDrawing(item);
        if (outcome.outcome === "skipped") result.skipped.push({ id: item.id, reason: outcome.reason });
        else result[outcome.outcome].push(item.id);
      }
      return result;
    },
  };
  return { store, api, calls };
}

function markers(): Markers & { keys(): string[] } {
  const map = new Map<string, unknown>();
  return { get: async (key) => map.get(key), set: async (key, value) => { map.set(key, value); }, keys: () => [...map.keys()] };
}

describe("copying the old Draw plugin into Studio", () => {
  it("keeps the old plugin's migration byte for byte, the same statement Studio appends", () => {
    expect(createHash("sha256").update(MIGRATIONS[0]!).digest("hex")).toBe("991b718c33627a35075e1a571c79901e3962c96132112e6733746fd6e204899c");
    expect(MIGRATIONS[0]).toBe(DRAWING_TABLES);
  });

  it("copies every drawing with its id, times, project, template and archive state, once", async () => {
    const old = oldPlugin();
    old.add("drw_aaaaaaaaaaaaaaaa", { template: 1 });
    old.add("drw_bbbbbbbbbbbbbbbb", { archived: 30, project: null });
    old.db.prepare("INSERT INTO drawing_recovery_copies (recovery_key, drawing_id) VALUES ('k1', 'drw_bbbbbbbbbbbbbbbb')").run();
    const target = studio();
    const marks = markers();
    expect(await migrate(old.db, target.api, marks)).toEqual({ complete: true, total: 2, copied: 2, skipped: [] });
    expect(target.store.get("drw_aaaaaaaaaaaaaaaa")).toMatchObject({ name: "Name drw_aaaaaaaaaaaaaaaa", data: scene("drw_aaaaaaaaaaaaaaaa"), created_at: 10, updated_at: 20, project_id: "proj_1", updated_by: "agent", template: 1, archived_at: null });
    expect(target.store.get("drw_bbbbbbbbbbbbbbbb")).toMatchObject({ project_id: null, archived_at: 30, template: 0 });
    expect(target.store.recoverCopy({ key: "k1", name: "x", data: scene("x") })).toMatchObject({ created: false, row: { id: "drw_bbbbbbbbbbbbbbbb" } });
    expect(marks.keys().sort()).toEqual([`${MIGRATED}drw_aaaaaaaaaaaaaaaa`, `${MIGRATED}drw_bbbbbbbbbbbbbbbb`]);
    // A rerun sends nothing.
    const before = target.calls.rows;
    expect(await migrate(old.db, target.api, marks)).toMatchObject({ complete: true, copied: 2 });
    expect(target.calls.rows).toBe(before);
  });

  it("is idempotent when markers are lost: Studio keeps what it has", async () => {
    const old = oldPlugin();
    old.add("drw_aaaaaaaaaaaaaaaa");
    const target = studio();
    await migrate(old.db, target.api, markers());
    target.store.rename("drw_aaaaaaaaaaaaaaaa", "Edited in Studio", "app");
    expect(await migrate(old.db, target.api, markers())).toMatchObject({ complete: true, copied: 1 });
    expect(target.store.get("drw_aaaaaaaaaaaaaaaa")!.name).toBe("Edited in Studio");
  });

  it("lists malformed rows with the reason, keeps them, and still completes", async () => {
    const old = oldPlugin();
    old.add("drw_aaaaaaaaaaaaaaaa");
    old.add("drw_cccccccccccccccc", { data: "{not json" });
    old.add("drw_dddddddddddddddd", { data: JSON.stringify({ hello: "world" }) });
    const target = studio();
    const result = await migrate(old.db, target.api, markers());
    expect(result).toMatchObject({ complete: true, total: 3, copied: 1 });
    expect(result.skipped).toEqual([
      { id: "drw_cccccccccccccccc", reason: "Its scene isn't valid JSON." },
      { id: "drw_dddddddddddddddd", reason: expect.stringContaining("isn't a drawing") },
    ]);
    expect(old.db.prepare("SELECT COUNT(*) AS n FROM drawings").get()).toEqual({ n: 3 });
  });

  it("resumes after Studio fails partway", async () => {
    const old = oldPlugin();
    old.add("drw_aaaaaaaaaaaaaaaa");
    const target = studio({ failRows: 1 });
    const marks = markers();
    await expect(migrate(old.db, target.api, marks)).rejects.toThrow("Studio isn't running");
    expect(await migrate(old.db, target.api, marks)).toMatchObject({ complete: true, copied: 1 });
  });

  it("sends large scenes in smaller batches", () => {
    const item = (id: string, size: number) => ({ id, name: "", data: "x".repeat(size), createdAt: 0, updatedAt: 0, projectId: null, updatedBy: null, archivedAt: null, template: false, recoveryKeys: [] });
    const sizes = batches([item("a", 10), item("b", IMPORT_BATCH_CHARS), item("c", 10), item("d", 10)]).map((batch) => batch.map((each) => each.id));
    expect(sizes).toEqual([["a"], ["b"], ["c", "d"]]);
  });
});
