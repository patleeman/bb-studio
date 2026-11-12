import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../migrations";
import { ExplorerStore, FOLDER_DEPTH_MAX, folderName } from "./store";

function store() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return new ExplorerStore(db);
}
const thread = (id: string) => ({ kind: "thread" as const, id });
const item = (id: string) => ({ kind: "item" as const, id });

describe("folders", () => {
  it("makes folders in a project, in No project, and inside another folder (taking its project)", () => {
    const explorer = store();
    const plans = explorer.createFolder({ projectId: "proj_a", parentId: null, name: "  Plans " }, 1);
    const loose = explorer.createFolder({ projectId: null, parentId: null, name: "Loose" }, 2);
    const inner = explorer.createFolder({ projectId: "proj_other", parentId: plans.id, name: "Q3" }, 3);
    expect(plans).toMatchObject({ projectId: "proj_a", parentId: null, name: "Plans", createdAt: 1 });
    expect(loose.projectId).toBeNull();
    expect(inner).toMatchObject({ projectId: "proj_a", parentId: plans.id });
    expect(explorer.path(inner.id).map((each) => each.name)).toEqual(["Plans", "Q3"]);
    expect(explorer.folders()).toHaveLength(3);
  });

  it("refuses an empty name, a missing parent and a second folder of the same name side by side", () => {
    const explorer = store();
    const plans = explorer.createFolder({ projectId: "proj_a", parentId: null, name: "Plans" });
    expect(() => explorer.createFolder({ projectId: "proj_a", parentId: null, name: "   " })).toThrow("needs a name");
    expect(() => explorer.createFolder({ projectId: "proj_a", parentId: "fld_gone", name: "X" })).toThrow("gone");
    expect(() => explorer.createFolder({ projectId: "proj_a", parentId: null, name: "plans" })).toThrow("already a folder");
    // The same name is fine in another project, in No project, and one level down.
    explorer.createFolder({ projectId: "proj_b", parentId: null, name: "Plans" });
    explorer.createFolder({ projectId: null, parentId: null, name: "Plans" });
    explorer.createFolder({ projectId: "proj_a", parentId: plans.id, name: "Plans" });
    expect(folderName("a/b\nc")).toBe("a-b c");
  });

  it("renames, and keeps names apart", () => {
    const explorer = store();
    const a = explorer.createFolder({ projectId: null, parentId: null, name: "A" });
    explorer.createFolder({ projectId: null, parentId: null, name: "B" });
    expect(explorer.renameFolder(a.id, "a")).toMatchObject({ name: "a" });
    expect(() => explorer.renameFolder(a.id, "b")).toThrow("already a folder");
    expect(() => explorer.renameFolder("fld_gone", "x")).toThrow("gone");
  });

  it("moves a folder within its project, never into itself, its own folders or another project", () => {
    const explorer = store();
    const a = explorer.createFolder({ projectId: "p", parentId: null, name: "A" });
    const b = explorer.createFolder({ projectId: "p", parentId: a.id, name: "B" });
    const c = explorer.createFolder({ projectId: "p", parentId: null, name: "C" });
    const other = explorer.createFolder({ projectId: "q", parentId: null, name: "Other" });
    expect(() => explorer.moveFolder(a.id, a.id)).toThrow("into itself");
    expect(() => explorer.moveFolder(a.id, b.id)).toThrow("into itself");
    expect(() => explorer.moveFolder(a.id, other.id)).toThrow("stays in its project");
    expect(explorer.moveFolder(c.id, b.id).parentId).toBe(b.id);
    expect(explorer.path(c.id).map((each) => each.name)).toEqual(["A", "B", "C"]);
    expect(explorer.moveFolder(c.id, null).parentId).toBeNull();
  });

  it("stops nesting at the depth limit, on create and on move", () => {
    const explorer = store();
    let parent: string | null = null;
    for (let level = 0; level < FOLDER_DEPTH_MAX; level += 1) parent = explorer.createFolder({ projectId: null, parentId: parent, name: `L${level}` }).id;
    expect(() => explorer.createFolder({ projectId: null, parentId: parent, name: "too deep" })).toThrow("deeper");
    const pair = explorer.createFolder({ projectId: null, parentId: null, name: "Pair" });
    explorer.createFolder({ projectId: null, parentId: pair.id, name: "Inner" });
    expect(() => explorer.moveFolder(pair.id, parent)).toThrow("deeper");
  });

  it("deleting a folder moves its folders and filings up to its parent and keeps who filed them", () => {
    const explorer = store();
    const top = explorer.createFolder({ projectId: "p", parentId: null, name: "Top" });
    const mid = explorer.createFolder({ projectId: "p", parentId: top.id, name: "Mid" });
    const leaf = explorer.createFolder({ projectId: "p", parentId: mid.id, name: "Leaf" });
    explorer.file([thread("thr_1")], mid.id, "user", 10);
    explorer.file([item("pg_1")], mid.id, "auto", 11);
    explorer.file([item("pg_2")], leaf.id, "agent", 12);
    expect(explorer.deleteFolder(mid.id)).toBe(true);
    expect(explorer.folder(leaf.id)?.parentId).toBe(top.id);
    expect(explorer.filingOf(thread("thr_1"))).toMatchObject({ folderId: top.id, filedBy: "user", filedAt: 10 });
    expect(explorer.filingOf(item("pg_1"))).toMatchObject({ folderId: top.id, filedBy: "auto" });
    expect(explorer.filingOf(item("pg_2"))?.folderId).toBe(leaf.id);
    // A top folder's contents land at the project's root: the row stays, with no folder.
    expect(explorer.deleteFolder(top.id)).toBe(true);
    expect(explorer.folder(leaf.id)?.parentId).toBeNull();
    expect(explorer.filingOf(thread("thr_1"))).toMatchObject({ folderId: null, filedBy: "user" });
    expect(explorer.deleteFolder(top.id)).toBe(false);
  });

  it("a folder moving up beside one of the same name keeps both", () => {
    const explorer = store();
    const top = explorer.createFolder({ projectId: null, parentId: null, name: "Top" });
    explorer.createFolder({ projectId: null, parentId: null, name: "Notes" });
    const inner = explorer.createFolder({ projectId: null, parentId: top.id, name: "Notes" });
    explorer.deleteFolder(top.id);
    expect(explorer.folder(inner.id)).toMatchObject({ parentId: null, name: "Notes (2)" });
  });
});

