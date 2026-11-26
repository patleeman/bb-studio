// Studio's load must not wait on BB calls that BB answers only after every
// plugin has loaded (provider lists, models and states wait on provider
// registrations to settle) or once a host is connected. An awaited one held
// every BB start until BB's 30 s plugin load timeout. Here those calls never
// answer, and the real plugin must still finish loading.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { expect, it } from "vitest";
import plugin from "../server";

it("Studio finishes loading while BB's provider, plugin and system calls don't answer", async () => {
  const never = () => new Promise<never>(() => {});
  const calls: string[] = [];
  const hang = (area: string, methods: string[]) => Object.fromEntries(methods.map((method) => [method, () => { calls.push(`${area}.${method}`); return never(); }]));
  const host = createFakePluginHost({
    pluginId: "studio",
    sdk: {
      threads: { list: async () => [], get: async () => null },
      projects: { list: async () => [] },
      providers: hang("providers", ["list", "models", "catalog"]),
      plugins: hang("plugins", ["list", "callRpc"]),
      system: hang("system", ["config", "providerStates", "usageLimits"]),
    },
  } as never);
  const loaded = await Promise.race([
    plugin(host.bb).then(() => "loaded" as const),
    new Promise<"stuck">((resolve) => setTimeout(() => resolve("stuck"), 5_000)),
  ]);
  try {
    expect(loaded).toBe("loaded");
    // The calls still go out, in the background, so Studio has the answers once BB gives them.
    expect(calls).toEqual(expect.arrayContaining(["providers.list", "plugins.list"]));
  } finally {
    await host.harness.lifecycle.dispose();
  }
}, 20_000);
