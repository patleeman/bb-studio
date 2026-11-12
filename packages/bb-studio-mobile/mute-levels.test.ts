import { expect, it, vi } from "vitest";
import { setThreadMuted, stillMuted } from "./mute-levels.js";

it("mutes and unmutes through BB's own level, and says when it couldn't", async () => {
  const callRpc = vi.fn(async (_call: { pluginId: string; method: string; input: never }) => ({}));
  expect(await setThreadMuted(callRpc, "thr_a", true)).toBe(true);
  expect(await setThreadMuted(callRpc, "thr_a", false)).toBe(true);
  expect(callRpc.mock.calls.map(([call]) => [call.pluginId, call.method, call.input])).toEqual([
    ["push-notifications", "threadNotifications.set", { threadId: "thr_a", level: "muted" }],
    ["push-notifications", "threadNotifications.set", { threadId: "thr_a", level: "inherit" }],
  ]);
  expect(await setThreadMuted(async () => { throw new Error("plugin is off"); }, "thr_a", true)).toBe(false);
});

it("keeps only the threads BB still has muted, in batches, and returns null when BB can't say", async () => {
  const ids = Array.from({ length: 60 }, (_, index) => `thr_${index}`);
  const callRpc = vi.fn(async (call: { input: never }) => {
    const { threadIds } = call.input as { threadIds: string[] };
    return { threads: Object.fromEntries(threadIds.map((id) => [id, { own: id === "thr_3" || id === "thr_55" ? "muted" : "inherit", ancestorCap: null }])) };
  });
  expect(await stillMuted(callRpc, ids)).toEqual(["thr_3", "thr_55"]);
  expect(callRpc).toHaveBeenCalledTimes(2);
  expect(await stillMuted(callRpc, [])).toEqual([]);
  expect(await stillMuted(async () => { throw new Error("off"); }, ["thr_1"])).toBeNull();
  expect(await stillMuted(async () => ({ nothing: true }), ["thr_1"])).toBeNull();
});
