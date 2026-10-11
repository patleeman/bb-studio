import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import plugin from "../server";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });

/** The bridge, with one old design, talking to a fake Studio. */
async function bridge(studioUp = true) {
  const host = createFakePluginHost({ pluginId: "design" });
  hosts.push(host);
  const calls: { pluginId: string; method: string; input: unknown }[] = [];
  const stub = host.harness.sdk.stub as unknown as (path: string, fn: (args: { pluginId: string; method: string; input: unknown }) => unknown) => void;
  stub("plugins.callRpc", async (args) => {
    calls.push(args);
    if (!studioUp) throw new Error("plugin studio is not running");
    switch (args.method) {
      case "designs.importRows": return { imported: (args.input as { designs: { id: string }[] }).designs.map((each) => each.id), existing: [], skipped: [] };
      case "designs.importStyles": return { imported: [], existing: [], skipped: [] };
      case "designs.getDesign": return { design: null };
      case "designs.mentionContext": return { context: "From Studio" };
      default: throw new Error(`unexpected ${args.method}`);
    }
  });
  const db = host.bb.storage.database();
  await plugin(host.bb);
  db.prepare("INSERT INTO designs (id, name, created_at, updated_at) VALUES ('dsn_0000000000000001', 'Plan', 1, 1)").run();
  return { host, calls };
}

it("bb design migrate copies into Studio, says Migration complete, and Setup sees it", async () => {
  const { host, calls } = await bridge();
  const result = await host.harness.behavior.runCli(["migrate"], {} as never);
  expect(result).toMatchObject({ exitCode: 0, stdout: expect.stringContaining("1 of 1 designs and saved styles are in Studio. Migration complete.") });
  expect(calls.map((each) => `${each.pluginId} ${each.method}`)).toEqual(["studio designs.importRows"]);
  expect(await host.harness.behavior.callRpc("migrationStatus", null)).toMatchObject({ complete: true, total: 1, copied: 1 });
  // Old clients' calls go to Studio.
  expect(await host.harness.behavior.callRpc("getDesign", { id: "dsn_0000000000000001" })).toEqual({ design: null });
  expect(calls.at(-1)).toMatchObject({ pluginId: "studio", method: "designs.getDesign" });
  // Old screen URLs land on Studio's.
  const response = await host.harness.behavior.fetchHttp("GET", "/screen?design=dsn_0000000000000001&screen=1a&v=1");
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/api/v1/plugins/studio/http/designs/screen?design=dsn_0000000000000001&screen=1a&v=1");
});

it("registers no agent tools or UI, and points old commands at Studio", async () => {
  const { host } = await bridge();
  expect(host.harness.registrations.agentTools ?? []).toEqual([]);
  expect((await host.harness.behavior.runCli(["list"], {} as never)).stderr).toContain("bb studio designs");
});

it("reports why it can't copy while Studio is down", async () => {
  const { host } = await bridge(false);
  const result = await host.harness.behavior.runCli(["migrate"], {} as never);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("not running");
  expect(await host.harness.behavior.callRpc("migrationStatus", null)).toMatchObject({ complete: false, error: expect.stringContaining("not running") });
});
