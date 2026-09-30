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
  it("describes tasks, which Studio can create", async () => {
    const { call } = setup();
    const info = await call("studio_describe", null);
    expect(studioSchemas(z).info.parse(info)).toBeTruthy();
    expect(info).toMatchObject({ pluginId: "studio-tasks", panel: "tasks", kinds: [{ id: "task", create: { mode: "rpc" }, canArchive: true }] });
    const { item } = await call("studio_create", { kind: "task", projectId: "proj_a" });
    expect(item).toMatchObject({ kind: "task", title: "", projectId: "proj_a", href: `/plugins/studio-tasks/tasks/${item.id}` });
    await expect(call("studio_create", { kind: "page", projectId: null })).rejects.toThrow(/can't make/);
  });

  it("lists tasks with status, due and assignee facts", async () => {
    const { store, call } = setup();
    const task = store.create({ title: "Launch", description: "# Ship it\nsoon", status: "review", due: "2026-10-01", assignee: "me", by: "agent" });
    const { items } = await call("studio_list", null);
    expect(studioSchemas(z).provider.studio_list.output.parse({ items })).toBeTruthy();
    expect(items[0]).toMatchObject({
      id: task.id,
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
    expect(changed).toEqual([task.id, task.id, task.id]);
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
