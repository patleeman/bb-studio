import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrateModuleRefs } from "./refs";

it("rewrites owned ref columns, links and JSON once, keeping arbitrary labels", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE item_links (plugin_id TEXT, body TEXT, metadata TEXT, label TEXT)");
    db.prepare("INSERT INTO item_links VALUES (?, ?, ?, ?)").run("studio-tables", "[Table](/plugins/studio-tables/tables/tbl_1)", '{"pluginId":"studio-tables","id":"tbl_1"}', "studio-tables");
    expect(migrateModuleRefs(db, ["studio-tables"])).toBe(3);
    expect(db.prepare("SELECT * FROM item_links").get()).toEqual({ plugin_id: "studio", body: "[Table](/plugins/studio/tables/tbl_1)", metadata: '{"pluginId":"studio","id":"tbl_1"}', label: "studio-tables" });
    expect(migrateModuleRefs(db, ["studio-tables"])).toBe(0);
  } finally { db.close(); }
});
it("preserves both sides and rolls back if canonical keys conflict", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE links (plugin_id TEXT PRIMARY KEY, value TEXT); INSERT INTO links VALUES ('studio', 'new'), ('studio-tables', 'old')");
    expect(() => migrateModuleRefs(db, ["studio-tables"])).toThrow();
    expect(db.prepare("SELECT count(*) AS n FROM links").get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT count(*) AS n FROM module_ref_rewrites").get()).toEqual({ n: 0 });
  } finally { db.close(); }
});
