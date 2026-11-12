// The Explorer's backend against a real database: automatic filing at each
// of its three moments, the RPC's change notices, and the two agent tools.
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ItemIndex } from "../item-index";
import { MIGRATIONS } from "../migrations";
import { describeFolders, EXPLORER_TOOLS, registerExplorer } from "./server";

type Tool = { name: string; description: string; execute(input: never, ctx: never): unknown };
type Thread = { id: string; projectId?: string | null; parentThreadId?: string | null };

let db: Database.Database;
let tools: Map<string, Tool>;
let events: Map<string, ((payload: { thread: Thread }) => void)[]>;
let changed: ReturnType<typeof vi.fn<() => void>>;
let explorer: ReturnType<typeof registerExplorer>;
const threads = new Map<string, Thread>();
const projects = [{ id: "proj_web", name: "Website" }, { id: "proj_ops", name: "Ops" }];

const page = (id: string, projectId: string | null, parentId: string | null = null) =>
  db.prepare("INSERT INTO pages (id, project_id, parent_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, 1)").run(id, projectId, parentId, id);
const emit = (event: string, thread: Thread) => { for (const handler of events.get(event) ?? []) handler({ thread }); };
const run = (name: string, input: unknown) => Promise.resolve(tools.get(name)!.execute(input as never, {} as never)) as Promise<string>;
const folderOf = (kind: "thread" | "item", id: string) => explorer.store.filingOf({ kind, id })?.folderId ?? null;

beforeEach(() => {
  db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  tools = new Map();
  events = new Map();
  changed = vi.fn<() => void>();
  threads.clear();
  const bb = {
    agents: { registerTool: (tool: Tool) => { tools.set(tool.name, tool); } },
    events: { on: (event: string, handler: (payload: { thread: Thread }) => void) => { events.set(event, [...(events.get(event) ?? []), handler]); } },
  };
  explorer = registerExplorer(bb as never, db, {
    index: new ItemIndex(db),
    thread: async (id) => { const thread = threads.get(id); return thread ? { projectId: thread.projectId ?? null, parentThreadId: thread.parentThreadId ?? null } : null; },
    projects: async () => projects,
    changed,
  });
});

