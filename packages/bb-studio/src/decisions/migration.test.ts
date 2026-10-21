import { afterEach, expect, test, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { DECISIONS_SETTINGS } from "./settings";
import { registerDecisionsImport, secretKeys } from "./migration";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((dispose) => dispose())); });
function setup(existing: Record<string, string | boolean> = {}) {
  const host = createFakePluginHost({ pluginId: "studio", settings: existing, sdk: {
    plugins: {
      list: async () => ({ plugins: [{ id: "smart-decisions", version: "0.5.0", enabled: true }] }) as never,
      getSettings: async () => ({ values: { enabled: false, jevProvider: "custom", customJevHeaders: "local: fixture", typesafeApiKey: { set: true } } }) as never,
    },
  } });
  cleanup.push(() => host.harness.lifecycle.dispose());
  const settings = host.bb.settings.define(DECISIONS_SETTINGS);
  const migration = registerDecisionsImport(host.bb, settings);
  const secrets = Object.fromEntries(secretKeys.map((key) => [key, `fixture-${key}`]));
  const payload = { secrets, fallback: { mode: "off" }, recent: [] };
  const submit = () => host.harness.behavior.callRpc("decisions.import", payload, { experimental_caller: { kind: "plugin", pluginId: "smart-decisions" } });
  return { ...host, settings, migration, payload, submit };
}

test("copies ordinary settings and all five secrets server to server, acknowledging only completion", async () => {
  const { submit, settings, migration, harness, bb } = setup();
  expect(await migration.ready()).toBe(false);
  const result = await submit();
  expect(result).toEqual({ complete: true });
  const current = await settings.get();
  for (const key of secretKeys) {
    expect(current[`decisions_${key}`]).toBe(`fixture-${key}`);
    expect(harness.registrations.settingsDescriptors[`decisions_${key}`]).toMatchObject({ secret: true });
  }
  expect(current.decisions_enabled).toBe(false);
  expect(current.decisions_customJevHeaders).toBe("local: fixture");
  expect(await bb.storage.kv.get("decisions:fallback")).toEqual({ mode: "off" });
  expect(await bb.storage.kv.get("decisions:recent-decisions")).toEqual([]);
  expect(await migration.ready()).toBe(true);
  expect(JSON.stringify([result, harness.logEntries])).not.toContain("fixture-");
});

test("rejects client and unrelated-plugin secret imports before any read or write", async () => {
  const { harness, payload, settings } = setup();
  await expect(harness.behavior.callRpc("decisions.import", payload)).rejects.toThrow("Only the Decisions");
  await expect(harness.behavior.callRpc("decisions.import", payload, { experimental_caller: { kind: "plugin", pluginId: "other" } })).rejects.toThrow("Only the Decisions");
  expect((await settings.get()).decisions_typesafeApiKey).toBeUndefined();
  expect(harness.inspection.sdk.callsTo("plugins.getSettings")).toHaveLength(0);
});

test("keeps explicit destination defaults, blank keys and existing KV, and reruns are no-ops", async () => {
  const { submit, payload, settings, bb } = setup({ decisions_enabled: true, decisions_typesafeApiKey: "", decisions_jevProvider: "auto", decisions_vercelApiKey: "destination" });
  await bb.storage.kv.set("decisions:fallback", { mode: "thread" });
  await bb.storage.kv.set("decisions:recent-decisions", [{ kept: true }]);
  await Promise.all([submit(), submit()]);
  expect(await settings.get()).toMatchObject({ decisions_enabled: true, decisions_typesafeApiKey: "", decisions_jevProvider: "auto", decisions_vercelApiKey: "destination" });
  expect(await bb.storage.kv.get("decisions:fallback")).toEqual({ mode: "thread" });
  expect(await bb.storage.kv.get("decisions:recent-decisions")).toEqual([{ kept: true }]);
  payload.secrets.zenApiKey = "changed-source";
  await submit();
  expect((await settings.get()).decisions_zenApiKey).toBe("fixture-zenApiKey");
});

test("retries an interrupted write without acknowledging or overwriting a completed partial copy", async () => {
  const { submit, bb, settings, migration } = setup();
  const set = bb.storage.kv.set.bind(bb.storage.kv);
  let fail = true;
  vi.spyOn(bb.storage.kv, "set").mockImplementation(async (key, value) => {
    if (key === "decisions:recent-decisions" && fail) { fail = false; throw new Error("temporary failure"); }
    await set(key, value);
  });
  await expect(submit()).rejects.toThrow("temporary failure");
  expect(await migration.ready()).toBe(false);
  await settings.experimental_set({ decisions_zenApiKey: "new-destination" });
  await submit();
  expect(await migration.ready()).toBe(true);
  expect((await settings.get()).decisions_zenApiKey).toBe("new-destination");
});
