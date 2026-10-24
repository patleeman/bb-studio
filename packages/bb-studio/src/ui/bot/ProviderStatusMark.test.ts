import { describe, expect, it } from "vitest";
import { elapsedClock, providerRingState, resolveProviderIcon, runnerStatusTone, runningLabel, threadStatusTone, type ProviderCatalogEntry } from "./ProviderStatusMark";

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
  ] as const)("maps thread status %s (waiting on an answer: %s) to the %s ring", (status, waiting, ring) => {
    expect(providerRingState(threadStatusTone(status, waiting))).toBe(ring);
    if (waiting) expect(threadStatusTone(status, waiting)).toBe("needs");
  });

  it("shows a runner as running only mid-run; between runs it's idle", () => {
    expect(runnerStatusTone("active")).toBe("idle");
    expect(runnerStatusTone("active", true)).toBe("running");
    expect(runnerStatusTone("paused", true)).toBe("idle");
    expect(runnerStatusTone("paused")).toBe("idle");
  });

  it("ticks the elapsed time as m:ss, then h:mm:ss, and says it in words", () => {
    expect(elapsedClock(0, 42_000)).toBe("0:42");
    expect(elapsedClock(0, 12 * 60_000 + 5_000)).toBe("12:05");
    expect(elapsedClock(0, 3_600_000 + 2 * 60_000 + 10_000)).toBe("1:02:10");
    expect(runningLabel(0, 12 * 60_000)).toBe("Running for 12 minutes");
    expect(runningLabel(null)).toBe("Running");
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
