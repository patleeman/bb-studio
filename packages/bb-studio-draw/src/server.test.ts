import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import plugin from "../server";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });

const scene = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} });

/** The bridge, with one old drawing, talking to a fake Studio. */
async function bridge(studioUp = true) {
  const host = createFakePluginHost({ pluginId: "excalidraw" });
  hosts.push(host);
  const calls: { pluginId: string; method: string; input: unknown }[] = [];
  const stub = host.harness.sdk.stub as unknown as (path: string, fn: (args: { pluginId: string; method: string; input: unknown }) => unknown) => void;
  stub("plugins.callRpc", async (args) => {
    calls.push(args);
    if (!studioUp) throw new Error("plugin studio is not running");
    switch (args.method) {
      case "drawings.importRows": return { imported: (args.input as { drawings: { id: string }[] }).drawings.map((each) => each.id), existing: [], skipped: [] };
      case "drawings.getDrawing": return { drawing: null };
      case "drawings.mentionContext": return { context: "From Studio" };
      case "drawings.thumbnail": return { svg: "<svg/>" };
      default: throw new Error(`unexpected ${args.method}`);
    }
  });
  const db = host.bb.storage.database();
  await plugin(host.bb);
  db.prepare("INSERT INTO drawings (id, name, data, created_at, updated_at) VALUES ('drw_0000000000000001', 'Plan', ?, 1, 1)").run(scene);
  return { host, calls };
}

it("bb excalidraw migrate copies into Studio, says Migration complete, and Setup sees it", async () => {
  const { host, calls } = await bridge();
  const result = await host.harness.behavior.runCli(["migrate"], {} as never);
  expect(result).toMatchObject({ exitCode: 0, stdout: expect.stringContaining("1 of 1 drawings are in Studio. Migration complete.") });
  expect(calls.map((each) => `${each.pluginId} ${each.method}`)).toEqual(["studio drawings.importRows"]);
  expect(await host.harness.behavior.callRpc("migrationStatus", null)).toMatchObject({ complete: true, total: 1, copied: 1 });
  // Old clients' calls go to Studio.
  expect(await host.harness.behavior.callRpc("getDrawing", { id: "drw_0000000000000001" })).toEqual({ drawing: null });
  expect(calls.at(-1)).toMatchObject({ pluginId: "studio", method: "drawings.getDrawing" });
});

it("registers no agent tools or UI, and points old commands at Studio", async () => {
  const { host } = await bridge();
  expect(host.harness.registrations.agentTools ?? []).toEqual([]);
  expect((await host.harness.behavior.runCli(["list"], {} as never)).stderr).toContain("bb studio drawings");
});

it("reports why it can't copy while Studio is down", async () => {
  const { host } = await bridge(false);
  const result = await host.harness.behavior.runCli(["migrate"], {} as never);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("not running");
  expect(await host.harness.behavior.callRpc("migrationStatus", null)).toMatchObject({ complete: false, error: expect.stringContaining("not running") });
});
