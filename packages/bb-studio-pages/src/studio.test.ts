import { describe, expect, it } from "vitest";
import type { PageMeta } from "./store";
import { excerpt, plainText, toStudioItem } from "./studio";

const meta = (overrides: Partial<PageMeta> = {}): PageMeta => ({
  id: "pg_1",
  project_id: "proj_a",
  parent_id: null,
  title: "Plan",
  icon: "",
  position: 0,
  created_at: 1,
  updated_at: 2,
  updated_by: "user",
  archived_at: null,
  ...overrides,
});

describe("excerpt", () => {
  it("takes the first line of prose, without Markdown syntax", () => {
    expect(excerpt("# Goals <!-- ^b1 -->\n\n- **Ship** the [kit](https://x.test) by @[Friday](date:2026-10-02)")).toBe("Goals");
    expect(excerpt("```chart\n{}\n```\n\n> [!NOTE] Watch `this`")).toBe("Watch this");
    expect(excerpt("---\n\n| a | b |\n\n1. First step")).toBe("First step");
  });

  it("is null for an empty page and truncates long lines", () => {
    expect(excerpt("")).toBeNull();
    expect(excerpt("```\ncode only\n```")).toBeNull();
    const long = excerpt("word ".repeat(100))!;
    expect(long.length).toBeLessThanOrEqual(140);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("toStudioItem", () => {
  it("maps a page onto the Studio item shape", () => {
    expect(toStudioItem(meta({ icon: "📝" }), "Hello")).toMatchObject({
      id: "pg_1",
      kind: "page",
      icon: "📝",
      projectId: "proj_a",
      updatedBy: "user",
      preview: "Hello",
      badge: null,
      href: "/plugins/pages/pages/pg_1",
      archived: false,
    });
  });

  it("tells agents from people", () => {
    const item = toStudioItem(meta({ icon: "", updated_by: "agent:thr_x", archived_at: 5 }), null);
    expect(item).toMatchObject({ icon: null, updatedBy: "agent", preview: null, archived: true, badge: null });
  });
});

describe("the Studio provider", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { z } = await import("zod");
  const { studioSchemas } = await import("@bb-studio/kit/contract");
  const { MIGRATIONS, PageStore } = await import("./store");
  const { PagesService } = await import("./service");
  const { registerStudio } = await import("./studio");
  const { HUMAN_USER_ID } = await import("./constants");

  function setup() {
    const db = new Database(":memory:");
    for (const sql of MIGRATIONS) db.exec(sql);
    const store = new PageStore(db);
    const events: unknown[] = [];
    let handlers: Record<string, (input: unknown) => unknown> = {};
    const bb = {
      realtime: { publish: (_channel: string, event: unknown) => events.push(event) },
      rpc: { register: (_contract: unknown, registered: typeof handlers) => (handlers = registered) },
    };
    const service = new PagesService(bb as never, store);
    registerStudio(bb as never, service, studioSchemas(z));
    const create = (title: string, projectId: string | null, parentId: string | null = null) =>
      service.createPage({ projectId, parentId, title, actor: HUMAN_USER_ID }).id;
    return { store, service, events, create, call: async (method: string, input: unknown): Promise<any> => handlers[method]!(input) };
  }

  it("describes one kind and lists archived pages too", async () => {
    const { create, call } = setup();
    const id = create("Plan", "proj_a");
    await call("studio_archive", { ids: [id], archived: true });
    const info = await call("studio_describe", null);
    expect(info).toMatchObject({ pluginId: "pages", panel: "pages", kinds: [{ id: "page" }] });
    const { items } = await call("studio_list", null);
    expect(items).toMatchObject([{ id, archived: true, title: "Plan" }]);
  });

  it("duplicates a page tree and instantiates Markdown variables", async () => {
    const { store, create, call } = setup();
    const parent = create("{{name}} plan", "proj_a");
    const child = create("Next step", "proj_a", parent);
    await call("studio_template", { id: parent, template: true });
    const { item } = await call("studio_instantiate", { id: parent, projectId: "proj_b", variables: { name: "Launch" } });
    expect(item).toMatchObject({ title: "Launch plan", projectId: "proj_b", template: false });
    expect(store.list({ includeArchived: true }).some((page) => page.parent_id === item.id && page.title === "Next step")).toBe(true);
    const copy = await call("studio_duplicate", { id: child, projectId: null, includeChildren: false });
    expect(copy.item.title).toBe("Next step (copy)");
  });

  it("duplicates an open page's unsaved edits", async () => {
    const { store, service, create, call } = setup();
    const { applyEdits } = await import("./doc");
    const id = create("Plan", "proj_a");
    applyEdits(service.hub.open(id).doc, [{ op: "append", markdown: "Typed just now" }], "user");
    expect(store.get(id)!.markdown).not.toContain("Typed just now");
    const { item } = await call("studio_duplicate", { id, projectId: "proj_a", includeChildren: false });
    expect(store.get(item.id)!.markdown).toContain("Typed just now");
    service.hub.disposeAll();
  });

  it("moves sub-pages along, and detaches a page from a parent left behind", async () => {
    const { store, create, call, events } = setup();
    const parent = create("Parent", "proj_a");
    const child = create("Child", null, parent);
    const grandchild = create("Grandchild", null, child);
    events.length = 0;

    expect(await call("studio_move", { ids: [child], projectId: "proj_b" })).toEqual({ done: [child], failed: [] });
    expect(store.meta(child)).toMatchObject({ project_id: "proj_b", parent_id: null });
    expect(store.meta(grandchild)).toMatchObject({ project_id: "proj_b", parent_id: child });
    expect(store.meta(parent)!.project_id).toBe("proj_a");
    expect(events).toEqual(expect.arrayContaining([{ type: "tree", projectId: "proj_a" }, { type: "tree", projectId: "proj_b" }]));

    // Moving a parent with its child keeps them together.
    await call("studio_move", { ids: [parent, child], projectId: "proj_b" });
    await call("studio_move", { ids: [parent, child], projectId: null });
    expect(store.meta(parent)!.project_id).toBeNull();
  });

  it("renames a page and tells open views", async () => {
    const { store, create, call, events } = setup();
    const id = create("Plan", "proj_a");
    events.length = 0;
    expect(await call("studio_rename", { id, title: "Launch plan" })).toEqual({ done: [id], failed: [] });
    expect(store.meta(id)!.title).toBe("Launch plan");
    expect(events).toEqual([{ type: "tree", projectId: "proj_a" }]);
    expect(await call("studio_rename", { id: "pg_missing", title: "X" })).toEqual({ done: [], failed: [{ id: "pg_missing", error: "Page not found." }] });
  });

  it("counts sub-pages deleted with their parent as done", async () => {
    const { store, create, call } = setup();
    const parent = create("Parent", "proj_a");
    const child = create("Child", null, parent);
    expect(await call("studio_delete", { ids: [parent, child, "pg_missing"] })).toEqual({
      done: [parent, child],
      failed: [{ id: "pg_missing", error: "Page not found." }],
    });
    expect(store.meta(child)).toBeNull();
  });

  it("creates untitled pages and copies Markdown", async () => {
    const { call } = setup();
    const { item } = await call("studio_create", { kind: "page", projectId: "proj_a" });
    expect(item).toMatchObject({ title: "", projectId: "proj_a", kind: "page" });
    const copied = await call("studio_action", { action: "copy-markdown", ids: [item.id] });
    expect(copied.message).toBe("Copied as Markdown");
    await expect(call("studio_action", { action: "nope", ids: [item.id] })).rejects.toThrow('Unknown action "nope"');
  });
});

describe("plainText", () => {
  it("keeps every line's words without Markdown syntax", () => {
    expect(plainText("# Goals\n\n- **Ship** the [kit](https://x.test)\n\n```ts\nconst pricing = 1;\n```\n\n---")).toBe(
      "Goals\nShip the kit\nconst pricing = 1;",
    );
  });

  it("leaves out chart, stats and embed settings", () => {
    expect(plainText('Launch\n\n```chart\n{"type":"bar","data":[]}\n```\n\n```stats\n[]\n```\n\nChecklist')).toBe("Launch\nChecklist");
  });
});
