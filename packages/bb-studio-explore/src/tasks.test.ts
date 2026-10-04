import { expect, it, vi } from "vitest";
import { exploreTasks } from "./tasks";

const finding = { threadId: "thr_source", messageId: "msg_source", label: "Queue drops retries" };

it("checks optional Tasks without creating work and reports absence clearly", async () => {
  const callRpc = vi.fn(async () => { throw new Error("Plugin not installed"); });
  const track = exploreTasks({ callRpc, pageId: () => null });
  expect(await track(finding)).toEqual({ available: false, task: null });
  expect(callRpc).toHaveBeenCalledWith("studio-tasks", "trackFinding", expect.objectContaining({ create: false }), expect.anything());
  await expect(track({ ...finding, create: true })).rejects.toThrow("Studio Tasks is installed and running");
});

it("uses the same durable key after retries and includes the saved explainer", async () => {
  const calls: Record<string, unknown>[] = [];
  const track = exploreTasks({
    callRpc: async (_plugin, _method, input) => { calls.push(input as Record<string, unknown>); return { task: { id: "tsk_one", title: finding.label } } as never; },
    pageId: () => "pg_explainer",
  });
  const results = await Promise.all(Array.from({ length: 8 }, () => track({ ...finding, create: true })));
  expect(results.every(result => result.task?.id === "tsk_one")).toBe(true);
  expect(new Set(calls.map(call => call.key)).size).toBe(1);
  expect(calls[0]).toMatchObject({ threadId: finding.threadId, messageId: finding.messageId, title: finding.label, pageId: "pg_explainer", create: true });
  await track({ ...finding, parentId: "exp_parent" });
  expect(calls.at(-1)?.key).not.toBe(calls[0]?.key);
});
