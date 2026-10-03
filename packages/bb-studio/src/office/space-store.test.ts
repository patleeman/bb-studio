import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../migrations";
import { migrateOfficeSpaces } from "./migration";
import { OfficeSpaceStore } from "./space-store";

function setup() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  migrateOfficeSpaces(db, { projectIds: ["existing"], projectForMember: () => undefined, logConflict: () => {} });
  return { db, store: new OfficeSpaceStore(db) };
}

describe("Office Space ownership", () => {
  it("assigns unknown and null-project work to Personal and moves whole projects", () => {
    const { db, store } = setup();
    const personal = store.defaultSpace();
    expect(store.forProject(null).id).toBe(personal.id);
    expect(store.forProject("outside").id).toBe(personal.id);
    const work = store.create({ name: "Work" });
    store.moveProject("existing", work.id);
    store.reconcileProjects(["existing", "outside"]);
    expect(store.forProject("existing").id).toBe(work.id);
    expect(store.get(personal.id).projectIds).toContain("outside");
    expect(() => store.moveProject("proj_personal", work.id)).toThrow("default Space");
    expect(() => store.remove(work.id)).toThrow("folders");
    store.moveProject("existing", personal.id);
    store.remove(work.id);
    expect(() => store.get(work.id)).toThrow("no longer exists");
    expect(() => store.remove(personal.id)).toThrow("cannot be deleted");
    db.close();
  });
  it("persists scoped settings and protects a catch-all folder", () => {
    const { db, store } = setup();
    const work = store.create({ name: "Work" });
    store.setCatchAll(work.id, "catchall");
    expect(store.get(work.id).defaultProjectId).toBe("catchall");
    expect(() => store.moveProject("catchall", store.defaultSpace().id)).toThrow("catch-all");
    store.setSettings(work.id, { defaultTrust: "act", enabledItemKinds: ["page"] });
    const reopened = new OfficeSpaceStore(db);
    expect(reopened.settings(work.id)).toEqual({ defaultTrust: "act", enabledItemKinds: ["page"], defaultBotModel: null });
    expect(reopened.settings(store.defaultSpace().id).defaultTrust).toBe("ask");
    expect(() => store.setSettings(work.id, { defaultTrust: "invalid" as never })).toThrow();
    expect(store.settings(work.id).defaultTrust).toBe("act");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });
});

it("migrates the provisional read_only label without losing its original value", () => {
  const { db, store } = setup(); const id=store.defaultSpace().id;
  db.prepare("INSERT INTO space_settings VALUES (?, 'defaultTrust', ?)").run(id,JSON.stringify("read_only"));
  expect(store.settings(id).defaultTrust).toBe("ask");
  expect(db.prepare("SELECT value FROM space_settings WHERE key='office.previousDefaultTrust'").get()).toEqual({value:'"read_only"'});
  expect(store.setSettings(id,{defaultTrust:"act"}).defaultTrust).toBe("act");
  db.close();
});
