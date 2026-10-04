import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { tableQuerySchema, type Table } from "@bb-studio/kit/tables";
import { MIGRATIONS, TableStore } from "./store";
import { queryPage } from "./query";

const databases: Database.Database[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); });
function fixture() {
  const db = new Database(":memory:"); databases.push(db);
  db.exec(MIGRATIONS[0]!);
  const store = new TableStore(db);
  const table = store.create("Paged inventory", null, [
    { id: "n", name: "Number", type: "number", options: [] },
    { id: "group", name: "Group", type: "number", options: [] },
  ], Array.from({ length: 1207 }, (_, n) => ({ n, group: n % 3 })));
  return { table, store };
}
const page = (table: Table, args: Record<string, unknown> = {}) => queryPage(table, tableQuerySchema.parse({ id: table.id, ...args }));

it("traverses a saved filtered/sorted view beyond 100 rows with stable ties", () => {
  const { table, store } = fixture();
  const saved = store.update(table.id, { views: [{ id: "view", name: "Filtered", type: "table", groupBy: null, dateBy: null, hidden: [],
    filters: [{ columnId: "n", op: "gt", value: 100 }], sorts: [{ columnId: "group", direction: "desc" }],
  }] });
  const seen: string[] = [];
  let offset = 0, expectedRevision: string | undefined;
  do {
    const result = page(saved, { viewId: "view", offset, expectedRevision });
    expect(result.total).toBe(1106);
    expect(result.rows.length).toBeLessThanOrEqual(100);
    seen.push(...result.rows.map((row) => row.id));
    expectedRevision = result.revision;
    if (result.nextOffset === null) break;
    expect(result.nextOffset).toBeGreaterThan(offset);
    offset = result.nextOffset;
  } while (true);
  const expected = saved.rows.filter((row) => Number(row.values.n) > 100)
    .sort((a, b) => Number(b.values.group) - Number(a.values.group));
  expect(seen).toEqual(expected.map((row) => row.id));
  expect(new Set(seen).size).toBe(1106);
});

it("rejects a changed snapshot or query even within the same timestamp", () => {
  const { table } = fixture();
  const first = page(table);
  const changed = { ...table, rows: table.rows.slice(1) };
  expect(() => page(changed, { offset: first.nextOffset, expectedRevision: first.revision })).toThrow(/Restart at offset 0/);
  expect(() => page(table, { offset: 100, expectedRevision: first.revision, sorts: [{ columnId: "n", direction: "desc" }] })).toThrow(/query changed/);
  expect(page(table, { offset: 100, limit: 500, expectedRevision: first.revision }).rows).toHaveLength(500);
});

it("ends empty/out-of-range pages and validates limits and view IDs", () => {
  const { table } = fixture();
  expect(page(table, { offset: 2000 })).toMatchObject({ rows: [], total: 1207, offset: 2000, nextOffset: null });
  expect(page(table, { filters: [{ columnId: "n", op: "lt", value: -1 }] })).toMatchObject({ rows: [], total: 0, nextOffset: null });
  for (const args of [{ offset: -1 }, { offset: 1.5 }, { limit: 0 }, { limit: 501 }]) expect(() => page(table, args)).toThrow();
  expect(() => page(table, { viewId: "missing" })).toThrow("View not found.");
});
