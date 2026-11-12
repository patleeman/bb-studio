import { describe, expect, it, vi } from "vitest";
import { formatModelName, ModelNames } from "./model-names";

describe("a model's display name", () => {
  it("falls back to BB's label for a model its catalog doesn't name", () => {
    expect(formatModelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(formatModelName("claude-fable-5-2")).toBe("Fable 5.2");
    expect(formatModelName("gpt-5.1-codex")).toBe("gpt 5.1 Codex");
    expect(formatModelName("claude")).toBe("Claude");
  });

  it("uses the provider's catalog once read, by model or id, and the fallback before and on failure", async () => {
    let now = 0;
    const load = vi.fn(async (providerId: string) => {
      if (providerId === "offline") throw new Error("offline");
      return [{ id: "opus", model: "claude-opus-5-5", displayName: "Claude Opus 5.5" }, { id: "fable", model: null, displayName: "Fable" }, { id: "x", model: "x", displayName: " " }];
    });
    const names = new ModelNames(load, 1000, () => now);
    expect(names.name("claude-code", "claude-opus-5-5")).toBe("Opus 5.5");
    await Promise.all([names.warm("claude-code"), names.warm("claude-code")]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(names.name("claude-code", "claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(names.name("claude-code", "fable")).toBe("Fable");
    expect(names.name("claude-code", "x")).toBe("x");
    expect(names.name("codex", "claude-opus-5-5")).toBe("Opus 5.5");
    await names.warm("claude-code");
    expect(load).toHaveBeenCalledTimes(1);
    now = 2000;
    await names.warm("claude-code");
    expect(load).toHaveBeenCalledTimes(2);
    await names.warm("offline");
    expect(names.name("offline", "claude-opus-5-5")).toBe("Opus 5.5");
    await names.warm(null);
    expect(load).toHaveBeenCalledTimes(3);
  });
});