describe("filing", () => {
  it("files one thing in one place: filing again moves it", () => {
    const explorer = store();
    const a = explorer.createFolder({ projectId: null, parentId: null, name: "A" });
    const b = explorer.createFolder({ projectId: null, parentId: null, name: "B" });
    explorer.file([thread("x")], a.id, "agent", 1);
    explorer.file([thread("x")], b.id, "user", 2);
    expect(explorer.filings()).toEqual([{ kind: "thread", id: "x", folderId: b.id, filedBy: "user", filedAt: 2 }]);
    // A thread and an item may share an id; they are filed apart.
    explorer.file([item("x")], a.id, "user", 3);
    expect(explorer.filings()).toHaveLength(2);
  });

  it("automatic filing never moves what the user placed, even at the project's root", () => {
    const explorer = store();
    const a = explorer.createFolder({ projectId: null, parentId: null, name: "A" });
    const b = explorer.createFolder({ projectId: null, parentId: null, name: "B" });
    explorer.file([item("pg_user")], a.id, "user");
    explorer.file([item("pg_root")], null, "user");
    explorer.file([item("pg_agent")], a.id, "agent");
    expect(explorer.file([item("pg_user"), item("pg_root"), item("pg_agent"), item("pg_new")], b.id, "auto")).toEqual([item("pg_agent"), item("pg_new")]);
    expect(explorer.filingOf(item("pg_user"))?.folderId).toBe(a.id);
    expect(explorer.filingOf(item("pg_root"))?.folderId).toBeNull();
    // The agent's tool is asked for by name, so it may move a user's row.
    expect(explorer.file([item("pg_user")], b.id, "agent")).toHaveLength(1);
    expect(explorer.filingOf(item("pg_user"))).toMatchObject({ folderId: b.id, filedBy: "agent" });
  });

  it("refuses a folder that is gone, and unfile forgets the row", () => {
    const explorer = store();
    expect(() => explorer.file([item("pg_1")], "fld_gone", "user")).toThrow("gone");
    explorer.file([item("pg_1")], null, "user");
    expect(explorer.unfile([item("pg_1"), item("pg_never")])).toBe(1);
    expect(explorer.filingOf(item("pg_1"))).toBeNull();
  });

  it("finds a path's folder without case and makes the missing ones", () => {
    const explorer = store();
    const plans = explorer.createFolder({ projectId: "p", parentId: null, name: "Plans" });
    const made = explorer.ensurePath("p", ["plans", "Q3", "Drafts"]);
    expect(explorer.path(made.id).map((each) => each.name)).toEqual(["Plans", "Q3", "Drafts"]);
    expect(explorer.path(made.id)[0]!.id).toBe(plans.id);
    expect(explorer.ensurePath("p", ["Plans", "q3", "drafts"]).id).toBe(made.id);
    expect(explorer.folders()).toHaveLength(3);
    expect(() => explorer.ensurePath("p", [])).toThrow();
    // A bad name part way leaves nothing half made.
    expect(() => explorer.ensurePath("p", ["New", " "])).toThrow("needs a name");
    expect(explorer.folders()).toHaveLength(3);
  });
});
