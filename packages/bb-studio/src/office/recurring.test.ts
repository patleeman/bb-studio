import { expect, it, vi } from "vitest";
import { memoryStore } from "../modules/tasks/src/test/db";
import { OfficeRecurringTasks } from "./recurring";
import type { RecurringTaskInput } from "./recurring-contract";

const mission: RecurringTaskInput = { projectId: "proj_personal", botId: "bot_one", title: "Standing duty", description: "Check the queue.\nKeep every detail.", threadId: null, enabled: true, source: { kind: "mission", botId: "bot_one", intervalMinutes: 17 } };
it("projects a real interval without a second engine; restart and retries keep one task", () => {
  const { db, store } = memoryStore();
  const callRpc = vi.fn();
  const make = () => new OfficeRecurringTasks(db, store, { plugins: { callRpc } } as never);
  try {
    const tasks = make(), id = tasks.sync(mission)!;
    expect(make().sync(mission)).toBe(id);
    expect(store.list()).toHaveLength(1);
    expect(store.get(id)).toMatchObject({ description: mission.description, assignee: "bot:bot_one", project_id: "proj_personal" });
    expect(tasks.label(id)).toBe("Every 17 minutes");
    expect(callRpc).not.toHaveBeenCalled();
    tasks.sync({ ...mission, description: "Updated mission" });
    expect(store.get(id)?.description).toBe("Updated mission");
  } finally { db.close(); }
});
it("pause keeps the original interval for resume, deletion leaves a durable tombstone", async () => {
  const { db, store } = memoryStore();
  const callRpc = vi.fn(async (_input: unknown) => ({}));
  const tasks = new OfficeRecurringTasks(db, store, { plugins: { callRpc } } as never);
  try {
    const id = tasks.sync(mission)!;
    await tasks.control(id, "pause");
    expect(callRpc.mock.calls[0]?.[0]).toMatchObject({ method: "update", input: { id: "bot_one", intervalMinutes: 0 } });
    tasks.sync({ ...mission, enabled: false, source: { ...mission.source, kind: "mission", botId: "bot_one", intervalMinutes: 0 } });
    await tasks.control(id, "resume");
    expect(callRpc.mock.calls[1]?.[0]).toMatchObject({ input: { intervalMinutes: 17 } });
    await tasks.control(id, "delete"); store.delete(id);
    expect(tasks.sync(mission)).toBeNull();
    expect(store.list()).toHaveLength(0);
  } finally { db.close(); }
});
it("automation projection preserves its cron/timezone and controls the existing engine", async () => {
  const { db, store } = memoryStore();
  const callRpc = vi.fn(async (_input: unknown) => ({}));
  const tasks = new OfficeRecurringTasks(db, store, { plugins: { callRpc } } as never);
  try {
    const input: RecurringTaskInput = { ...mission, source: { kind: "automation", automationId: "auto_1", schedule: "0 9 * * 1-5 (America/New_York)" } };
    const id = tasks.sync(input)!;
    expect(tasks.label(id)).toBe(input.source.kind === "automation" ? input.source.schedule : "");
    await tasks.control(id, "pause");
    expect(callRpc.mock.calls[0]?.[0]).toMatchObject({ pluginId: "automations", method: "automations_pause", input: { automationId: "auto_1", projectId: "proj_personal" } });
    expect(tasks.sync(input)).toBe(id);
  } finally { db.close(); }
});
