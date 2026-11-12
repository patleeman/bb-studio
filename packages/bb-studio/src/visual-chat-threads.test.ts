import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "../server";

const context = (threadId: string, originPluginId: string | null) => ({
  pluginMetadata: {}, thread: { id: threadId, title: null, parentThreadId: null, sourceThreadId: null },
  project: { id: "proj_personal", kind: "personal" as const, name: "Personal", gitRemoteUrl: null },
  environment: { id: "env", name: null, path: null, branchName: null, workspaceProvisionType: null },
  host: { id: "host", name: "host" }, provider: { id: "claude-code", model: "claude-sonnet-5-5", capabilities: { supportsNativeUserQuestion: false } },
  origin: { kind: null, pluginId: originPluginId },
});

describe("Studio on a Visual Chat thread", () => {
  it("gives a thread Visual Chat spawned no tools, skills or instructions, and an ordinary thread its own", async () => {
    const host = createFakePluginHost({ pluginId: "studio", sdk: { threads: { list: async () => [], get: async () => null }, projects: { list: async () => [] } } } as never);
    await plugin(host.bb);
    // What Studio's agents.configure returns (the raw selection, before BB checks it against registrations).
    const configure = host.harness.registrations.agentConfigurationProvider!;
    for (const pluginId of ["studio-visual-chat", "studio-canvas"]) expect(configure(context("thr_canvas", pluginId) as never)).toEqual({ tools: [], skills: [], instructions: "" });
    const ordinary = configure(context("thr_plain", null) as never);
    expect(ordinary.tools.length).toBeGreaterThan(10);
    expect(ordinary.skills).toContain("studio-code");
    expect(ordinary.instructions).toBeTruthy();
    // A thread another plugin spawned keeps Studio's tools.
    expect(configure(context("thr_side", "side-chat") as never).tools.length).toBe(ordinary.tools.length);
    await host.harness.lifecycle.dispose();
  });
});
