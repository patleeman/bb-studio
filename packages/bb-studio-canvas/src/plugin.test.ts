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
    expect(canvasThread.instructions).toContain("Remove what no longer matters.");
    const other = await host.harness.behavior.resolveAgentConfiguration(context("thr_other") as never);
    expect(other.tools).toEqual([]);
    expect(other.skills).toEqual([]);
    await host.harness.lifecycle.dispose();
  });
});
