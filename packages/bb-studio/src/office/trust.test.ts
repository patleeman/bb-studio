import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { ModuleServices } from "../modules/services";
import { permissionForTrust, withOfficeTrust } from "./trust";

it.each([true, false, "malformed"])("runs an ask bot mutation only after a valid approval: %s", async approved => {
  const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
  const modules = new ModuleServices(), schema = { input: z.unknown(), output: z.unknown() };
  modules.register("bot-teams", { threadProfile: schema, get: schema }, {
    threadProfile: () => ({ botId: "bot" }), get: () => ({ bot: { id: "bot", name: "Helper", trust: "ask" } }),
  });
  const mutate = vi.fn(() => "done");
  const pending = withOfficeTrust(bb, modules, { threadId: "thread", projectId: "project", signal: new AbortController().signal }, "tasks_delete", { id: "task" }, mutate);
  const outcome = pending.then(value => ({ value }), error => ({ error: String(error) }));
  await vi.waitFor(() => expect(harness.pendingInteractions).toHaveLength(1));
  expect(mutate).not.toHaveBeenCalled();
  const request = harness.pendingInteractions[0]!;
  expect(request).toMatchObject({ rendererId: "office-trust", payload: { toolName: "tasks_delete", arguments: { id: "task" }, botId: "bot" } });
  harness.behavior.submitInteraction(request.id, { approved });
  expect(await outcome).toEqual(approved === true ? { value: "done" } : { error: "Error: The Studio change was not approved." });
  expect(mutate).toHaveBeenCalledTimes(approved === true ? 1 : 0);
  await harness.lifecycle.dispose();
});

it("uses supported permission modes and permits act bots without another approval", async () => {
  expect(permissionForTrust("ask")).toBe("accept-edits"); expect(permissionForTrust("act")).toBe("auto");
  const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
  const modules = new ModuleServices(), schema = { input: z.unknown(), output: z.unknown() };
  modules.register("bot-teams", { threadProfile: schema, get: schema }, {
    threadProfile: () => ({ botId: "bot" }), get: () => ({ bot: { id: "bot", name: "Helper", trust: "act" } }),
  });
  expect(await withOfficeTrust(bb, modules, { threadId: "thread", projectId: "project", signal: new AbortController().signal }, "tasks_delete", {}, () => "done")).toBe("done");
  expect(harness.pendingInteractions).toHaveLength(0);
  await harness.lifecycle.dispose();
});
