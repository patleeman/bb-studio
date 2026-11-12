import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { APP_TOOLS, appTools, familyTool, ToolBook, TYPE_TOOLS, type AgentTool } from "./family-tools";
import type { IndexedItem } from "./item-index";
import type { ItemType } from "./item-model";

const ctx = { threadId: "thr_1", projectId: "proj_a" };
const DESIGN = "dsn_0123456789abcdef";
const BOARD = "drw_0123456789abcdef";
const MINI = "mini_0123456789abcdef";
const DASHBOARD = "dsh_0123456789abcdef";
const ARTIFACT = "art_0123456789abcdef";

/** The parameters each type's own tool takes today (their server.ts), with a handler that says who ran. */
const ORIGINALS: Record<string, z.ZodType> = {
  pages_list: z.object({ query: z.string().max(200).optional() }),
  pages_read: z.object({ page: z.string().min(1) }),
  pages_create: z.object({ title: z.string().min(1).max(200), markdown: z.string().optional(), icon: z.string().optional(), parent: z.string().optional(), global: z.boolean().optional() }),
  design_list: z.object({}),
  design_read: z.object({ designId: z.string().min(1), screenIds: z.array(z.string()).optional() }),
  design_create: z.object({ name: z.string().min(1).max(200) }),
  whiteboard_list: z.object({}),
  whiteboard_get: z.object({ whiteboardId: z.string().min(1) }),
  whiteboard_create: z.object({ pageId: z.string().optional(), name: z.string().min(1), afterBlockId: z.string().optional() }),
  minis_list: z.object({}),
  minis_read: z.object({ miniId: z.string().min(1) }),
  minis_create: z.object({ name: z.string().min(1), files: z.record(z.string(), z.string()).optional() }),
  dashboard_list: z.object({}),
  dashboard_read: z.object({ dashboardId: z.string().min(1) }),
  dashboard_create: z.object({ name: z.string().min(1), widgets: z.array(z.unknown()).optional() }),
  artifacts_list: z.object({ thisThread: z.boolean().optional(), query: z.string().optional() }),
  artifacts_read: z.object({ artifactId: z.string().min(1) }),
  artifacts_save: z.object({ path: z.string().optional(), content: z.string().optional(), name: z.string().optional(), title: z.string().min(1) }),
};

function setup(off: ItemType[] = []) {
  const book = new ToolBook();
  const deps = { book, typeOn: (type: ItemType) => !off.includes(type) };
  const handlers: Record<string, ReturnType<typeof vi.fn>> = {};
  const registered = new Map<string, AgentTool>();
  const register = (tool: AgentTool) => { const named = familyTool(tool, deps); book.add(named); registered.set(named.name, named); };
  for (const [name, parameters] of Object.entries(ORIGINALS)) {
    handlers[name] = vi.fn(() => `ran ${name}`);
    register({ name, description: `Original ${name}.`, parameters, execute: handlers[name] as never });
  }
  const indexed: IndexedItem[] = [
    { pluginId: "minis", id: MINI, family: "app", type: "mini", title: "Tracker", projectId: null, parentId: null, createdAt: 1, updatedAt: 3, archived: false, template: false },
    { pluginId: "dashboards", id: DASHBOARD, family: "app", type: "dashboard", title: "Ops board", projectId: "proj_a", parentId: null, createdAt: 1, updatedAt: 2, archived: false, template: false },
    { pluginId: "artifacts", id: ARTIFACT, family: "app", type: "artifact", title: "Report", projectId: null, parentId: null, createdAt: 1, updatedAt: 1, archived: false, template: false },
  ];
  const index = { list: ({ type }: { type?: ItemType }) => indexed.filter((item) => !type || item.type === type), get: (id: string) => indexed.find((item) => item.id === id) ?? null };
  for (const tool of appTools({ ...deps, index })) register(tool);
  /** Calls a tool the way BB does: its registered parameters parse the input first. */
  const call = async (name: string, input: unknown) => { const tool = registered.get(name)!; return tool.execute(tool.parameters.parse(input) as never, ctx as never); };
  return { registered, handlers, call };
}

