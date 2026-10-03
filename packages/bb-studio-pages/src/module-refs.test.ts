import Database from "better-sqlite3";
import * as Y from "yjs";
import { expect, it } from "vitest";
import { seedMarkdown, readMarkdown, readBlocks } from "./doc";
import { MIGRATIONS, PageStore } from "./store";
import { THREADS_MAP } from "./schema-config";
import { migratePageModuleRefs } from "./module-refs";

it("migrates live Yjs content and comments with original state backups and stable block ids", () => {
  const db = new Database(":memory:");
  const doc = new Y.Doc();
  try {
    for (const sql of MIGRATIONS) db.exec(sql);
    const store = new PageStore(db);
    const page = store.create({ projectId: null, parentId: null, title: "Migration", actor: "test" });
    seedMarkdown(doc, "Keep **formatting** and [Table](/plugins/studio-tables/tables/tbl_1).");
    doc.getMap(THREADS_MAP).set("comment", { body: "See studio-tables:tbl_1", author: "me" });
    const ids = readBlocks(doc).map(block => block.id);
    const before = Buffer.from(Y.encodeStateAsUpdate(doc));
    store.saveContent(page.id, before, readMarkdown(doc), null);
    expect(migratePageModuleRefs(db)).toBeGreaterThan(0);
    const row = db.prepare("SELECT state, markdown FROM pages WHERE id = ?").get(page.id) as { state: Buffer; markdown: string };
    const migrated = new Y.Doc();
    try {
      Y.applyUpdate(migrated, row.state);
      expect(readBlocks(migrated).map(block => block.id)).toEqual(ids);
      expect(row.markdown).toContain("/plugins/studio/tables/tbl_1");
      expect(row.markdown).toContain("**formatting**");
      expect(migrated.getMap(THREADS_MAP).get("comment")).toEqual({ body: "See studio:tbl_1", author: "me" });
      expect(db.prepare("SELECT state FROM studio_ref_backups WHERE source_id = ?").get(page.id)).toEqual({ state: before });
      expect(migratePageModuleRefs(db)).toBe(0);
    } finally { migrated.destroy(); }
  } finally { doc.destroy(); db.close(); }
});
