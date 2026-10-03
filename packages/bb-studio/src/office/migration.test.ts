import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../migrations";
import { migrateOfficeSpaces } from "./migration";

function legacyCopy() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const sql of MIGRATIONS) db.exec(sql);
  db.exec(`INSERT INTO tags VALUES ('s1','Work','#abc',1,'space'), ('s2','Other','#def',2,'space'), ('tag','Keep','#000',0,'tag');
    INSERT INTO spaces(tag_id,default_project_id,page_id) VALUES ('s1','p1','page-home'),('s2','p1',NULL);
    INSERT INTO item_tags VALUES ('bb-project','p1','s1',1),('bb-project','p1','s2',2),
      ('pages','matched','s1',3),('pages','mismatch','s2',4),('pages','unknown','s1',5),
      ('bb-thread','thread','s2',6),('pages','existing','tag',1);`);
  const copy = new Database(db.serialize());
  copy.pragma("foreign_keys = ON");
  db.close();
  return copy;
}
const options = {
  projectIds: ["p1", "unfiled"], now: 100,
  projectForMember: ({ id }: { id: string }) => id === "unknown" ? undefined : "p1",
  logConflict: (_: string) => {},
};

describe("Space root migration", () => {
  it("keeps IDs, page metadata and unmatched refs, and assigns one owner per project", () => {
    const db = legacyCopy();
    const conflicts: string[] = [];
    migrateOfficeSpaces(db, { ...options, logConflict: m => conflicts.push(m) });
    expect(db.prepare("SELECT project_id,space_id FROM space_projects ORDER BY project_id").all()).toEqual([
      { project_id: "p1", space_id: "s1" }, { project_id: "proj_personal", space_id: "spc_personal" }, { project_id: "unfiled", space_id: "spc_personal" },
    ]);
    expect(db.prepare("SELECT page_id FROM spaces WHERE id='s1'").get()).toEqual({ page_id: "page-home" });
    expect(db.prepare("SELECT default_project_id FROM spaces WHERE id='s2'").get()).toEqual({ default_project_id: null });
    expect(db.prepare("SELECT item_id FROM item_tags ORDER BY item_id").all()).toEqual(["existing", "mismatch", "p1", "thread", "unknown"].map(item_id => ({ item_id })));
    expect(db.prepare("SELECT COUNT(*) n FROM tags WHERE kind='space'").get()).toEqual({ n: 0 });
    expect(conflicts).toHaveLength(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    const before = db.serialize();
    migrateOfficeSpaces(db, options);
    expect(db.serialize()).toEqual(before);
    db.close();
  });
  it("rolls back schema and membership changes when resolution fails", () => {
    const db = legacyCopy();
    expect(() => migrateOfficeSpaces(db, { ...options, projectForMember: () => { throw new Error("provider failure"); } })).toThrow("provider failure");
    expect(db.prepare("SELECT COUNT(*) n FROM item_tags").get()).toEqual({ n: 7 });
    expect(db.prepare("SELECT tag_id FROM spaces ORDER BY tag_id").all()).toEqual([{ tag_id: "s1" }, { tag_id: "s2" }]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='space_projects'").get()).toBeUndefined();
    migrateOfficeSpaces(db, options);
    expect(db.prepare("SELECT COUNT(*) n FROM spaces WHERE is_default=1").get()).toEqual({ n: 1 });
    db.close();
  });
});
