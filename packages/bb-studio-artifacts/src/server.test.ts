import { createHash } from "node:crypto";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import plugin from "../server";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });

/** The bridge, with one old artifact, talking to a fake Studio. */
async function bridge(studioUp = true) {
  const host = createFakePluginHost({ pluginId: "artifacts" });
  hosts.push(host);
  const calls: { pluginId: string; method: string; input: unknown }[] = [];
  const stub = host.harness.sdk.stub as unknown as (path: string, fn: (args: { pluginId: string; method: string; input: unknown }) => unknown) => void;
  stub("plugins.callRpc", async (args) => {
    calls.push(args);
    if (!studioUp) throw new Error("plugin studio is not running");
    switch (args.method) {
      case "artifacts.missingBlobs": return { missing: (args.input as { sha256: string[] }).sha256 };
      case "artifacts.importBlob": return { ok: true };
      case "artifacts.importRows": return { imported: (args.input as { artifacts: { id: string }[] }).artifacts.map((each) => each.id), existing: [], skipped: [] };
      case "artifacts.get": return { artifact: null, versions: [] };
      case "artifacts.mentionContext": return { context: "From Studio" };
      default: throw new Error(`unexpected ${args.method}`);
    }
  });
  const db = host.bb.storage.database();
  await plugin(host.bb);
  const hash = createHash("sha256").update("hi").digest("hex");
  db.prepare("INSERT INTO artifacts (id, title, created_at, updated_at) VALUES ('art_0000000000000001', 'Hi', 1, 1)").run();
  db.prepare("INSERT INTO artifact_versions (id, artifact_id, number, name, mime, size, sha256, created_at) VALUES ('v1', 'art_0000000000000001', 1, 'hi.txt', 'text/plain', 2, ?, 1)").run(hash);
  db.prepare("INSERT INTO artifact_blobs (sha256, bytes) VALUES (?, ?)").run(hash, Buffer.from("hi"));
  return { host, calls };
}

it("bb artifacts migrate copies into Studio, says Migration complete, and Setup sees it", async () => {
  const { host, calls } = await bridge();
  const result = await host.harness.behavior.runCli(["migrate"], {} as never);
  expect(result).toMatchObject({ exitCode: 0, stdout: expect.stringContaining("1 of 1 artifacts are in Studio. Migration complete.") });
  expect(calls.map((each) => `${each.pluginId} ${each.method}`)).toEqual(["studio artifacts.missingBlobs", "studio artifacts.importBlob", "studio artifacts.importRows"]);
  expect(await host.harness.behavior.callRpc("migrationStatus", null)).toMatchObject({ complete: true, total: 1, copied: 1 });
  // Old clients' calls and mentions go to Studio.
  expect(await host.harness.behavior.callRpc("get", { id: "art_0000000000000001" })).toEqual({ artifact: null, versions: [] });
  expect(calls.at(-1)).toMatchObject({ pluginId: "studio", method: "artifacts.get" });
});

it("registers no agent tools or UI, and points old commands at Studio", async () => {
  const { host } = await bridge();
  expect(host.harness.registrations.agentTools ?? []).toEqual([]);
  expect((await host.harness.behavior.runCli(["list"], {} as never)).stderr).toContain("bb studio artifacts");
});

it("reports why it can't copy while Studio is down", async () => {
  const { host } = await bridge(false);
  const result = await host.harness.behavior.runCli(["migrate"], {} as never);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("not running");
  expect(await host.harness.behavior.callRpc("migrationStatus", null)).toMatchObject({ complete: false, error: expect.stringContaining("not running") });
});
