import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { inSpace, linkedSpaceIds, parentSpaceIds, PROJECT_REF, spaceAssignments, SpaceStore, spacePath, THREAD_REF, threadInSpace } from "./spaces";
import { pageWidgets, SPACE_TEMPLATE_VERSION, SPACE_WIDGETS, spacePageMarkdown, widgetsMarkdown, widgetsSince } from "./space-page";
import { TagStore } from "./tags";
import { firstThreadSpaceIds } from "./thread-item-refs";

function stores() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return { tags: new TagStore(db), spaces: new SpaceStore(db) };
}

const page = { pluginId: "pages", id: "pg_1", projectId: null };
const drawing = { pluginId: "excalidraw", id: "d1", projectId: "proj_app" };

describe("spaces", () => {
  it("keep their page, and start it with every widget", () => {
    const { spaces } = stores();
    const launch = spaces.create({ name: "Launch", description: "Q4 launch" });
    expect(launch.pageId).toBeNull();
    spaces.setPage(launch.id, "pg_1");
    expect(spaces.get(launch.id)!.pageId).toBe("pg_1");
    const markdown = spacePageMarkdown(launch);
    expect(markdown.startsWith("Q4 launch")).toBe(true);
    for (const section of ["actions", "recent", "threads", "channels", "projects"]) expect(markdown).toContain(`{"kind":"space","target":"${launch.id}/${section}"}`);
  });

  it("know which widgets a page holds, and which the template gained", () => {
    const { spaces } = stores();
    const launch = spaces.create({ name: "Launch" });
    expect(spaces.pageTemplate(launch.id)).toBe(1);
    spaces.setPage(launch.id, "pg_1", 3);
    expect(spaces.pageTemplate(launch.id)).toBe(3);
    const other = ["```embed", '{"kind":"space","target":"spc_other/threads"}', "```"].join("\n");
    const page = [widgetsMarkdown(launch, ["actions", "recent"]), other].join("\n\n");
    expect([...pageWidgets(page, launch.id)]).toEqual(["actions", "recent"]);
    expect(widgetsMarkdown(launch, ["threads"])).toMatch(/^## Threads\n\n```embed/);
    expect(widgetsSince(SPACE_TEMPLATE_VERSION)).toEqual([]);
    expect(widgetsSince(0)).toEqual([...SPACE_WIDGETS]);
  });

  it("are kept apart from tags", () => {
    const { tags, spaces } = stores();
    const launch = spaces.create({ name: "Launch", description: "Q4 launch" });
    tags.ensure("Research");
    expect(tags.list().map((tag) => tag.name)).toEqual(["Research"]);
    expect(spaces.list().map((space) => space.name)).toEqual(["Launch"]);
    // Tag operations can't reach a space.
    expect(() => tags.ensure("launch")).toThrow(/is a space/);
    tags.apply([page], [launch.id], []);
    expect(spaces.get(launch.id)!.itemKeys).toEqual([]);
    tags.remove(launch.id);
    expect(spaces.get(launch.id)).not.toBeNull();
    expect(() => tags.rename(launch.id, "Other")).toThrow();
  });

  it("share names with tags without clashing", () => {
    const { tags, spaces } = stores();
    tags.ensure("Launch");
    expect(() => spaces.create({ name: "launch" })).toThrow(/tag called/);
    const space = spaces.create({ name: "Orbit" });
    expect(() => tags.rename(tags.byName("Launch")!.id, "orbit")).toThrow(/space called/);
    expect(() => spaces.update(space.id, { name: "Launch" })).toThrow(/tag called/);
  });

  it("hold items, projects and threads", () => {
    const { spaces } = stores();
    const space = spaces.create({ name: "Launch", defaultProjectId: "proj_app" });
    expect(space.projectIds).toEqual(["proj_app"]);
    spaces.add(space.id, [page, { pluginId: THREAD_REF, id: "thr_1" }, { pluginId: PROJECT_REF, id: "proj_docs" }]);
    const held = spaces.get(space.id)!;
    expect(held.itemKeys).toEqual(["pages:pg_1"]);
    expect(held.threadIds).toEqual(["thr_1"]);
    expect(held.projectIds.sort()).toEqual(["proj_app", "proj_docs"]);
    // A project's items and threads belong without being added.
    expect(inSpace(held, drawing)).toBe(true);
    expect(inSpace(held, { pluginId: "pages", id: "pg_2", projectId: null })).toBe(false);
    expect(threadInSpace(held, { id: "thr_2", projectId: "proj_docs" })).toBe(true);
    expect(threadInSpace(held, { id: "thr_1", projectId: "proj_other" })).toBe(true);
    expect(threadInSpace(held, { id: "thr_3", projectId: "proj_other" })).toBe(false);
    expect(spaceAssignments([held], [page, drawing, { pluginId: "pages", id: "pg_2", projectId: null }])).toEqual(
      new Map([["pages:pg_1", [space.id]], ["excalidraw:d1", [space.id]]]),
    );
  });

  it("clear the default project when it leaves", () => {
    const { spaces } = stores();
    const space = spaces.create({ name: "Launch", defaultProjectId: "proj_app" });
    spaces.removeMembers(space.id, [{ pluginId: PROJECT_REF, id: "proj_app" }]);
    expect(spaces.get(space.id)).toMatchObject({ projectIds: [], defaultProjectId: null });
  });

  it("forget deleted items and leave members alone when deleted", () => {
    const { tags, spaces } = stores();
    const space = spaces.create({ name: "Launch" });
    spaces.add(space.id, [page, { pluginId: THREAD_REF, id: "thr_1" }]);
    // Pruning a provider's items leaves thread and project members be.
    tags.prune("pages", new Set());
    expect(spaces.get(space.id)).toMatchObject({ itemKeys: [], threadIds: ["thr_1"] });
    spaces.remove(space.id);
    expect(spaces.list()).toEqual([]);
    expect(() => spaces.add(space.id, [page])).toThrow(/no longer exists/);
  });

  it("finds a space by id or name", () => {
    const { spaces } = stores();
    const space = spaces.create({ name: "Launch Plan" });
    expect(spaces.find(space.id)?.id).toBe(space.id);
    expect(spaces.find("#launch plan")?.id).toBe(space.id);
    expect(spaces.find("nope")).toBeNull();
  });

  it("are joined by threads that link them", () => {
    const link = spacePath("spc_0123456789abcdef");
    expect(linkedSpaceIds(`Work on ${link} and ${link}`)).toEqual(["spc_0123456789abcdef"]);
    expect(firstThreadSpaceIds([{ type: "client/thread/start", data: { input: [{ type: "text", text: `In ${link}` }] } }])).toEqual(["spc_0123456789abcdef"]);
    expect(firstThreadSpaceIds([])).toBeNull();
  });

  it("take in sub-items made under their items or their page", () => {
    const { spaces } = stores();
    const launch = spaces.create({ name: "Launch" });
    spaces.setPage(launch.id, "pg_home");
    spaces.add(launch.id, [{ pluginId: "pages", id: "pg_1" }]);
    const app = spaces.create({ name: "App" });
    spaces.add(app.id, [{ pluginId: PROJECT_REF, id: "proj_app" }, { pluginId: "pages", id: "pg_1" }]);
    const all = spaces.list();
    const child = (parentId: string | null, projectId: string | null = null) => ({ pluginId: "pages", id: "pg_2", parentId, projectId });
    expect(parentSpaceIds(all, child("pg_1"), "pages")).toEqual([app.id, launch.id]);
    // Already in App through its project.
    expect(parentSpaceIds(all, child("pg_1", "proj_app"), "pages")).toEqual([launch.id]);
    expect(parentSpaceIds(all, child("pg_home"), "pages")).toEqual([launch.id]);
    expect(parentSpaceIds(all, { ...child("pg_home"), pluginId: "excalidraw" }, "pages")).toEqual([]);
    expect(parentSpaceIds(all, child(null), "pages")).toEqual([]);
  });
});
