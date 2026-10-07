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

it("keeps a column or option added while the UI saved its stale column list", () => {
  const { db, store } = open();
  const table = store.create("Tasks", null, [
    { id: "name", name: "Name", type: "text", options: [] },
    { id: "state", name: "State", type: "select", options: ["Open"] },
  ]);
  const base = table.columns;
  // An agent adds an option and, through an import, a column the UI hasn't seen.
  const row = store.insert(table.id, { name: "Ship", state: "Blocked" });
  store.importCsv(table.id, "Name,Owner\nDocs,Ada\n");
  // The UI resizes a column from what it last loaded.
  const saved = store.update(table.id, { columns: base.map((column) => (column.id === "name" ? { ...column, width: 240 } : column)), baseColumns: base });
  expect(saved.columns.map((column) => column.name)).toEqual(["Name", "State", "Owner"]);
  expect(saved.columns[0]!.width).toBe(240);
  expect(saved.columns[1]!.options).toEqual(["Open", "Blocked"]);
  expect(saved.rows.find((each) => each.id === row.id)!.values.state).toBe("Blocked");
  expect(saved.rows.at(-1)!.values[saved.columns[2]!.id]).toBe("Ada");
  // Removing what the UI did know still removes it.
  const removed = store.update(table.id, { columns: [saved.columns[0]!, saved.columns[2]!], baseColumns: saved.columns });
  expect(removed.columns.map((column) => column.name)).toEqual(["Name", "Owner"]);
  db.close();
});

/** A table that already holds `link`, saved before the store checked it. */
function legacy(db: Database.Database, store: TableStore, column: { id: string; name: string; type: "url" | "date" }, stored: string) {
  const table = store.create("Legacy", null, [{ id: "name", name: "Name", type: "text", options: [] }, { ...column, options: [] }], [{ name: "Old" }]);
  const data = { columns: table.columns, views: table.views, rows: [{ ...table.rows[0]!, values: { name: "Old", [column.id]: stored } }] };
  db.prepare("UPDATE studio_tables SET data=? WHERE id=?").run(JSON.stringify(data), table.id);
  return table;
}

it("rejects script and data URLs on new input but keeps saving a table that holds one", () => {
  const { db, store } = open();
  const table = legacy(db, store, { id: "link", name: "Link", type: "url" }, "javascript:alert(1)");
  for (const link of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<script>1</script>", "vbscript:msgbox(1)"])
    expect(() => store.insert(table.id, { link })).toThrow(/Invalid URL/);
  expect(store.insert(table.id, { link: "https://example.com" }).values.link).toBe("https://example.com");
  expect(store.updateRow(table.id, table.rows[0]!.id, { name: "Renamed" }).values).toMatchObject({ name: "Renamed", link: "javascript:alert(1)" });
  expect(store.importCsv(table.id, "Name,Link\nNew,javascript:alert(1)\n")).toBe(1);
  expect(store.require(table.id).rows.at(-1)!.values.link).toBeNull();
  db.close();
});
