import { describe, expect, it } from "vitest";
import { providerRingState, resolveProviderIcon, runnerStatusTone, threadStatusTone, type ProviderCatalogEntry } from "./ProviderStatusMark";

describe("provider status rings", () => {
  it.each([
    ["active", false, "running"],
    ["starting", false, "running"],
    ["stopping", false, "running"],
    ["idle", false, "idle"],
    ["pending", false, "waiting"],
    ["active", true, "waiting"],
    ["error", false, "failed"],
    ["failed", false, "failed"],
  ] as const)("maps thread status %s (needs-you: %s) to the %s ring", (status, needsYou, ring) => {
    expect(providerRingState(threadStatusTone(status, needsYou))).toBe(ring);
  });

  it("maps runner urgency and enablement to its visible status", () => {
    expect(runnerStatusTone("active", false)).toBe("running");
    expect(runnerStatusTone("paused", false)).toBe("idle");
    expect(runnerStatusTone("active", true)).toBe("needs");
  });
});

describe("provider icon resolution", () => {
  const claude = { id: "claude", displayName: "Claude", logoUrl: "/providers/claude.svg" } as ProviderCatalogEntry;
  const codex = { id: "codex", displayName: "Codex", logoUrl: null, icon: { glyph: "◉" } } as ProviderCatalogEntry;
  const providers = [claude, codex];

  it("uses the matching provider catalog entry, including glyph-backed providers", () => {
    expect(resolveProviderIcon("claude", providers)).toBe(claude);
    expect(resolveProviderIcon("codex", providers)).toBe(codex);
  });

  it("returns no provider artwork for unknown or missing ids", () => {
    expect(resolveProviderIcon("unlisted-provider", providers)).toBeNull();
    expect(resolveProviderIcon(null, providers)).toBeNull();
  });
});
