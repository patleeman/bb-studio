import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { ModuleRuntime, type ServerModule } from "./runtime";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
function fixture(installed: { id: string; enabled: boolean }[] = []) {
  const dataDir = mkdtempSync(join(tmpdir(), "studio-runtime-"));
  const host = createFakePluginHost({ pluginId: "studio", dataDir,
    sdk: { plugins: { list: async () => ({ plugins: installed }) } } });
  cleanups.push(async () => { await host.harness.lifecycle.dispose(); rmSync(dataDir, { recursive: true, force: true }); });
  const runtime = new ModuleRuntime(host.bb);
  const core = runtime.coreApi();
  core.rpc.register({ echo: { input: z.string(), output: z.string() } }, { echo: input => input });
  core.cli.register({ name: "studio", summary: "Studio", run: () => ({ exitCode: 0, stdout: "core" }) });
  return { host, runtime };
}

it("registers disjoint RPCs and runs cross-module calls without host RPC", async () => {
  const { host, runtime } = fixture();
  const module = (name: string): ServerModule => ({ name, legacyPluginId: `old-${name}`, registerServer({ bb }) {
    bb.rpc.register({ read: { input: z.string(), output: z.string() } }, {
      read: value => bb.sdk.plugins.callRpc({ pluginId: "studio", method: "echo", input: value, outputSchema: z.string() }),
    });
    bb.cli.register({ name, summary: name, run: argv => ({ exitCode: 0, stdout: argv.join(" ") }) });
  } });
  await runtime.register([module("tables"), module("chat")]);
  expect(await host.harness.behavior.callRpc("tables_read", "one")).toBe("one");
  expect(await runtime.services.call("old-chat", "read", "two")).toBe("two");
  expect(await host.harness.registrations.cli!.run(["old-tables", "query", "one"], {})).toEqual({ exitCode: 0, stdout: "query one" });
  expect(await host.harness.registrations.cli!.run(["list"], {})).toEqual({ exitCode: 0, stdout: "core" });
});

it("skips enabled old plugins before registration or import", async () => {
  const { runtime } = fixture([{ id: "old-tables", enabled: true }]);
  const registerServer = vi.fn();
  await runtime.register([{ name: "tables", legacyPluginId: "old-tables", registerServer }]);
  expect(registerServer).not.toHaveBeenCalled();
  expect(runtime.skipped).toEqual(["old-tables"]);
});

it("isolates same-named KV keys in different module databases", async () => {
  const { runtime } = fixture();
  const module = (name: string): ServerModule => ({ name, legacyPluginId: `old-${name}`, async registerServer({ bb }) {
    await bb.storage.kv.set("link:same", name);
    await bb.storage.kv.set("other", "untouched");
    expect(await bb.storage.kv.list("link:")).toEqual(["link:same"]);
    bb.rpc.register({ value: { input: z.null(), output: z.string() } }, {
      value: async () => (await bb.storage.kv.get<string>("link:same"))!,
    });
  } });
  await runtime.register([module("tables"), module("chat")]);
  expect(await runtime.services.call("old-tables", "value", null)).toBe("tables");
  expect(await runtime.services.call("old-chat", "value", null)).toBe("chat");
});

it("runs the moved Tables and Chat implementations together under Studio", async () => {
  const { registerServer: tables } = await import("./tables/server");
  const { registerServer: chat } = await import("./chat/server");
  const { host, runtime } = fixture();
  await runtime.register([
    { name: "tables", legacyPluginId: "studio-tables", registerServer: tables },
    { name: "chat", legacyPluginId: "studio-chat", registerServer: chat },
  ]);
  const created = await host.harness.behavior.callRpc("tables_create", { title: "Migrated workflow", projectId: null }) as { table: { id: string } };
  expect(await host.harness.behavior.callRpc("tables_get", { id: created.table.id })).toMatchObject({ table: { title: "Migrated workflow" } });
  expect(await runtime.services.call("studio-tables", "list", null)).toMatchObject({ tables: [{ title: "Migrated workflow" }] });
  expect(runtime.services.has("studio-chat")).toBe(true);
});
