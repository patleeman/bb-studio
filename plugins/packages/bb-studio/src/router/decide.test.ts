import { describe, expect, it, vi } from "vitest";
import type { Policy } from "./contract";
import { chooseRule, type RouterDecisions } from "./decide";

const policy: Policy = {
  enabled: true,
  autoDefault: false,
  rules: [
    { id: "visual", text: "Design, front end", chain: [{ providerId: "claude-code", model: "opus", reasoningLevel: null }] },
    { id: "coding", text: "Pure coding", chain: [{ providerId: "acp-opencode", model: "glm", reasoningLevel: null }] },
  ],
  defaultChain: [{ providerId: "codex", model: "gpt", reasoningLevel: null }],
};

const never = <T,>() => new Promise<T>(() => undefined);
type Complete = NonNullable<RouterDecisions["completeText"]>;

function decisions(overrides: { systemOne?: RouterDecisions["systemOne"]; completeText?: Complete | null } = {}): RouterDecisions & { calls: string[] } {
  const calls: string[] = [];
  const completeText: Complete = vi.fn(async (input: { prompt: string; timeoutMs: number }) => {
    calls.push(`complete:${input.timeoutMs > 0}`);
    return { ok: true as const, text: "coding" };
  });
  return {
    calls,
    systemOne: overrides.systemOne ?? vi.fn(async (input) => {
      calls.push(`jev:${input.caller}`);
      return { ok: true as const, answers: { rule: { type: "choice", choice: "visual", confidence: 0.9, probabilities: {} } }, via: "TypeSafe", ms: 5 };
    }),
    completeText: overrides.completeText === undefined ? completeText : overrides.completeText,
  };
}

const input = { policy, text: "Restyle the settings page" };
const budget = { jevMs: 300, totalMs: 1_500 };
const jevDown: RouterDecisions["systemOne"] = async () => ({ ok: false, unavailable: true, error: "No Jev provider" });

describe("choosing a rule", () => {
  it("uses Jev's answer", async () => {
    const asks = decisions();
    expect(await chooseRule(asks, input, budget)).toMatchObject({ ruleId: "visual", source: "jev", confidence: 0.9 });
    expect(asks.calls).toEqual(["jev:studio-router"]);
  });

  it("takes Jev's default as the default chain without a second ask", async () => {
    const asks = decisions({ systemOne: async () => ({ ok: true, answers: { rule: { type: "choice", choice: "default", confidence: 0.7, probabilities: {} } }, via: "TypeSafe", ms: 3 }) });
    expect(await chooseRule(asks, input, budget)).toMatchObject({ ruleId: null, source: "jev" });
    expect(asks.calls).toEqual([]);
  });

  it("asks the tool-less title model when Jev is unavailable, unsure or malformed", async () => {
    for (const systemOne of [
      jevDown,
      async () => ({ ok: true as const, answers: { rule: { type: "choice", choice: "visual", confidence: 0.2, probabilities: {} } }, via: "x", ms: 1 }),
      async () => ({ ok: true as const, answers: { rule: { type: "choice", choice: "nope", confidence: 0.9, probabilities: {} } }, via: "x", ms: 1 }),
      async () => { throw new Error("boom"); },
    ] as RouterDecisions["systemOne"][]) {
      const asks = decisions({ systemOne });
      expect(await chooseRule(asks, input, budget)).toMatchObject({ ruleId: "coding", source: "model" });
      expect(asks.calls).toEqual(["complete:true"]);
    }
  });

  it("stops waiting for Jev at its budget, aborts it and drops a late answer", async () => {
    let signal: AbortSignal | null = null;
    const asks = decisions({ systemOne: (_input, abort) => { signal = abort; return never(); } });
    const started = Date.now();
    expect(await chooseRule(asks, input, budget)).toMatchObject({ ruleId: "coding", source: "model" });
    expect(signal!.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("falls back to the default chain when neither answers within the total budget", async () => {
    let completeSignal: AbortSignal | null = null;
    const asks = decisions({ systemOne: () => never(), completeText: (_input, abort) => { completeSignal = abort; return never(); } });
    const started = Date.now();
    expect(await chooseRule(asks, input, budget)).toMatchObject({ ruleId: null, source: "default" });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(completeSignal!.aborted).toBe(true);
  });

  it("uses the default chain when the title model names no rule, or this BB has no tool-less call", async () => {
    const unsure = decisions({ systemOne: jevDown, completeText: async () => ({ ok: true, text: "not sure" }) });
    expect(await chooseRule(unsure, input, budget)).toMatchObject({ ruleId: null, source: "default" });
    const none = decisions({ systemOne: jevDown, completeText: null });
    expect(await chooseRule(none, input, budget)).toMatchObject({ source: "default" });
  });

  it("asks nobody when there are no rules or no text", async () => {
    const asks = decisions();
    expect(await chooseRule(asks, { ...input, policy: { ...policy, rules: [] } }, budget)).toMatchObject({ ruleId: null, source: "no-rules" });
    expect(await chooseRule(asks, { ...input, text: "  " }, budget)).toMatchObject({ source: "no-rules" });
    expect(asks.calls).toEqual([]);
  });
});
