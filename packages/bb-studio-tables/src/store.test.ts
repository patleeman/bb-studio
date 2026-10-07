import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { MIGRATIONS, TableStore } from "./store";

function open() {
  const db = new Database(":memory:");
  db.exec(MIGRATIONS[0]!);
  return { db, store: new TableStore(db) };
}

it("persists tables and validates row updates", () => {
  const { db, store } = open();
  const table = store.create("Inventory", "project-1", [{ id: "qty", name: "Quantity", type: "number", options: [] }]);
  const row = store.insert(table.id, { qty: 3 });
  expect(store.get(table.id)?.rows[0]?.values.qty).toBe(3);
  expect(() => store.updateRow(table.id, row.id, { qty: "wrong" })).toThrow(/Invalid value/);
  expect(store.get(table.id)?.rows[0]?.values.qty).toBe(3);
  store.updateRow(table.id, row.id, { qty: 4 });
  expect(store.get(table.id)?.rows[0]?.values.qty).toBe(4);
  db.close();
});

it("patches rows in one save and converts values when a column changes type", () => {
  const { db, store } = open();
  const table = store.create("Tasks", null, [{ id: "name", name: "Name", type: "text", options: [] }, { id: "state", name: "State", type: "text", options: [] }], [
    { name: "A", state: "Open" },
  ]);
  const { table: patched } = store.patchRows(table.id, {
    update: [{ rowId: table.rows[0]!.id, values: { name: "A2" } }],
    insert: [{ id: "row_mine", values: { name: "B", state: "Done" }, before: table.rows[0]!.id }],
  });
  expect(patched.rows.map((row) => row.id)[0]).toBe("row_mine");
  const retyped = store.update(table.id, { columns: [patched.columns[0]!, { ...patched.columns[1]!, type: "select" }] });
  expect(retyped.columns[1]!.options).toEqual(["Done", "Open"]);
  expect(retyped.rows.map((row) => row.values.state)).toEqual(["Done", "Open"]);
  db.close();
});

it("imports CSV by header name, adding columns it doesn't have", () => {
  const { db, store } = open();
  const table = store.create("People", null);
  expect(store.importCsv(table.id, "Role,name\nLead,Ada\n")).toBe(1);
  const imported = store.require(table.id);
  expect(imported.columns.map((column) => column.name)).toEqual(["Name", "Role"]);
  expect(imported.rows[0]!.values).toMatchObject({ name: "Ada" });
  db.close();
});

it("deletes the select column a table's only board view groups by", () => {
  const { db, store } = open();
  const table = store.create("Tasks", null, [
    { id: "name", name: "Name", type: "text", options: [] },
    { id: "state", name: "State", type: "select", options: ["Open"] },
  ]);
  store.update(table.id, { views: [{ id: "board", name: "Board", type: "board", groupBy: "state", dateBy: null, filters: [], sorts: [], hidden: [] }] });
  const saved = store.update(table.id, { columns: [{ id: "name", name: "Name", type: "text", options: [] }] });
  expect(saved.columns.map((column) => column.id)).toEqual(["name"]);
  expect(saved.views).toHaveLength(1);
  expect(saved.views[0]!.type).toBe("table");
  db.close();
});
