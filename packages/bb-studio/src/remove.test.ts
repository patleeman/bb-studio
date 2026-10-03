import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import plugin from "../server";

it("removes consolidated tasks through the collection RPC without treating them as spaces", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "studio-remove-"));
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", dataDir, sdk: {
    projects: { list: async () => [] },
    threads: { list: async () => [] },
    plugins: { list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  try {
    // The fake SDK uses lazy properties; materialize namespaces before the
    // module adapter copies the production-shaped SDK object.
    await plugin({ ...bb, sdk: {
      ...bb.sdk,
      projects: bb.sdk.projects, threads: bb.sdk.threads, system: bb.sdk.system,
      environments: bb.sdk.environments, providers: bb.sdk.providers, files: bb.sdk.files,
      plugins: {
        ...bb.sdk.plugins,
        list: bb.sdk.plugins.list,
        experimental_discoverRpc: bb.sdk.plugins.experimental_discoverRpc,
        callRpc: bb.sdk.plugins.callRpc,
      },
    } });
    const { task } = await harness.behavior.callRpc("tasks_create", { title: "Remove fixture" }) as { task: { id: string } };
    expect(await harness.behavior.callRpc("remove", { pluginId: "studio", ids: [task.id, "spc_missing"] })).toEqual({
      done: [task.id], failed: [{ id: "spc_missing", error: "That space no longer exists." }],
    });
    expect(await harness.behavior.callRpc("tasks_get", { id: task.id })).toMatchObject({ task: null });
  } finally {
    await harness.lifecycle.dispose();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
