import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { expect, it } from "vitest";
import { OfficeTaskSchedules } from "./scheduling";

it("recovers a lost disabled-create response without duplicating a task automation", async () => {
  const created: { id: string; name: string; execution: { targetThreadId: string }; enabled: boolean }[] = [];
  const resumed: unknown[] = [];
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: { get: async () => makeThreadResponse({ id: "thread", providerId: "codex" }), defaultExecutionOptions: async () => ({ model: "model", reasoningLevel: "medium" }) as never },
    plugins: { callRpc: async ({ method, input }) => {
      if (method === "automations_list") return created as never;
      if (method === "automations_create") {
        created.push({ ...input as typeof created[number], id: "auto" });
        throw new Error("Response lost");
      }
      if (method === "automations_resume") { resumed.push(input); return {} as never; }
      throw new Error(method);
    } },
  } });
  try {
    const input = { taskId: "task", projectId: "folder", threadId: "thread", schedule: "weekdays" as const, trust: "ask" as const, timezone: "America/New_York" };
    await expect(new OfficeTaskSchedules(bb.storage.database(), bb.sdk).ensure(input)).rejects.toThrow("Response lost");
    expect(resumed).toEqual([]);
    const restarted = new OfficeTaskSchedules(bb.storage.database(), bb.sdk);
    await Promise.all([restarted.ensure(input), restarted.ensure(input)]);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ enabled: false, trigger: { cron: "0 9 * * 1-5", timezone: "America/New_York" }, execution: { targetThreadId: "thread", permissionMode: "accept-edits" } });
    expect(resumed).toEqual([{ projectId: "folder", automationId: "auto" }]);
    expect(restarted.label("task")).toBe("weekdays");
    await expect(restarted.ensure({ ...input, schedule: "hourly" })).rejects.toThrow("different schedule");
    expect(created).toHaveLength(1);
  } finally { await harness.lifecycle.dispose(); }
});