describe("every type's own tool", () => {
  it("keeps its name, its parameters and its handler", async () => {
    const { registered, handlers, call } = setup();
    for (const [name, parameters] of Object.entries(ORIGINALS)) {
      if (name.startsWith("pages_")) continue;
      expect(registered.get(name)!.parameters).toBe(parameters);
      expect(registered.get(name)!.execute).toBe(handlers[name]);
    }
    expect(await call("design_read", { designId: DESIGN })).toBe("ran design_read");
    expect(handlers.design_read).toHaveBeenCalledWith({ designId: DESIGN }, ctx);
  });

  it("says which family tool does the same", () => {
    const { registered } = setup();
    for (const type of ["design", "whiteboard"] as const) for (const action of ["list", "read", "create"] as const) expect(registered.get(TYPE_TOOLS[type][action])!.description).toMatch(/Original .+ type of page: pages_(list|read|create)/);
    for (const type of ["mini", "dashboard", "artifact"] as const) for (const action of ["list", "read", "create"] as const) expect(registered.get(TYPE_TOOLS[type][action])!.description).toMatch(/Original .+ type of app: apps_(list|read|create)/);
  });
});

describe("pages_* with a page type", () => {
  it("takes every input it took before and runs the pages handler with it", async () => {
    const { handlers, call } = setup();
    expect(await call("pages_list", {})).toBe("ran pages_list");
    expect(await call("pages_list", { query: "plan" })).toBe("ran pages_list");
    expect(handlers.pages_list).toHaveBeenLastCalledWith({ query: "plan" }, ctx);
    expect(await call("pages_read", { page: "Launch plan" })).toBe("ran pages_read");
    expect(await call("pages_read", { page: "pg_abc" })).toBe("ran pages_read");
    expect(await call("pages_create", { title: "Notes", markdown: "# Hi", global: true })).toBe("ran pages_create");
    expect(handlers.pages_create).toHaveBeenLastCalledWith({ title: "Notes", markdown: "# Hi", global: true }, ctx);
    expect(await call("pages_create", { title: "Notes", type: "doc" })).toBe("ran pages_create");
    expect(handlers.pages_create).toHaveBeenLastCalledWith({ title: "Notes" }, ctx);
  });

  it("lists, reads and creates a design through the design tools' own handlers", async () => {
    const { handlers, call } = setup();
    expect(await call("pages_list", { type: "design" })).toBe("ran design_list");
    expect(await call("pages_read", { page: DESIGN })).toBe("ran design_read");
    expect(handlers.design_read).toHaveBeenLastCalledWith({ designId: DESIGN }, ctx);
    expect(await call("pages_create", { title: "Onboarding deck", type: "design" })).toBe("ran design_create");
    expect(handlers.design_create).toHaveBeenLastCalledWith({ name: "Onboarding deck" }, ctx);
    expect(handlers.pages_list).not.toHaveBeenCalled();
    expect(handlers.pages_read).not.toHaveBeenCalled();
    expect(handlers.pages_create).not.toHaveBeenCalled();
  });

  it("does the same for a whiteboard", async () => {
    const { handlers, call } = setup();
    expect(await call("pages_list", { type: "whiteboard" })).toBe("ran whiteboard_list");
    expect(await call("pages_read", { page: BOARD })).toBe("ran whiteboard_get");
    expect(handlers.whiteboard_get).toHaveBeenLastCalledWith({ whiteboardId: BOARD }, ctx);
    expect(await call("pages_create", { title: "Sketch", type: "whiteboard" })).toBe("ran whiteboard_create");
    expect(handlers.whiteboard_create).toHaveBeenLastCalledWith({ name: "Sketch" }, ctx);
  });

  it("refuses a type that is turned off", async () => {
    const { handlers, call } = setup(["design"]);
    expect(await call("pages_read", { page: DESIGN })).toMatchObject({ isError: true });
    expect(handlers.design_read).not.toHaveBeenCalled();
  });
});

