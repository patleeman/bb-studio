import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { ModuleServices } from "../modules/services";
import { officeTrustAgents } from "./trust-agents";

it("allows own task progress but gates unrelated mutations and newly registered tools", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
  const modules = new ModuleServices(), schema = { input: z.unknown(), output: z.unknown() };
  modules.register("bot-teams", { threadProfile: schema, get: schema }, {
    threadProfile: () => ({ botId: "bot" }), get: () => ({ bot: { id: "bot", name: "Helper", trust: "ask" } }),
  });
  modules.register("studio-tasks", { board: schema }, { board: () => ({ tasks: [{ id: "own", title: "Work", description: "", status: "in_progress", statusLabel: "Doing", projectId: "project", assignee: "bot:bot", archived: false, updatedAt: 1, recurrence: null, handoff: { threadId: "thread", state: "working", note: null } }] }) });
  const agents = officeTrustAgents(bb, modules), executed: unknown[] = [];
  for (const name of ["tasks_update", "new_mutation", "feed_post", "tasks_list"]) agents.registerTool({ name, description: "Test", parameters: z.record(z.string(), z.unknown()), execute: input => { executed.push(input); return "done"; } });
  const context = { threadId: "thread", projectId: "project" };
  expect(await harness.behavior.callAgentTool("tasks_update", { id: "own", status: "review", note: "Ready" }, context)).toBe("done");
  expect(await harness.behavior.callAgentTool("feed_post", { title: "Report" }, context)).toBe("done");
  expect(await harness.behavior.callAgentTool("tasks_list", {}, context)).toBe("done");
  expect(harness.pendingInteractions).toHaveLength(0);
  for (const [name, args] of [["tasks_update", { id: "other", status: "review" }], ["tasks_update", { id: "own", assignee: "bot:other" }], ["new_mutation", {}]] as const) {
    const before = executed.length;
    const pending = harness.behavior.callAgentTool(name, args, context);
    await vi.waitFor(() => expect(harness.pendingInteractions.length).toBeGreaterThan(0));
    expect(executed).toHaveLength(before);
    harness.behavior.submitInteraction(harness.pendingInteractions.at(-1)!.id, { approved: true });
    await pending;
    expect(executed).toHaveLength(before + 1);
  }
  await harness.lifecycle.dispose();
});
