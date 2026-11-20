import { describe, expect, it } from "vitest";
import { policySchema, type Policy, type Target } from "./contract";
import { chainFor, firstAvailable, MIN_RULE_CONFIDENCE, modelPrompt, narrowPermission, noticeText, readFailure, ruleForTarget, ruleFromJev, ruleFromModel, ruleQuestion, ruleState, targetName } from "./select";

const opus: Target = { providerId: "claude-code", model: "claude-opus-5-5", reasoningLevel: "high", label: "Opus 5.5" };
const sonnet: Target = { providerId: "claude-code", model: "claude-sonnet-5-5", reasoningLevel: null, label: "Sonnet 5.5" };
const glm: Target = { providerId: "acp-opencode", model: "zai/glm-5.3", reasoningLevel: null, label: "GLM 5.3" };
const codex: Target = { providerId: "codex", model: "gpt-5.5-codex", reasoningLevel: "medium", label: "GPT-5.5 Codex" };

const policy: Policy = {
  enabled: true,
  autoDefault: false,
  rules: [
    { id: "visual", text: "Design, front end, anything strongly visual", chain: [opus, codex] },
    { id: "coding", text: "Pure coding", chain: [glm, codex] },
  ],
  defaultChain: [sonnet, codex],
};

describe("the policy", () => {
  it("accepts rules with chains and refuses Auto as a target, a reserved id and duplicate ids", () => {
    expect(policySchema.parse(policy)).toEqual(policy);
    expect(policySchema.safeParse({ ...policy, defaultChain: [{ providerId: "auto", model: "auto" }] }).success).toBe(false);
    expect(policySchema.safeParse({ ...policy, rules: [{ id: "default", text: "x", chain: [opus] }] }).success).toBe(false);
    expect(policySchema.safeParse({ ...policy, rules: [policy.rules[0], policy.rules[0]] }).success).toBe(false);
    expect(policySchema.safeParse({ ...policy, rules: [{ id: "empty", text: "x", chain: [] }] }).success).toBe(false);
  });
});

describe("asking Jev", () => {
  it("offers each rule's own words and a default option, and sends the task as data", () => {
    const question = ruleQuestion(policy);
    expect(question.type).toBe("choice");
    expect(question.criteria).toEqual({ visual: "Design, front end, anything strongly visual", coding: "Pure coding", default: "No rule clearly fits this task." });
    expect(question.instructions).toMatch(/as data/u);
    expect(ruleState(policy, "x".repeat(30_000)).task).toHaveLength(20_000);
  });

  it("takes a known rule at or above the threshold, default as no rule, and nothing else", () => {
    const choice = (choiceId: string, confidence: number) => ({ type: "choice", choice: choiceId, confidence, probabilities: {} });
    expect(ruleFromJev(policy, choice("visual", 0.9))).toEqual({ ruleId: "visual", confidence: 0.9 });
    expect(ruleFromJev(policy, choice("default", 0.2))).toEqual({ ruleId: null, confidence: 0.2 });
    expect(ruleFromJev(policy, choice("visual", MIN_RULE_CONFIDENCE - 0.01))).toBeUndefined();
    expect(ruleFromJev(policy, choice("unknown", 0.99))).toBeUndefined();
    expect(ruleFromJev(policy, choice("visual", 1.5))).toBeUndefined();
    expect(ruleFromJev(policy, { type: "noul", noul: 0.9 })).toBeUndefined();
    expect(ruleFromJev(policy, undefined)).toBeUndefined();
  });
});

describe("asking the fallback model", () => {
  it("lists the rules by id and reads the first id in the reply", () => {
    const prompt = modelPrompt(policy, "Restyle the login page");
    expect(prompt).toContain("- visual: Design, front end, anything strongly visual");
    expect(prompt).toContain("<task>\nRestyle the login page\n</task>");
    expect(ruleFromModel(policy, "visual")).toEqual({ ruleId: "visual", confidence: null });
    expect(ruleFromModel(policy, "The answer is: Coding.")).toEqual({ ruleId: "coding", confidence: null });
    expect(ruleFromModel(policy, "default")).toEqual({ ruleId: null, confidence: null });
    expect(ruleFromModel(policy, "no idea")).toBeUndefined();
    expect(ruleFromModel(policy, null)).toBeUndefined();
  });
});

describe("chains", () => {
  it("follows the rule's chain, then the default chain, each model once", () => {
    expect(chainFor(policy, "visual")).toEqual([opus, codex, sonnet]);
    expect(chainFor(policy, null)).toEqual([sonnet, codex]);
    expect(chainFor(policy, "gone")).toEqual([sonnet, codex]);
  });

  it("finds the rule a model belongs to, by model and then by provider", () => {
    expect(ruleForTarget(policy, glm)?.id).toBe("coding");
    expect(ruleForTarget(policy, { providerId: "claude-code", model: "claude-opus-5-5" })?.id).toBe("visual");
    expect(ruleForTarget(policy, { providerId: "claude-code", model: "something-else" })?.id).toBe("visual");
    expect(ruleForTarget(policy, { providerId: "pi", model: "x" })).toBeNull();
  });

  it("picks the first available target and says why it skipped the others", () => {
    const why = (target: Target) => (target.providerId === "claude-code" ? "usage limit" : target.providerId === "acp-opencode" ? "not set up" : null);
    expect(firstAvailable([opus, glm, codex, sonnet], why)).toEqual({
      target: codex,
      skipped: [{ target: opus, why: "usage limit" }, { target: glm, why: "not set up" }],
    });
    expect(firstAvailable([opus, sonnet], why).target).toBeNull();
  });
});

