import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { expect, it } from "vitest";
import plugin from "../modules/tasks/server";

it("mission sync registers a hidden task handoff without starting a second run", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      get: async ({ threadId }) => makeThreadResponse({ id: threadId, status: "idle" }),
      update: async () => undefined as never,
      interactions: { list: async () => [] },
    },
    plugins: { callRpc: async () => ({}) as never },
  } });
  try {
    await plugin(bb);
    const input = { projectId: "proj_personal", title: "Standing duty", description: "Keep the queue healthy", botId: "bot_one", threadId: "thr_mission", enabled: true, source: { kind: "mission", botId: "bot_one", intervalMinutes: 17 } };
    const result = await harness.behavior.callRpc("office_syncRecurring", input) as { taskId: string };
    expect(await harness.behavior.callRpc("office_syncRecurring", input)).toEqual(result);
    expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("threads.update")[0]?.[0]).toMatchObject({ threadId: "thr_mission", visibility: "hidden" });
    await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "thr_mission", status: "active" }) });
    await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "thr_mission" }), lastAssistantText: "Queue checked" });
    expect(await harness.behavior.callRpc("get", { id: result.taskId })).toMatchObject({ task: { status: "review", schedule: "Every 17 minutes" }, handoffs: [{ state: "replied" }] });
    await harness.behavior.callRpc("move", { id: result.taskId, status: "done" });
    await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "thr_mission", status: "active" }) });
    expect(await harness.behavior.callRpc("get", { id: result.taskId })).toMatchObject({ task: { status: "in_progress" } });
  } finally { await harness.lifecycle.dispose(); }
});
