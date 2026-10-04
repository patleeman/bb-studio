import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { inSpace, PERSONAL_PROJECT_ID, PROJECT_REF, spaceAssignments, SpaceStore, THREAD_REF } from "./spaces";
import { spacePageMarkdown } from "./space-page";
import { TagStore } from "./tags";

function stores() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  return { db, tags: new TagStore(db), spaces: new SpaceStore(db) };
}

describe("spaces", () => {
  it("set up on an empty data directory, and again on restart", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
    try {
      const db = bb.storage.database();
      bb.storage.migrate(db, MIGRATIONS);
      expect(new SpaceStore(db).list().map((space) => space.name)).toEqual(["Personal"]);
      bb.storage.migrate(db, MIGRATIONS);
      expect(new SpaceStore(db).list()).toHaveLength(1);
    } finally { await harness.lifecycle.dispose(); }
  });


  it("start with the default space, which owns Personal and unknown projects", () => {
    const { db, spaces } = stores();
    const personal = spaces.defaultSpace();
    expect(personal).toMatchObject({ name: "Personal", isDefault: true, defaultProjectId: PERSONAL_PROJECT_ID, projectIds: [PERSONAL_PROJECT_ID] });
    // Opening the store again keeps the one default space.
    expect(new SpaceStore(db).list()).toHaveLength(1);
    expect(spaces.forProject(null).id).toBe(personal.id);
    expect(spaces.forProject("outside").id).toBe(personal.id);
    spaces.reconcileProjects(["outside"]);
    expect(spaces.defaultSpace().projectIds).toContain("outside");
    expect(() => spaces.remove(personal.id)).toThrow("can't be deleted");
  });

  it("keep their page, and start it as a brief", () => {
    const { spaces } = stores();
    const launch = spaces.create({ name: "Launch", description: "Q4 launch" });
    expect(launch.pageId).toBeNull();
    spaces.setPage(launch.id, "pg_1");
    expect(spaces.get(launch.id)!.pageId).toBe("pg_1");
    expect(spacePageMarkdown(launch)).toBe("Q4 launch\n\n## Plan\n\n## Decisions");
  });

  it("are kept apart from tags, and have unique names", () => {
    const { tags, spaces } = stores();
    tags.ensure("Launch");
    const launch = spaces.create({ name: "Launch" });
    expect(tags.list().map((tag) => tag.name)).toEqual(["Launch"]);
    expect(() => spaces.create({ name: "launch" })).toThrow(/space called/);
    const orbit = spaces.create({ name: "Orbit" });
    expect(() => spaces.update(orbit.id, { name: "LAUNCH" })).toThrow(/space called/);
    expect(spaces.update(launch.id, { name: "Launch 2", icon: "🚀" })).toMatchObject({ name: "Launch 2", icon: "🚀" });
  });

  it("own whole projects, and threads added one by one", () => {
    const { spaces } = stores();
    const space = spaces.create({ name: "Launch", defaultProjectId: "proj_app" });
    expect(space.projectIds).toEqual(["proj_app"]);
    spaces.add(space.id, [{ pluginId: THREAD_REF, id: "thr_1" }, { pluginId: PROJECT_REF, id: "proj_docs" }]);
    const held = spaces.get(space.id)!;
    expect(held.threadIds).toEqual(["thr_1"]);
    expect(held.projectIds.sort()).toEqual(["proj_app", "proj_docs"]);
    expect(() => spaces.add(space.id, [{ pluginId: "pages", id: "pg_1" }])).toThrow(/follow their project/);
    const drawing = { pluginId: "excalidraw", id: "d1", projectId: "proj_app" };
    const global = { pluginId: "pages", id: "pg_2", projectId: null };
    expect(inSpace(held, drawing)).toBe(true);
    expect(inSpace(held, global)).toBe(false);
    expect(spaceAssignments([held, spaces.defaultSpace()], [drawing, global])).toEqual(new Map([["excalidraw:d1", [space.id]], ["pages:pg_2", [spaces.defaultSpace().id]]]));
    // A thread is in one space: the one it was added to, else its project's.
    expect(spaces.ownerOfThread({ id: "thr_1", projectId: null })).toBe(space.id);
    expect(spaces.ownerOfThread({ id: "thr_2", projectId: "proj_docs" })).toBe(space.id);
    spaces.removeMembers(space.id, [{ pluginId: THREAD_REF, id: "thr_1" }, { pluginId: PROJECT_REF, id: "proj_docs" }]);
    expect(spaces.ownerOfThread({ id: "thr_1", projectId: null })).toBe(spaces.defaultSpace().id);
    expect(spaces.forProject("proj_docs").isDefault).toBe(true);
  });

  it("protect a catch-all project and Personal", () => {
    const { spaces } = stores();
    const space = spaces.create({ name: "Launch", defaultProjectId: "proj_app" });
    expect(() => spaces.moveProject("proj_app", spaces.defaultSpace().id)).toThrow(/catch-all/);
    expect(() => spaces.moveProject(PERSONAL_PROJECT_ID, space.id)).toThrow(/Personal/);
  });

  it("hand their projects and threads back to the default space when deleted", () => {
    const { db, spaces } = stores();
    const space = spaces.create({ name: "Launch", defaultProjectId: "proj_app" });
    spaces.add(space.id, [{ pluginId: THREAD_REF, id: "thr_1" }]);
    spaces.remove(space.id);
    expect(spaces.list().map((each) => each.name)).toEqual(["Personal"]);
    expect(spaces.forProject("proj_app").isDefault).toBe(true);
    expect(spaces.threads.explicit("thr_1")).toBeNull();
    expect(() => spaces.add(space.id, [{ pluginId: THREAD_REF, id: "thr_2" }])).toThrow(/no longer exists/);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("finds a space by id or name", () => {
    const { spaces } = stores();
    const space = spaces.create({ name: "Launch Plan" });
    expect(spaces.find(space.id)?.id).toBe(space.id);
    expect(spaces.find("#launch plan")?.id).toBe(space.id);
    expect(spaces.find("nope")).toBeNull();
  });
});
