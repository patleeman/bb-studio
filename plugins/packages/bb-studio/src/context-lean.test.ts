import { describe, expect, it } from "vitest";
import { isLocalModel, LEAN_KEY, LeanStore, leanFor } from "./context-lean";
import { describeRow } from "./settings/ui/AgentContextSection";

describe("lean context", () => {
  it("knows a local model by its id", () => {
    for (const model of ["inkling-local/inkling-2-mini", "ollama/qwen3", "lmstudio/glm", "desktop-vllm/qwen3.8", "llama.cpp/x", "localhost:8080/m", "127.0.0.1/m"]) expect(isLocalModel(model)).toBe(true);
    for (const model of ["claude-opus-5-5", "opencode-go/glm-5.3", "gpt-5.5-codex", "", null]) expect(isLocalModel(model)).toBe(false);
  });

  it("Auto is lean only for an ACP agent on a local model; Lean and Full win", () => {
    expect(leanFor({}, "acp-opencode", "inkling-local/inkling-2-mini")).toBe(true);
    expect(leanFor({}, "acp-opencode", "opencode-go/glm-5.3")).toBe(false);
    expect(leanFor({}, "pi", "inkling-desktop-local/x")).toBe(false);
    expect(leanFor({ "acp-opencode": "full" }, "acp-opencode", "inkling-local/x")).toBe(false);
    expect(leanFor({ codex: "lean" }, "codex", "gpt-5.5")).toBe(true);
  });

  it("stores only the providers not on Auto", async () => {
    const data = new Map<string, unknown>([[LEAN_KEY, { pi: "lean", bad: "maybe" }]]);
    const store = new LeanStore({ get: (key) => data.get(key), set: (key, value) => void data.set(key, value) });
    await store.load();
    expect(store.current).toEqual({ pi: "lean" });
    await store.set("codex", "full");
    await store.set("pi", "auto");
    expect(data.get(LEAN_KEY)).toEqual({ codex: "full" });
  });

  it("describes a row with the mode in effect and the tool counts", () => {
    const row = { id: "acp-opencode", name: "OpenCode", acp: true, tools: { lean: 4, full: 17 }, fullDelivery: "search" as const };
    expect(describeRow({ ...row, mode: "auto" })).toBe("Lean · 4 tools with a local model; Full · 17 tools otherwise");
    expect(describeRow({ ...row, mode: "lean" })).toBe("Lean · 4 tools");
    expect(describeRow({ ...row, id: "claude-code", name: "Claude Code", acp: false, mode: "auto", tools: { lean: 4, full: 70 }, fullDelivery: "native" })).toBe("Full · 70 tools, most on demand");
  });
});