describe("reading a failed turn", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0);
  const failed = (category: string, extra: Partial<{ providerCode: string; httpStatusCode: number }> = {}, rateLimits: Parameters<typeof readFailure>[0]["rateLimits"] = null) =>
    readFailure({ errorInfo: { category, providerCode: extra.providerCode ?? null, httpStatusCode: extra.httpStatusCode ?? null }, rateLimits }, now, "UTC");

  it("reads a Claude usage window with its reset", () => {
    const reset = Date.UTC(2026, 10, 23, 9, 0);
    expect(failed("rate-limit", { providerCode: "rate_limit", httpStatusCode: 429 }, { status: "blocked", kind: "subscription-window", windows: [{ label: "weekly", status: "blocked", resetsAtMs: reset }] }))
      .toEqual({ kind: "usage-limit", reason: "usage limit until 23 Nov, 09:00", until: reset });
  });

  it("reads Codex usage and rate limits, credits and spend caps", () => {
    expect(failed("rate-limit", { providerCode: "usageLimitExceeded" })).toMatchObject({ kind: "usage-limit", reason: "usage limit exceeded" });
    expect(failed("rate-limit", { providerCode: "rateLimitExceeded" })).toMatchObject({ kind: "usage-limit", reason: "rate limit" });
    expect(failed("rate-limit", {}, { status: "blocked", kind: "credits", windows: [] })).toMatchObject({ reason: "out of credits" });
    expect(failed("rate-limit", {}, { status: "blocked", kind: "spend-control", windows: [] })).toMatchObject({ reason: "spend limit reached" });
    expect(failed("rate-limit", {}, { status: "blocked", kind: "unknown", windows: [] })).toMatchObject({ reason: "usage limit, reset unknown", until: now + 15 * 60_000 });
  });

  it("reads a bare 429, a door rejection and a billing error", () => {
    expect(failed("rate-limit", { httpStatusCode: 429 })).toEqual({ kind: "usage-limit", reason: "429 rate limit", until: now + 15 * 60_000 });
    expect(failed("rate-limit")).toMatchObject({ reason: "rate limit" });
    expect(failed("billing", { providerCode: "billing_error", httpStatusCode: 402 })).toEqual({ kind: "usage-limit", reason: "billing limit", until: now + 15 * 60_000 });
  });

  it("reads a sign-in failure", () => {
    expect(failed("unauthorized", { httpStatusCode: 401 })).toMatchObject({ kind: "sign-in", reason: "sign-in failed (401)" });
    expect(failed("unauthorized", { providerCode: "oauth_org_not_allowed", httpStatusCode: 403 })).toMatchObject({ kind: "sign-in", reason: "organization not allowed (403)" });
  });

  it("leaves everything else alone, including a warning window and no classification", () => {
    for (const category of ["overloaded", "bad-request", "context-window-exceeded", "internal", "connection-failed", "max-turns", "policy", "unknown", "too-many-failed-attempts"]) {
      expect(failed(category, { httpStatusCode: 500 })).toBeNull();
    }
    expect(readFailure({ errorInfo: null, rateLimits: { status: "blocked", kind: "subscription-window", windows: [] } }, now)).toBeNull();
  });
});

describe("the notice", () => {
  it("names the provider, the reason and the model it would hand off to", () => {
    expect(noticeText({ kind: "usage-limit", providerName: "Claude Code", reason: "429 rate limit", targetName: "GLM 5.3" }))
      .toBe("The auto router detected a usage limit on Claude Code (429 rate limit). Hand off to GLM 5.3?");
    expect(noticeText({ kind: "sign-in", providerName: "Codex", reason: "sign-in failed (401)", targetName: "Opus 5.5" }))
      .toBe("The auto router detected a sign-in failure on Codex (sign-in failed (401)). Hand off to Opus 5.5?");
    expect(noticeText({ kind: "usage-limit", providerName: "Codex", reason: "rate limit", targetName: null }))
      .toBe("The auto router detected a usage limit on Codex (rate limit). No other model in its chain is available.");
  });

  it("names a model by its label, with the provider when the label doesn't say it", () => {
    expect(targetName(glm, "opencode")).toBe("GLM 5.3 (opencode)");
    expect(targetName({ ...codex, label: undefined }, null)).toBe("gpt-5.5-codex");
    expect(targetName({ ...opus, label: "Claude Code Opus" }, "Claude Code")).toBe("Claude Code Opus");
  });
});

describe("permission modes", () => {
  it("keeps a supported mode and otherwise takes the widest one not above it, never wider", () => {
    expect(narrowPermission("auto", ["auto", "full"])).toBe("auto");
    expect(narrowPermission("auto", ["accept-edits", "full"])).toBe("accept-edits");
    expect(narrowPermission("full", ["accept-edits", "auto"])).toBe("auto");
    expect(narrowPermission("accept-edits", ["auto", "full"])).toBeNull();
    expect(narrowPermission("something-new", ["full"])).toBeNull();
  });
});

it("writes a reset in the person's time zone", () => {
  const reset = Date.UTC(2026, 10, 23, 9, 0);
  expect(readFailure({ errorInfo: { category: "rate-limit", providerCode: null, httpStatusCode: null }, rateLimits: { status: "blocked", kind: "subscription-window", windows: [{ label: null, status: "blocked", resetsAtMs: reset }] } }, 0, "America/New_York")?.reason).toBe("usage limit until 23 Nov, 04:00");
});