describe("automatic filing", () => {
  it("files what an agent's tool made beside the thread that made it", () => {
    const plans = explorer.store.createFolder({ projectId: "proj_web", parentId: null, name: "Plans" });
    explorer.store.file([{ kind: "thread", id: "thr_1" }], plans.id, "user");
    page("pg_new", "proj_web");
    expect(explorer.itemCreated("pg_new", "thr_1")).toBe(true);
    expect(explorer.store.filingOf({ kind: "item", id: "pg_new" })).toMatchObject({ folderId: plans.id, filedBy: "auto" });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("files nothing when the thread sits at its project's root, the item is in another project, or the item is unknown", () => {
    const plans = explorer.store.createFolder({ projectId: "proj_web", parentId: null, name: "Plans" });
    explorer.store.file([{ kind: "thread", id: "thr_filed" }], plans.id, "user");
    page("pg_a", "proj_web");
    page("pg_global", null);
    expect(explorer.itemCreated("pg_a", "thr_loose")).toBe(false);
    expect(explorer.itemCreated("pg_global", "thr_filed")).toBe(false);
    expect(explorer.itemCreated("pg_missing", "thr_filed")).toBe(false);
    expect(explorer.store.filings()).toHaveLength(1);
    expect(changed).not.toHaveBeenCalled();
  });

  it("files a sub-page beside the page above it when it changes, once", () => {
    const plans = explorer.store.createFolder({ projectId: "proj_web", parentId: null, name: "Plans" });
    page("pg_parent", "proj_web");
    explorer.store.file([{ kind: "item", id: "pg_parent" }], plans.id, "user");
    page("pg_child", "proj_web", "pg_parent");
    explorer.itemsChanged(["pg_child", "pg_parent", "not-an-item"]);
    expect(folderOf("item", "pg_child")).toBe(plans.id);
    // The user drags it to the project's root: later changes leave it there.
    explorer.rpc.explorer_file({ targets: [{ kind: "item", id: "pg_child" }], folderId: null });
    explorer.itemsChanged(["pg_child"]);
    expect(explorer.store.filingOf({ kind: "item", id: "pg_child" })).toMatchObject({ folderId: null, filedBy: "user" });
  });

  it("files a child thread beside its parent when BB makes it, in the same project only", () => {
    const plans = explorer.store.createFolder({ projectId: "proj_web", parentId: null, name: "Plans" });
    explorer.store.file([{ kind: "thread", id: "thr_parent" }], plans.id, "agent");
    emit("thread.created", { id: "thr_child", projectId: "proj_web", parentThreadId: "thr_parent" });
    emit("thread.created", { id: "thr_elsewhere", projectId: "proj_ops", parentThreadId: "thr_parent" });
    emit("thread.created", { id: "thr_top", projectId: "proj_web", parentThreadId: null });
    expect(folderOf("thread", "thr_child")).toBe(plans.id);
    expect(explorer.store.filingOf({ kind: "thread", id: "thr_elsewhere" })).toBeNull();
    expect(explorer.store.filingOf({ kind: "thread", id: "thr_top" })).toBeNull();
  });

  it("forgets a deleted thread's and a removed item's filing", () => {
    explorer.store.file([{ kind: "thread", id: "thr_1" }, { kind: "item", id: "pg_1" }], null, "user");
    emit("thread.deleted", { id: "thr_1" });
    explorer.itemsChanged([], ["pg_1"]);
    expect(explorer.store.filings()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe("the RPC", () => {
  it("tells every window after each change, and lists folders with filings", () => {
    const { folder } = explorer.rpc.explorer_folder_create({ projectId: "proj_web", parentId: null, name: "Plans" });
    explorer.rpc.explorer_folder_rename({ id: folder.id, name: "Roadmap" });
    explorer.rpc.explorer_file({ targets: [{ kind: "thread", id: "thr_1" }], folderId: folder.id });
    expect(explorer.rpc.explorer_tree()).toEqual({
      folders: [expect.objectContaining({ id: folder.id, name: "Roadmap", projectId: "proj_web" })],
      filing: [expect.objectContaining({ kind: "thread", id: "thr_1", folderId: folder.id, filedBy: "user" })],
    });
    explorer.rpc.explorer_unfile({ targets: [{ kind: "thread", id: "thr_1" }] });
    explorer.rpc.explorer_folder_delete({ id: folder.id });
    expect(changed).toHaveBeenCalledTimes(5);
    expect(explorer.rpc.explorer_tree()).toEqual({ folders: [], filing: [] });
  });
});

describe("what the tree is told about Bots' threads", () => {
  it("hands over the side threads with the thread each answers, and the runners' threads, where the server knows them", () => {
    const withBots = registerExplorer({ agents: { registerTool() {} }, events: { on() {} } } as never, db, {
      index: { get: () => null }, thread: async () => null, projects: async () => [], changed() {},
      sideThreads: () => [{ threadId: "thr_reply", parentThreadId: "thr_chat" }], runnerThreads: () => ["thr_watch"],
    });
    expect(withBots.rpc.explorer_tree()).toEqual({ folders: [], filing: [], sideThreads: [{ threadId: "thr_reply", parentThreadId: "thr_chat" }], runnerThreadIds: ["thr_watch"] });
  });
});

describe("the agent tools", () => {
  it("are the two the agent configuration selects", () => {
    expect([...tools.keys()].sort()).toEqual([...EXPLORER_TOOLS].sort());
  });

  it("explorer_list shows every project, its folders nested with ids, and No project last", async () => {
    const plans = explorer.store.createFolder({ projectId: "proj_web", parentId: null, name: "Plans" });
    const q3 = explorer.store.createFolder({ projectId: "proj_web", parentId: plans.id, name: "Q3" });
    explorer.store.file([{ kind: "item", id: "pg_1" }], q3.id, "user");
    expect(await run("explorer_list", {})).toBe([
      "Website (project proj_web)", `  - Plans (folder ${plans.id})`, `    - Q3 (folder ${q3.id}, 1 filed)`, "Ops (project proj_ops)", "No project",
    ].join("\n"));
    expect(describeFolders([], [], new Map())).toBe("No project");
  });

  it("explorer_file files by folder id, and by a path it creates", async () => {
    page("pg_1", "proj_web");
    threads.set("thr_1", { id: "thr_1", projectId: "proj_web" });
    const plans = explorer.store.createFolder({ projectId: "proj_web", parentId: null, name: "Plans" });
    expect(await run("explorer_file", { target: { kind: "item", id: "pg_1" }, folder: plans.id })).toContain(`Filed in Plans (folder ${plans.id})`);
    expect(explorer.store.filingOf({ kind: "item", id: "pg_1" })).toMatchObject({ folderId: plans.id, filedBy: "agent" });
    expect(await run("explorer_file", { target: { kind: "thread", id: "thr_1" }, path: "website/Plans/Q3" })).toContain("Filed in Plans/Q3");
    const q3 = explorer.store.folders().find((each) => each.name === "Q3")!;
    expect(q3.parentId).toBe(plans.id);
    expect(folderOf("thread", "thr_1")).toBe(q3.id);
    // Only the project: back to its root, on purpose.
    expect(await run("explorer_file", { target: { kind: "thread", id: "thr_1" }, path: "Website" })).toBe("Placed at the project's root.");
    expect(explorer.store.filingOf({ kind: "thread", id: "thr_1" })).toMatchObject({ folderId: null, filedBy: "agent" });
  });

  it("explorer_file refuses another project's folder, an unknown project, folder or target, and both or neither of folder and path", async () => {
    page("pg_1", "proj_web");
    page("pg_global", null);
    threads.set("thr_1", { id: "thr_1", projectId: "proj_web" });
    const ops = explorer.store.createFolder({ projectId: "proj_ops", parentId: null, name: "Runbooks" });
    expect(await run("explorer_file", { target: { kind: "item", id: "pg_1" }, folder: ops.id })).toContain("another project");
    expect(await run("explorer_file", { target: { kind: "thread", id: "thr_1" }, path: "Ops/Runbooks" })).toContain("can't change project");
    expect(await run("explorer_file", { target: { kind: "item", id: "pg_1" }, path: "Nope/X" })).toContain('No project called "Nope"');
    expect(await run("explorer_file", { target: { kind: "item", id: "pg_1" }, folder: "fld_gone" })).toContain("No folder with id");
    expect(await run("explorer_file", { target: { kind: "item", id: "pg_1" } })).toContain("either");
    expect(await run("explorer_file", { target: { kind: "item", id: "pg_1" }, folder: ops.id, path: "Ops" })).toContain("either");
    await expect(run("explorer_file", { target: { kind: "item", id: "pg_gone" }, path: "Website/X" })).rejects.toThrow("No Studio item");
    await expect(run("explorer_file", { target: { kind: "thread", id: "thr_gone" }, path: "Website/X" })).rejects.toThrow("No thread");
    expect(explorer.store.filings()).toEqual([]);
    expect(explorer.store.folders()).toHaveLength(1);
    // A global item files under No project.
    expect(await run("explorer_file", { target: { kind: "item", id: "pg_global" }, path: "No project/Inbox" })).toContain("Filed in Inbox");
  });
});
