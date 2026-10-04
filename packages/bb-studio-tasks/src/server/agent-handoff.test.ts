import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { expect, it } from "vitest";
import plugin from "../../server";

async function setup(hostId: string | null) {
  const host = createFakePluginHost({ pluginId: "studio-tasks", sdk: {
    system: { config: async () => ({ primaryHostId: hostId }) as never },
    plugins: { callRpc: async () => { throw new Error("Optional Studio service unavailable"); } },
    providers: { list: async () => [] },
    threads: {
      spawn: async args => {
        if (args.environment?.type !== "host" || !args.environment.hostId) throw new Error("hostId is required unless workspace.type is personal");
        return makeThreadResponse({ id: "thr_handoff", providerId: "codex", projectId: args.projectId });
      },
      get: async () => makeThreadResponse({ id: "thr_handoff", status: "starting" }),
      interactions: { list: async () => [] },
    },
  } });
  await plugin(host.bb);
  const { task } = await host.harness.behavior.callRpc("create", { title: "Review the launch", projectId: "proj_launch" }) as { task: { id: string } };
  return { ...host, task };
}

for (const workspace of ["folder", "worktree"] as const) {
  it(`hands off to the primary machine's ${workspace} with task context and a linked conversation`, async () => {
    const { harness, task } = await setup("host_primary");
    try {
      expect(await harness.behavior.callRpc("handOff", { id: task.id, projectId: "proj_launch", providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "low", note: "Review the dates", workspace })).toEqual({ threadId: "thr_handoff" });
      expect(harness.inspection.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({
        projectId: "proj_launch", model: "gpt-6.1-sol", reasoningLevel: "low", pluginMetadata: { taskId: task.id },
        environment: { type: "host", hostId: "host_primary", workspace: workspace === "folder" ? { type: "unmanaged", path: null } : { type: "managed-worktree", baseBranch: { kind: "default" } } },
      });
      expect(JSON.stringify(harness.inspection.sdk.callsTo("threads.spawn"))).toContain("Review the dates");
      expect(await harness.behavior.callRpc("get", { id: task.id })).toMatchObject({
        task: { status: "in_progress", assignee: "agent" }, handoffs: [{ threadId: "thr_handoff" }], links: [{ target: "thread", itemId: "thr_handoff" }],
      });
    } finally { await harness.lifecycle.dispose(); }
  });
}

it("explains a missing primary machine without spawning or recording a handoff", async () => {
  const { harness, task } = await setup(null);
  try {
    await expect(harness.behavior.callRpc("handOff", { id: task.id, projectId: "proj_launch", providerId: null, model: null, reasoningLevel: null, note: null, workspace: "folder" })).rejects.toThrow("BB has no primary host");
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
    expect(await harness.behavior.callRpc("get", { id: task.id })).toMatchObject({ task: { status: "todo", assignee: null }, handoffs: [], links: [] });
  } finally { await harness.lifecycle.dispose(); }
});
