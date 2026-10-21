import { afterEach, expect, test } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { rpcContract } from "../contract";
import { SECRET_KEYS } from "../src/settings";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((dispose) => dispose())); });
async function setup(failFirst = false) {
  const calls: { pluginId: string; method: string; input?: unknown }[] = [];
  const host = createFakePluginHost({ pluginId: "smart-decisions", settings: Object.fromEntries(SECRET_KEYS.map((key) => [key, `fixture-${key}`])), sdk: {
    threads: { list: async () => [] },
    plugins: { callRpc: async (args: any) => {
      calls.push(args);
      if (args.method === "decisions.import") {
        if (failFirst) { failFirst = false; throw new Error("Studio unavailable"); }
        return { complete: true };
      }
      if (args.method === "decisions.cli") return { exitCode: 0, stdout: "forwarded" };
      if (args.method === "decisions.studio_health") return { checks: [] };
      return args.method === "decisions.fallback.get" || args.method === "decisions.fallback.set" ? { mode: "off" } : args.method === "decisions.fallback.suggest" ? null : args.method === "decisions.jev.status" ? { provider: "auto", routes: [], problems: [] } : args.method === "decisions.jev.check" ? { ok: false, error: "fixture" } : { ok: false, unavailable: true, error: "fixture" };
    } },
  } });
  cleanup.push(() => host.harness.lifecycle.dispose());
  await host.bb.storage.kv.set("fallback", { mode: "off" });
  await host.bb.storage.kv.set("recent-decisions", []);
  await plugin(host.bb);
  return { ...host, calls };
}

test("forwards every old RPC after one acknowledged copy, and keeps secret values out of responses", async () => {
  const { harness, calls } = await setup();
  const inputs: Record<string, unknown> = {
    "systemOne.ask": { caller: "test", state: {}, questions: { urgent: { type: "noul", instructions: "Urgent?" } } },
    "model.ask": { caller: "test", requestId: "one", hostId: "host", prompt: "fixture", providerId: null },
    "fallback.set": { mode: "off" },
  };
  for (const method of [...Object.keys(rpcContract), "studio_health"]) {
    const result = await harness.behavior.callRpc(method, inputs[method] ?? (method === "studio_health" ? {} : null));
    expect(calls.at(-1)).toMatchObject({ pluginId: "studio", method: `decisions.${method}` });
    expect(JSON.stringify(result)).not.toContain("fixture-typesafeApiKey");
  }
  const imports = calls.filter((call) => call.method === "decisions.import");
  expect(imports).toHaveLength(1);
  expect(imports[0]!.input).toEqual({ fallback: { mode: "off" }, recent: [], secrets: Object.fromEntries(SECRET_KEYS.map((key) => [key, `fixture-${key}`])) });
  expect(JSON.stringify(harness.logEntries)).not.toContain("fixture-typesafeApiKey");
});

test("retries migration and never forwards until Studio acknowledges", async () => {
  const { harness, calls } = await setup(true);
  expect(await harness.behavior.callRpc("migrationStatus", null)).toEqual({ complete: false });
  expect(calls.map((call) => call.method)).toEqual(["decisions.import"]);
  expect(await harness.behavior.callRpc("migrationStatus", null)).toEqual({ complete: true });
  expect((await harness.behavior.runCli(["migrate"])).stdout).toBe("Migration complete");
  for (const command of ["status", "recent", "classify", "check", "fallback"]) {
    expect((await harness.behavior.runCli([command, "--json"])).stdout).toBe("forwarded");
    expect(calls.at(-1)).toMatchObject({ method: "decisions.cli", input: { argv: [command, "--json"] } });
  }
  // The only service is migration: no hook, queue watcher or recovery classifier.
  expect(harness.registrations.services.map((service: any) => service.name)).toEqual(["migration"]);
  expect(harness.registrations.hooks["message.dispatch"]).toBeFalsy();
});

test("drains only old hidden classifiers before Studio takes ownership and retries a failed drain", async () => {
  const events: string[] = [];
  let firstStop = true;
  const host = createFakePluginHost({ pluginId: "smart-decisions", sdk: {
    threads: {
      list: async () => [
        { id: "stale", title: "Studio Decisions · old", visibility: "hidden" },
        { id: "work", title: "Studio Decisions · work", visibility: "visible" },
        { id: "other", title: "Other hidden work", visibility: "hidden" },
      ] as never,
      stop: async ({ threadId }: any) => { events.push(`stop:${threadId}`); if (firstStop) { firstStop = false; throw new Error("busy"); } return {} as never; },
      delete: async ({ threadId }: any) => { events.push(`delete:${threadId}`); return {} as never; },
    },
    plugins: { callRpc: async () => { events.push("import"); return { complete: true } as never; } },
  } });
  cleanup.push(() => host.harness.lifecycle.dispose());
  await plugin(host.bb);
  expect(await host.harness.behavior.callRpc("migrationStatus", null)).toEqual({ complete: false });
  expect(events).toEqual(["stop:stale"]);
  expect(await host.harness.behavior.callRpc("migrationStatus", null)).toEqual({ complete: true });
  expect(events).toEqual(["stop:stale", "stop:stale", "delete:stale", "import"]);
});
