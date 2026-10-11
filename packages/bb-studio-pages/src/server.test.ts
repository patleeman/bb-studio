import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import plugin from "../server";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });

/** The bridge, with one old page that has a file and a version, talking to a fake Studio. */
async function bridge(studioUp = true) {
  const host = createFakePluginHost({ pluginId: "pages" });
  hosts.push(host);
  const calls: { pluginId: string; method: string; input: unknown }[] = [];
  const stub = host.harness.sdk.stub as unknown as (path: string, fn: (args: { pluginId: string; method: string; input: unknown }) => unknown) => void;
  stub("plugins.callRpc", async (args) => {
    calls.push(args);
    if (!studioUp) throw new Error("plugin studio is not running");
    switch (args.method) {
      case "pages.missingFiles": return { missing: (args.input as { ids: string[] }).ids };
      case "pages.importFile": return { ok: true };
      case "pages.importSnapshots": return { imported: (args.input as { snapshots: { id: string }[] }).snapshots.map((each) => each.id), existing: [], skipped: [] };
      case "pages.importRows": return { imported: (args.input as { pages: { id: string }[] }).pages.map((each) => each.id), existing: [], skipped: [] };
      case "pages.importSettings": return { applied: [] };
      case "pages.tree": return { pages: [] };
      case "pages.mentionContext": return { context: "From Studio" };
      default: throw new Error(`unexpected ${args.method}`);
    }
  });
  const db = host.bb.storage.database();
  await plugin(host.bb);
  db.prepare("INSERT INTO pages (id, title, created_at, updated_at, markdown) VALUES ('pg_0123456789ab', 'Launch', 1, 2, 'Hello')").run();
  db.prepare("INSERT INTO files (id, page_id, name, mime, size, data, created_at) VALUES ('file_1', 'pg_0123456789ab', 'a.png', 'image/png', 3, X'010203', 1)").run();
  db.prepare("INSERT INTO snapshots (id, page_id, state, label, actor, created_at) VALUES ('snap_1', 'pg_0123456789ab', X'00', 'Before', 'user', 1)").run();
  return { host, calls };
}

it("bb pages migrate copies into Studio, says Migration complete, and Setup sees it", async () => {
  const { host, calls } = await bridge();
  const result = await host.harness.behavior.runCli(["migrate"], {} as never);
  expect(result).toMatchObject({ exitCode: 0, stdout: expect.stringContaining("1 of 1 pages, with their versions, files and comments, the Next row's click stats and your Pages settings are in Studio. Migration complete.") });
  expect(calls.map((each) => `${each.pluginId} ${each.method}`)).toEqual([
    "studio pages.missingFiles", "studio pages.importFile", "studio pages.importSnapshots", "studio pages.importRows", "studio pages.importSettings",
  ]);
  expect(calls[1]!.input).toMatchObject({ id: "file_1", size: 3, data: "AQID" });
  expect(calls.at(-1)!.input).toMatchObject({ settings: { snapshotsPerPage: 50, explore_next: true } });
  expect(await host.harness.behavior.callRpc("migrationStatus", null)).toMatchObject({ complete: true, total: 1, copied: 1 });
  // Old clients' calls go to Studio.
  expect(await host.harness.behavior.callRpc("tree", {})).toEqual({ pages: [] });
  expect(calls.at(-1)).toMatchObject({ pluginId: "studio", method: "pages.tree" });
  // Old file URLs land on Studio's.
  const response = await host.harness.behavior.fetchHttp("GET", "/files?id=file_1");
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/api/v1/plugins/studio/http/pages/files?id=file_1");
});

it("registers no agent tools or UI, and points old commands at Studio", async () => {
  const { host } = await bridge();
  expect(host.harness.registrations.agentTools ?? []).toEqual([]);
  expect((await host.harness.behavior.runCli(["list"], {} as never)).stderr).toContain("bb studio pages");
});

it("reports why it can't copy while Studio is down", async () => {
  const { host } = await bridge(false);
  const result = await host.harness.behavior.runCli(["migrate"], {} as never);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("not running");
  expect(await host.harness.behavior.callRpc("migrationStatus", null)).toMatchObject({ complete: false, error: expect.stringContaining("not running") });
});
