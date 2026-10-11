import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import plugin from "../server";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });

/** The bridge, with one old recording (no audio), talking to a fake Studio. */
async function bridge(studioUp = true) {
  const host = createFakePluginHost({ pluginId: "talk" });
  hosts.push(host);
  const calls: { pluginId: string; method: string; input: unknown }[] = [];
  const stub = host.harness.sdk.stub as unknown as (path: string, fn: (args: { pluginId: string; method: string; input: unknown }) => unknown) => void;
  stub("plugins.callRpc", async (args) => {
    calls.push(args);
    if (!studioUp) throw new Error("plugin studio is not running");
    switch (args.method) {
      case "recordings.missingAudio": return { missing: [], freeBytes: null };
      case "recordings.importRows": return { imported: (args.input as { recordings: { id: string }[] }).recordings.map((each) => each.id), existing: [], skipped: [] };
      case "recordings.importSettings": return { applied: [] };
      case "recordings.recordings_list": return { recordings: [] };
      case "recordings.mentionContext": return { context: "From Studio" };
      default: throw new Error(`unexpected ${args.method}`);
    }
  });
  const db = host.bb.storage.database();
  await plugin(host.bb);
  db.prepare("INSERT INTO recordings (id, title, title_source, kind, status, created_at, updated_at, heartbeat_at) VALUES ('rec_aaaaaaaa', 'Standup', 'user', 'recording', 'done', 1, 1, 1)").run();
  await host.bb.storage.kv.set("model:title", { providerId: "codex", model: "gpt-5", reasoningLevel: "low" });
  return { host, calls };
}

it("bb talk migrate copies into Studio, says Migration complete, and Setup sees it", async () => {
  const { host, calls } = await bridge();
  const result = await host.harness.behavior.runCli(["migrate"], {} as never);
  expect(result).toMatchObject({ exitCode: 0, stdout: expect.stringContaining("1 of 1 recordings, with their audio, and your Talk settings are in Studio. Migration complete.") });
  expect(calls.map((each) => `${each.pluginId} ${each.method}`)).toEqual(["studio recordings.importRows", "studio recordings.importSettings"]);
  expect(calls.at(-1)!.input).toMatchObject({ settings: { segmentSeconds: 25, replaceBuiltInDictation: true }, models: { title: { model: "gpt-5" } } });
  expect(await host.harness.behavior.callRpc("migrationStatus", null)).toMatchObject({ complete: true, total: 1, copied: 1 });
  // Old clients' calls go to Studio.
  expect(await host.harness.behavior.callRpc("recordings_list", {})).toEqual({ recordings: [] });
  expect(calls.at(-1)).toMatchObject({ pluginId: "studio", method: "recordings.recordings_list" });
  // Old audio URLs land on Studio's.
  const response = await host.harness.behavior.fetchHttp("GET", "/audio?recording=rec_aaaaaaaa&segment=s1-0");
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/api/v1/plugins/studio/http/recordings/audio?recording=rec_aaaaaaaa&segment=s1-0");
});

it("registers no agent tools or UI, and points old commands at Studio", async () => {
  const { host } = await bridge();
  expect(host.harness.registrations.agentTools ?? []).toEqual([]);
  expect((await host.harness.behavior.runCli(["list"], {} as never)).stderr).toContain("bb studio recordings");
});

it("reports why it can't copy while Studio is down", async () => {
  const { host } = await bridge(false);
  const result = await host.harness.behavior.runCli(["migrate"], {} as never);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("not running");
  expect(await host.harness.behavior.callRpc("migrationStatus", null)).toMatchObject({ complete: false, error: expect.stringContaining("not running") });
});
