import { beforeEach, describe, expect, it } from "vitest";
import { isLocalAcpProvider, leanFor } from "./context-lean";
import { isAcpProvider } from "./move-provider/core";
import { isAcpAgent, noteCatalog, noteProviders, refreshProviderFamilies, resetProviderFamilies } from "./provider-family";
import { multiBackend } from "./router/select";

// provider-antigravity's declaration: a plugin provider of the ACP family, not an acp-* id.
const ANTIGRAVITY = { id: "antigravity", family: "acp", capabilities: { permissionModes: ["accept-edits", "full"] } };

beforeEach(() => resetProviderFamilies());

describe("isAcpAgent", () => {
  it("keeps every acp-* agent an ACP agent, with or without a provider list", () => {
    for (const id of ["acp-opencode", "acp-antigravity-acp", "acp-ollama", "acp-hermes"]) {
      expect(isAcpAgent(id)).toBe(true);
      expect(isAcpProvider(id)).toBe(true);
      expect(multiBackend(id)).toBe(true);
    }
    noteProviders([{ id: "acp-opencode", family: "something-else" }]);
    expect(isAcpAgent("acp-opencode")).toBe(true);
  });

  it("counts a provider plugin that declares the ACP family, once BB's list says so", () => {
    expect(isAcpAgent("antigravity")).toBe(false);
    noteProviders([ANTIGRAVITY, { id: "codex" }, { id: "claude-code", family: undefined }]);
    expect(isAcpAgent("antigravity")).toBe(true);
    expect(isAcpProvider("antigravity")).toBe(true);
    expect(multiBackend("antigravity")).toBe(true);
    expect(isAcpAgent("codex")).toBe(false);
    expect(isAcpAgent("claude-code")).toBe(false);
    expect(multiBackend("codex")).toBe(false);
    expect(multiBackend("pi")).toBe(true);
  });

  it("reads the family from a catalog entry's info", () => {
    noteCatalog([{ id: "antigravity", info: { family: "acp" } }, { id: "codex", info: null }, { id: "claude-code" }]);
    expect(isAcpAgent("antigravity")).toBe(true);
    expect(isAcpAgent("codex")).toBe(false);
  });

  it("refreshes from sdk.providers.list at most every 30 seconds, and survives a failed read", async () => {
    let calls = 0;
    const sdk = { list: async () => { calls++; return [ANTIGRAVITY]; } };
    await refreshProviderFamilies(sdk, true);
    await refreshProviderFamilies(sdk);
    expect(calls).toBe(1);
    expect(isAcpAgent("antigravity")).toBe(true);
    await refreshProviderFamilies({ list: async () => { throw new Error("down"); } }, true);
    expect(isAcpAgent("antigravity")).toBe(true);
  });
});

describe("Lean for ACP-family providers", () => {
  it("keeps Antigravity full: its models are cloud models", () => {
    noteProviders([ANTIGRAVITY]);
    expect(leanFor({}, "antigravity", "gemini-4-neon")).toBe(false);
    expect(leanFor({ antigravity: "lean" }, "antigravity", "gemini-4-neon")).toBe(true);
  });

  it("runs a local model lean on any ACP agent, and judges a family provider's slug whole", () => {
    expect(leanFor({}, "antigravity", "qwen3:8b")).toBe(false);
    noteProviders([ANTIGRAVITY, { id: "ollama-agent", family: "acp" }]);
    expect(leanFor({}, "antigravity", "qwen3:8b")).toBe(true);
    expect(isLocalAcpProvider("ollama-agent")).toBe(true);
    expect(leanFor({}, "ollama-agent", "acp-default")).toBe(true);
    expect(isLocalAcpProvider("antigravity")).toBe(false);
    expect(isLocalAcpProvider("acp-ollama")).toBe(true);
    expect(isLocalAcpProvider("ollama")).toBe(false);
  });
});
