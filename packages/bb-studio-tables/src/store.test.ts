import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { MIGRATIONS, TableStore } from "./store";
it("persists tables and validates row updates", () => {
  const db = new Database(":memory:");
  db.exec(MIGRATIONS[0]!);
  const store = new TableStore(db);
  const table = store.create("Inventory", "project-1", [
    { id: "qty", name: "Quantity", type: "number", options: [] },
  ]);
  const row = store.insert(table.id, { qty: 3 });
  expect(store.get(table.id)?.rows[0]?.values.qty).toBe(3);
  expect(() => store.updateRow(table.id, row.id, { qty: "wrong" })).toThrow(
    /Invalid value/,
  );
  expect(store.get(table.id)?.rows[0]?.values.qty).toBe(3);
  store.updateRow(table.id, row.id, { qty: 4 });
  expect(store.get(table.id)?.rows[0]?.values.qty).toBe(4);
  db.close();
});
