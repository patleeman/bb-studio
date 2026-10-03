import { studioSchemas } from "@bb-studio/kit/contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { memoryStore } from "../test/db";
import { registerStudio, taskBadge } from "./studio";

function setup() {
  const { store } = memoryStore();
  let handlers: Record<string, (input: unknown) => unknown> = {};
  const bb = { rpc: { register: (_contract: unknown, registered: typeof handlers) => (handlers = registered) } };
  const changed: string[] = [];
  const moved: string[] = [];
  registerStudio(bb as never, studioSchemas(z), {
    store,
    changed: (id) => void changed.push(id),
    move: async (id, status) => {
      store.move(id, status, "user");
      moved.push(`${id}:${status}`);
    },
  });
  const call = async (method: string, input: unknown): Promise<any> => handlers[method]!(input);
  return { store, call, changed, moved };
}

describe("the Tasks Studio provider", () => {
  it("instantiates tasks and exports escaped CSV", async () => {
    const { store, call } = setup();
    const source = store.create({ title: "{{name}}", description: 'Say "yes"', by: "user" });
    await call("studio_template", { id: source.id, template: true });
    const { item } = await call("studio_instantiate", { id: source.id, projectId: "proj_new", variables: { name: "Review" } });
    expect(item).toMatchObject({ title: "Review", projectId: "proj_new", template: false });
    const { files } = await call("studio_export", { id: item.id, format: "csv" });
    expect(Buffer.from(files[0].data, "base64").toString()).toContain('"Say ""yes"""');
  });
  it("describes boards and tasks, which Studio can create", async () => {
    const { call } = setup();
    const info = await call("studio_describe", null);
    expect(studioSchemas(z).info.parse(info)).toBeTruthy();
    expect(info).toMatchObject({ pluginId: "studio", panel: "tasks", kinds: [{ id: "board", create: { mode: "rpc" } }, { id: "task", create: { mode: "rpc" }, canArchive: true }] });
    // Studio takes a v2 provider offline when a kind leaves either out.
    for (const kind of info.kinds) expect(kind).toMatchObject({ capabilities: expect.any(Object), mentionProviderId: expect.toBeOneOf([null, expect.any(String)]) });
    const { item } = await call("studio_create", { kind: "task", projectId: "proj_a" });
    expect(item).toMatchObject({ kind: "task", title: "", projectId: "proj_a", href: `/plugins/studio/tasks/${item.id}` });
    await expect(call("studio_create", { kind: "page", projectId: null })).rejects.toThrow(/can't make/);
  });

  it("lists tasks with status, due and assignee facts", async () => {
    const { store, call } = setup();
    const task = store.create({ title: "Launch", description: "# Ship it\nsoon", status: "review", due: "2026-10-01", assignee: "me", by: "agent" });
    const { items } = await call("studio_list", null);
    expect(studioSchemas(z).provider.studio_list.output.parse({ items })).toBeTruthy();
    expect(items.find((item: { id: string }) => item.id === task.id)).toMatchObject({
      id: task.id,
      parentId: task.board_id,
      updatedBy: "agent",
      preview: "Ship it",
      facts: [
        { id: "status", value: "Review", sort: 2 },
        { id: "due", value: expect.any(String), sort: Date.parse("2026-10-01T00:00:00Z") },
        { id: "assignee", value: "Me", sort: 0 },
      ],
    });
  });

  it("finds tasks by description and handoff note", async () => {
    const { store, call } = setup();
    const a = store.create({ title: "A", description: "Update the pricing page", by: "user" });
    const b = store.create({ title: "B", by: "user" });
    store.addHandoff(b.id, "thr_1", null);
    store.setHandoff("thr_1", "replied", "Rewrote the pricing FAQ");
    store.create({ title: "C", by: "user" });
    const found = await call("studio_search", { query: "pricing" });
    expect(found.ids.sort()).toEqual([a.id, b.id].sort());
    expect(found.snippets).toEqual({ [a.id]: "Update the pricing page", [b.id]: "Rewrote the pricing FAQ" });
  });

  it("marks tasks done and reopens them through the board's move", async () => {
    const { store, call, moved } = setup();
    const task = store.create({ title: "A", by: "user" });
    expect(await call("studio_action", { action: "mark-done", ids: [task.id, "tsk_missing"] })).toEqual({ message: "Marked 1 task done", text: null });
    expect(moved).toEqual([`${task.id}:done`]);
    expect(await call("studio_action", { action: "reopen", ids: [task.id] })).toEqual({ message: "Moved 1 task to To do", text: null });
    expect(store.get(task.id)?.status).toBe("todo");
  });

  it("moves, archives and deletes", async () => {
    const { store, call, changed } = setup();
    const task = store.create({ title: "A", by: "user" });
    await call("studio_move", { ids: [task.id], projectId: "proj_b" });
    expect(store.get(task.id)?.project_id).toBe("proj_b");
    await call("studio_archive", { ids: [task.id], archived: true });
    expect(store.get(task.id)?.archived_at).not.toBeNull();
    await call("studio_delete", { ids: [task.id] });
    expect(store.get(task.id)).toBeNull();
    // Moving to another project takes the task off its board, onto that project's main board.
    expect(changed).toEqual([task.id, task.board_id, task.id, task.id]);
  });
});

describe("boards in Studio", () => {
  it("lists boards with their columns' counts and makes new ones", async () => {
    const { store, call } = setup();
    const task = store.create({ title: "A", projectId: "proj_a", status: "review", by: "user" });
    const { items } = await call("studio_list", null);
    expect(items.find((item: { id: string }) => item.id === task.board_id)).toMatchObject({
      kind: "board",
      title: "Tasks",
      projectId: "proj_a",
      href: `/plugins/studio/tasks/${task.board_id}`,
    });
    const { item } = await call("studio_create", { kind: "board", projectId: "proj_b" });
    expect(item).toMatchObject({ kind: "board", projectId: "proj_b" });
    expect(store.getBoard(item.id)).toBeTruthy();
  });

  it("moves a board's tasks with it, and a task to the new project's main board", async () => {
    const { store, call } = setup();
    const board = store.createBoard({ title: "Launch", projectId: "proj_a", by: "user" });
    const task = store.create({ title: "A", boardId: board.id, by: "user" });
    await call("studio_move", { ids: [board.id], projectId: "proj_b" });
    expect(store.get(task.id)).toMatchObject({ board_id: board.id, project_id: "proj_b" });
    await call("studio_move", { ids: [task.id], projectId: "proj_c" });
    expect(store.get(task.id)?.board_id).toBe(store.findMainBoard("proj_c")?.id);
  });

  it("duplicates a board with its tasks, and deletes it with them", async () => {
    const { store, call } = setup();
    const board = store.createBoard({ title: "Launch", projectId: null, by: "user" });
    store.create({ title: "A", boardId: board.id, status: "review", by: "user" });
    const { item } = await call("studio_duplicate", { id: board.id });
    expect(item).toMatchObject({ kind: "board" });
    expect(store.list({ boardId: item.id }).map((task) => [task.title, task.status])).toEqual([["A", "review"]]);
    const { content } = await call("studio_read", { id: board.id });
    expect(content).toContain("## Review");
    await call("studio_delete", { ids: [board.id] });
    expect(store.getBoard(board.id)).toBeNull();
    expect(store.list({ boardId: board.id })).toEqual([]);
  });
});

describe("taskBadge", () => {
  const { store } = memoryStore();
  const task = (status: "todo" | "in_progress" | "review" | "done", due: string | null = null) => ({ ...store.create({ title: "x", status, due, by: "user" }) });
  const handoff = (state: "working" | "needs-input" | "replied") => ({ thread_id: "thr", task_id: "t", state, note: null, agent: null, created_at: 0, updated_at: 0 });

  it("says who acts next when the thread needs it", () => {
    expect(taskBadge(task("in_progress"), handoff("needs-input"))).toEqual({ label: "Needs your input", tone: "warning" });
    expect(taskBadge(task("in_progress"), handoff("working"))).toEqual({ label: "Agent working", tone: "live" });
  });

  it("shows overdue, then the status", () => {
    expect(taskBadge(task("todo", "2000-01-01"), null)).toEqual({ label: "Overdue", tone: "danger" });
    expect(taskBadge(task("done", "2000-01-01"), handoff("working"))).toEqual({ label: "Done", tone: "success" });
    expect(taskBadge(task("review"), handoff("replied"))).toEqual({ label: "Review", tone: "warning" });
  });
});
