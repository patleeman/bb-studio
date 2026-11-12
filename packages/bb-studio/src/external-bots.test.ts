import { expect, it } from "vitest";
import { externalProviders } from "./external-bots";

it("says which external providers are ready, off, offline or missing, with ready ones' models", async () => {
  const view = await externalProviders({
    registered: async () => [{ id: "hermes", displayName: "Hermes", logoUrl: "/api/v1/system/providers/hermes/logo" }, { id: "grok", displayName: "Grok" }, { id: "codex", displayName: "Codex" }],
    health: async (provider) => provider === "hermes" ? { online: true, status: "ready", message: "ok" }
      : provider === "grok" ? { online: false, status: "unauthenticated", message: "xAI rejected the API key." }
      : { online: false, status: "disabled", message: "off" },
    models: async () => [{ id: "m1", model: "hermes-agent", displayName: "Hermes agent", isDefault: true }],
  });
  expect(view.installed).toBe(true);
  expect(view.providers.map((each) => [each.id, each.status])).toEqual([["hermes", "ready"], ["openclaw", "disabled"], ["grok", "unauthenticated"], ["dot", "disabled"]]);
  expect(view.providers[0]).toMatchObject({ logoUrl: "/api/v1/system/providers/hermes/logo", models: [{ id: "hermes-agent", displayName: "Hermes agent", isDefault: true }] });
  expect(view.providers[1]!.message).toContain("Studio Agents settings");
});

it("says Studio Agents is missing when its health RPC isn't there", async () => {
  const view = await externalProviders({ registered: async () => [], health: async () => { throw new Error("no plugin"); }, models: async () => [] });
  expect(view.installed).toBe(false);
  expect(view.providers.every((each) => each.status === "missing")).toBe(true);
});
