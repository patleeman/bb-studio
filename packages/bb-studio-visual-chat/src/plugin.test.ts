import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "../server";
import { CANVAS_TOOL_NAMES } from "./tools";

const context = (threadId: string, pluginMetadata: Record<string, unknown> = {}) => ({
  pluginMetadata, thread: { id: threadId, title: null, parentThreadId: null, sourceThreadId: null },
  project: { id: "proj_personal", kind: "personal" as const, name: "Personal", gitRemoteUrl: null },
  environment: { id: "env", name: null, path: null, branchName: null, workspaceProvisionType: null },
  host: { id: "host", name: "host" }, provider: { id: "codex", model: "m", capabilities: { supportsNativeUserQuestion: false } }, origin: { kind: null, pluginId: null },
});

describe("the canvas plugin", () => {
  it("migrates its own database and gives only canvas threads the canvas tools, skill and rules", async () => {
    const host = createFakePluginHost({ pluginId: "canvas", agentSkillIds: ["canvas"] });
    await plugin(host.bb);
    const canvasThread = await host.harness.behavior.resolveAgentConfiguration(context("thr_new", { canvas: "cnv_0123456789abcdef" }) as never);
    expect(canvasThread.tools.map((tool) => tool.name).sort()).toEqual([...CANVAS_TOOL_NAMES].sort());
    expect(canvasThread.skills).toEqual(["canvas"]);
    expect(canvasThread.instructions).toContain("ONE page you design");
    const other = await host.harness.behavior.resolveAgentConfiguration(context("thr_other") as never);
    expect(other.tools).toEqual([]);
    expect(other.skills).toEqual([]);
    await host.harness.lifecycle.dispose();
  });

  it("turns Claude Code's tool search to threshold mode on canvas threads only, so the canvas tools load up front", async () => {
    // The thread comes back a little after the spawn starts, as a real spawn does.
    const host = createFakePluginHost({ pluginId: "canvas", agentSkillIds: ["canvas"], sdk: { threads: { spawn: async () => { await new Promise((done) => setTimeout(done, 50)); return { id: "thr_canvas1" }; } } } } as never);
    await plugin(host.bb);
    const resolve = host.harness.registrations.providerEnvResolvers.get("claude-code")!;
    expect(host.harness.registrations.providerEnvResolvers.has("codex")).toBe(false);
    // Model listing (no thread) and other threads get nothing.
    expect(await resolve({ threadId: null, projectId: null, hostId: "host" })).toEqual([]);
    expect(await resolve({ threadId: "thr_other", projectId: "proj_personal", hostId: "host" })).toEqual([]);
    // Asked while its thread is still being made, the canvas thread waits for it and gets the setting.
    const creating = host.harness.behavior.callRpc("canvas.create", { text: "Show me games" });
    await new Promise((done) => setTimeout(done, 10)); // BB asks once the spawn has started
    expect(await resolve({ threadId: "thr_canvas1", projectId: "proj_personal", hostId: "host" })).toEqual([{ name: "ENABLE_TOOL_SEARCH", value: "auto", reason: expect.stringContaining("ToolSearch") }]);
    await creating;
    expect(await resolve({ threadId: "thr_canvas1", projectId: "proj_personal", hostId: "host" })).toHaveLength(1);
    await host.harness.lifecycle.dispose();
  });
});