describe("apps_*", () => {
  it("are the three family tools", () => {
    expect([...setup().registered.keys()].filter((name) => name.startsWith("apps_"))).toEqual([...APP_TOOLS]);
  });

  it("lists every app from the index, with its type, id and family link", async () => {
    const { call, handlers } = setup();
    const listed = await call("apps_list", {}) as string;
    expect(listed.split("\n")).toHaveLength(3);
    expect(listed).toContain(`Ops board — Dashboard (id ${DASHBOARD}), project`);
    expect(listed).toContain(`link /plugins/studio/studio/apps/${ARTIFACT}`);
    expect(await call("apps_list", { query: "ops" })).toContain(DASHBOARD);
    expect(await call("apps_list", { query: "ops" })).not.toContain(MINI);
    for (const name of ["minis_list", "dashboard_list", "artifacts_list"]) expect(handlers[name]).not.toHaveBeenCalled();
  });

  it("lists one type through that type's own handler", async () => {
    const { call } = setup();
    expect(await call("apps_list", { type: "mini" })).toBe("ran minis_list");
    expect(await call("apps_list", { type: "dashboard" })).toBe("ran dashboard_list");
    expect(await call("apps_list", { type: "artifact" })).toBe("ran artifacts_list");
  });

  it("reads any app by id through its type's own handler", async () => {
    const { call, handlers } = setup();
    expect(await call("apps_read", { id: MINI })).toBe("ran minis_read");
    expect(handlers.minis_read).toHaveBeenLastCalledWith({ miniId: MINI }, ctx);
    expect(await call("apps_read", { id: DASHBOARD })).toBe("ran dashboard_read");
    expect(handlers.dashboard_read).toHaveBeenLastCalledWith({ dashboardId: DASHBOARD }, ctx);
    expect(await call("apps_read", { id: ARTIFACT })).toBe("ran artifacts_read");
    expect(handlers.artifacts_read).toHaveBeenLastCalledWith({ artifactId: ARTIFACT }, ctx);
    // An app the index hasn't seen yet is found by its id's prefix; a page is not an app.
    expect(await call("apps_read", { id: "dsh_ffffffffffffffff" })).toBe("ran dashboard_read");
    expect(await call("apps_read", { id: DESIGN })).toMatchObject({ isError: true });
  });

  it("creates each type through its own handler, with that tool's parameters checking the input", async () => {
    const { call, handlers } = setup();
    expect(await call("apps_create", { type: "mini", input: { name: "Tracker", files: { "index.html": "<p>hi</p>" } } })).toBe("ran minis_create");
    expect(handlers.minis_create).toHaveBeenLastCalledWith({ name: "Tracker", files: { "index.html": "<p>hi</p>" } }, ctx);
    expect(await call("apps_create", { type: "dashboard", input: { name: "Ops" } })).toBe("ran dashboard_create");
    expect(await call("apps_create", { type: "artifact", input: { title: "Report", content: "# R", name: "r.md" } })).toBe("ran artifacts_save");
    expect(handlers.artifacts_save).toHaveBeenLastCalledWith({ title: "Report", content: "# R", name: "r.md" }, ctx);
    expect(await call("apps_create", { type: "dashboard", input: {} })).toMatchObject({ isError: true });
    expect(handlers.dashboard_create).toHaveBeenCalledTimes(1);
  });

  it("leaves out and refuses a type that is turned off", async () => {
    const { call, handlers } = setup(["dashboard"]);
    expect(await call("apps_list", {})).not.toContain(DASHBOARD);
    expect(await call("apps_read", { id: DASHBOARD })).toMatchObject({ isError: true });
    expect(handlers.dashboard_read).not.toHaveBeenCalled();
  });
});
