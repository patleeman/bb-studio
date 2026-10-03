import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { MIGRATIONS } from "../migrations";
import { StudioHub } from "../hub";
import { ModuleServices } from "../modules/services";
import { initializeOffice } from "./server";

it.each([
  { text: "Build a report", projectId: "folder", target: "folder" },
  { text: "@unknown Build a report", projectId: "folder", target: "folder" },
  { text: "Build a report", projectId: "outside", target: "proj_personal" },
  { text: "@elsewhere Build a report", projectId: "folder", target: "folder" },
  { text: "@writer Build a report", projectId: "folder", target: "folder", delegate: true },
])("starts Office work: $text / $projectId", async scenario => {
  const project = (id: string) => ({ id, name: id, kind: "personal" as const, sources: [], gitRemoteUrl: null, createdAt: 1, updatedAt: 1 });
  const spawn = vi.fn(async () => makeThreadResponse({ id: "thread" }));
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    projects: { list: async () => [project("proj_personal"), project("folder"), project("outside")] },
    threads: { spawn },
    plugins: { list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  try {
    const db = bb.storage.database();
    bb.storage.migrate(db, MIGRATIONS);
    const modules = new ModuleServices(), rpc = { input: z.unknown(), output: z.unknown() };
    const create = vi.fn(() => ({ task: { id: "task" } }));
    const update = vi.fn(() => ({ ok: true }));
    modules.register("bot-teams", { list: rpc, get: rpc }, {
      list: () => ({ bots: [
        { id: "bot", handle: "writer", projectId: "folder" },
        { id: "other", handle: "elsewhere", projectId: "outside" },
      ] }),
      get: () => ({ bot: { id: "bot", projectId: "folder" } }),
    });
    modules.register("studio-tasks", { create: rpc, update: rpc, get: rpc }, {
      create, update,
      get: () => ({ task: { id: "task", title: "Build a report", description: "Build a report", status: "in_progress", statusLabel: "Doing", projectId: "folder", assignee: "bot:bot", archived: false, updatedAt: 1, recurrence: null, handoff: { threadId: "bot-thread", state: "working", note: null } } }),
    });
    const office = await initializeOffice(bb, db, new StudioHub(bb.sdk), { moduleServices: modules });
    const other = office.spaces.office.create({ name: "Other" });
    office.spaces.office.moveProject("outside", other.id);
    const request = { projectId: scenario.projectId, providerId: "codex", model: "model", reasoningLevel: "high", permissionMode: "accept-edits", executionInputSources: {}, environment: { kind: "project" }, input: [{ type: "text", text: scenario.text }], serviceTier: "fast", sendAt: 2000000000 };
    const result = await harness.behavior.callRpc("office_start", { spaceId: office.spaces.office.defaultSpace().id, request });
    if (scenario.delegate) {
      expect(result).toEqual({ taskId: "task", botId: "bot" });
      expect(create).toHaveBeenCalledWith({ title: "Build a report", description: "Build a report", projectId: "folder" });
      expect(update).toHaveBeenCalledWith({ id: "task", assignee: "bot:bot" });
      expect(spawn).not.toHaveBeenCalled();
    } else {
      expect(result).toEqual({ threadId: "thread" });
      expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ ...request, projectId: scenario.target }));
      expect(create).not.toHaveBeenCalled();
    }
  } finally { await harness.lifecycle.dispose(); }
});
