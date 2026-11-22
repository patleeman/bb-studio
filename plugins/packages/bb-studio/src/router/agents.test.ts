// Phase 2: Pi and other ACP agents as Auto targets, their errors raising the
// usage-limit notice, handing off to and from them, and Lean tools on a local
// model. Pi's errors are stubbed with the shapes its provider reports.
import { describe, expect, it, vi } from "vitest";
import { leanFor } from "../context-lean";
import type { Policy, Target } from "./contract";
import type { RouterDecisions } from "./decide";
import { errorEventText } from "./register";
import { handoffRequest, ModelRouter, POLICY_KEY, UNREACHABLE_MS, type FailedTurnEvent, type RouterDeps, type RouterThread } from "./router";
import { agentResetAt, firstAvailable, formatReset, readAgentError, readFailure, UNSURE_PASSED, UNSURE_PICKED, usageProblem, type UsageSnapshot } from "./select";

const now = Date.UTC(2026, 10, 21, 12, 0);

const glm: Target = { providerId: "acp-opencode", model: "zai/glm-5.3", reasoningLevel: null, label: "GLM 5.3" };
const qwenLocal: Target = { providerId: "acp-opencode", model: "ollama/qwen3:8b", reasoningLevel: null, label: "Qwen3 8B (local)" };
const gemini: Target = { providerId: "acp-antigravity", model: "gemini-3-pro", reasoningLevel: null, label: "Gemini 3 Pro" };
const piSonnet: Target = { providerId: "pi", model: "anthropic/claude-sonnet-5-5", reasoningLevel: null, label: "Sonnet 5.5 (Pi)" };
const codex: Target = { providerId: "codex", model: "gpt-5.5-codex", reasoningLevel: "medium", label: "GPT-5.5 Codex" };

const policy: Policy = {
  enabled: true,
  autoDefault: false,
  rules: [
    { id: "coding", text: "Pure coding", chain: [glm, gemini, piSonnet, codex] },
    { id: "private", text: "Anything with private data", chain: [qwenLocal, codex] },
  ],
  defaultChain: [piSonnet, codex],
};

/** No rule names Pi: its failure continues along the default chain, Pi then Codex. */
const piPolicy: Policy = { ...policy, rules: [], defaultChain: [piSonnet, codex] };

interface Options {
  rule?: string;
  states?: Record<string, string>;
  catalogs?: Record<string, string[] | null>;
  usage?: Record<string, UsageSnapshot | null>;
  thread?: Partial<RouterThread>;
  execution?: { model: string | null; permissionMode: string | null };
  errorText?: string | null;
  lean?: boolean;
}

const modes: Record<string, string[]> = { "acp-opencode": ["accept-edits", "full"], "acp-antigravity": ["accept-edits", "full"], pi: ["full"], codex: ["accept-edits", "auto", "full"] };
const names: Record<string, string> = { "acp-opencode": "OpenCode", "acp-antigravity": "Antigravity", pi: "Pi", codex: "Codex" };

function harness(options: Options = {}) {
  const store = new Map<string, unknown>([[POLICY_KEY, policy]]);
  const spawned: Record<string, unknown>[] = [];
  const thread: RouterThread = { id: "thr_1", projectId: "prj_1", providerId: "acp-opencode", environmentId: "env_1", title: "Parser", status: "error", visibility: "visible", ...options.thread };
  const decisions: RouterDecisions = {
    systemOne: vi.fn(async () => ({ ok: true as const, answers: { rule: { type: "choice", choice: options.rule ?? "coding", confidence: 0.9 } }, via: "test", ms: 1 })),
    completeText: null,
  };
  const catalogs = options.catalogs ?? { "acp-opencode": [glm.model, qwenLocal.model], "acp-antigravity": [gemini.model], pi: [piSonnet.model], codex: [codex.model] };
  const errorText = vi.fn(async () => options.errorText ?? null);
  const deps: RouterDeps = {
    kv: { get: async (key) => store.get(key), set: async (key, value) => { store.set(key, value); }, delete: async (key) => { store.delete(key); } },
    providerStates: async () => Object.entries(options.states ?? { "acp-opencode": "ready", "acp-antigravity": "ready", pi: "ready", codex: "ready" }).map(([providerId, status]) => ({ providerId, status })),
    providers: async () => new Map(Object.keys(modes).map((id) => [id, { name: names[id]!, permissionModes: modes[id]! }] as const)),
    models: async (providerId) => {
      const list = catalogs[providerId];
      return list === null || list === undefined ? null : new Set(list);
    },
    thread: async (threadId) => (threadId === thread.id ? thread : null),
    execution: async () => ({ reasoningLevel: null, ...(options.execution ?? { model: glm.model, permissionMode: "full" }) }),
    spawn: async (request) => { spawned.push(request); return { id: "thr_new" }; },
    cancelRetries: async () => 0,
    changed: () => undefined,
    decisions,
    errorText,
    usage: async (providerId) => options.usage?.[providerId] ?? null,
    lean: (providerId, model) => leanFor({}, providerId, model),
    appHandlesSignIn: true,
    log: { info: () => undefined, warn: () => undefined },
    now: () => now,
  };
  const router = new ModelRouter(deps);
  return { router, store, spawned, thread, errorText };
}

const failed = (errorInfo: FailedTurnEvent["errorInfo"] = null, rateLimits: FailedTurnEvent["rateLimits"] = null): FailedTurnEvent => ({ threadId: "thr_1", requestId: "req_1", errorInfo, rateLimits });

describe("ACP and Pi error words", () => {
  const kind = (text: string) => {
    const reading = readAgentError(text, now);
    return reading ? readFailure(reading, now, "UTC") : null;
  };

  it("reads rate and usage limits from Gemini, Antigravity, OpenCode and Claude agents", () => {
    expect(kind('{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}')).toMatchObject({ kind: "usage-limit", reason: "usage limit, reset unknown" });
    expect(kind("You have exhausted your capacity on this model. Your quota will reset after 3h12m.")).toMatchObject({ kind: "usage-limit", until: now + (3 * 60 + 12) * 60_000 });
    expect(kind("Quota exceeded for quota metric 'Gemini 3 Pro Requests' and limit 'Requests per day'")).toMatchObject({ kind: "usage-limit" });
    expect(kind("API Error: 429 {\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\"}}")?.kind).toBe("usage-limit");
    expect(kind("Too Many Requests, try again in 45 minutes")).toMatchObject({ kind: "usage-limit", until: now + 45 * 60_000 });
    expect(kind("Claude usage limit reached. Your limit will reset at 2026-11-21T17:00:00Z")).toMatchObject({ kind: "usage-limit", reason: "usage limit until 21 Nov, 17:00", until: Date.UTC(2026, 10, 21, 17) });
  });

  it("reads credits and billing as usage limits", () => {
    expect(kind("402 Payment Required: This request requires more credits")).toMatchObject({ kind: "usage-limit", reason: "billing limit" });
    expect(kind("OpenRouter: Insufficient credits. Add more using https://openrouter.ai/credits")).toMatchObject({ kind: "usage-limit", reason: "out of credits" });
    expect(kind("You exceeded your current quota, please check your plan and billing details. code: insufficient_quota")).toMatchObject({ kind: "usage-limit", reason: "billing limit" });
  });

  it("reads a sign-in failure, and leaves a full context, a crash and plain failures alone", () => {
    expect(kind("Authentication required")).toMatchObject({ kind: "sign-in" });
    expect(kind("Error: not logged in. Please run `agy login`.")).toMatchObject({ kind: "sign-in" });
    expect(kind("prompt is too long: 210000 tokens > 200000 maximum")).toBeNull();
    expect(kind("Internal error (-32603)")).toBeNull();
    expect(kind("The tool failed: file not found")).toBeNull();
    expect(readAgentError("", now)).toBeNull();
    expect(readAgentError(null, now)).toBeNull();
  });

  it("reads a local model server that isn't running as a connection failure", () => {
    expect(readAgentError("connect ECONNREFUSED 127.0.0.1:11434", now)?.errorInfo.category).toBe("connection-failed");
    expect(readAgentError("fetch failed", now)?.errorInfo.category).toBe("connection-failed");
  });

  it("reads reset times in the shapes agents write them", () => {
    expect(agentResetAt('"retryDelay": "30s"', now)).toBe(now + 30_000);
    expect(agentResetAt("Please retry after 2 hours 5 minutes", now)).toBe(now + 125 * 60_000);
    expect(agentResetAt("rate limited", now)).toBeNull();
  });

  it("takes the text of the latest provider/error event, detail first", () => {
    expect(errorEventText([{ type: "provider/error", data: { message: "Provider error", detail: "429 Too Many Requests" } }])).toBe("429 Too Many Requests\nProvider error");
    expect(errorEventText([])).toBeNull();
  });
});

describe("usage snapshots", () => {
  it("rules out a signed-out agent, one out of credit and a used-up window, and nothing else", () => {
    expect(usageProblem({ status: "unauthenticated" }, now)).toBe("signed out");
    expect(usageProblem({ status: "ok", windows: [{ label: "Credits", usedPercent: 100, resetsAt: null, cost: { usedUsdCents: 2000, limitUsdCents: 2000 } }] }, now)).toBe("out of credit");
    expect(usageProblem({ status: "ok", windows: [{ label: "Day", usedPercent: 100, resetsAt: "2026-11-22T00:00:00Z" }] }, now, "UTC")).toBe("usage limit until 22 Nov, 00:00");
    expect(usageProblem({ status: "ok", windows: [{ label: "Day", usedPercent: 100, resetsAt: "2026-11-21T11:00:00Z" }] }, now)).toBeNull();
    expect(usageProblem({ status: "ok", windows: [{ label: "Day", usedPercent: 80, resetsAt: null }] }, now)).toBeNull();
    expect(usageProblem({ status: "error" }, now)).toBeNull();
    expect(usageProblem(null, now)).toBeNull();
  });
});

describe("ready models before ones whose readiness is unknown", () => {
  const unsure = (target: Target) => (target.providerId === "acp-antigravity" ? "readiness unknown" : null);
  it("passes an unknown one while a ready one is left, and says so", () => {
    expect(firstAvailable([gemini, piSonnet], () => null, unsure)).toEqual({ target: piSonnet, skipped: [{ target: gemini, why: UNSURE_PASSED }] });
  });
  it("takes the unknown one, with a note, when nothing ready is left", () => {
    expect(firstAvailable([gemini, piSonnet], (target) => (target === piSonnet ? "signed out" : null), unsure)).toEqual({ target: gemini, skipped: [{ target: piSonnet, why: "signed out" }], note: UNSURE_PICKED });
  });
});

describe("Auto with Pi and ACP agents", () => {
  it("picks an ACP agent's model first in a rule's chain", async () => {
    const { router } = harness();
    await router.load();
    expect(await router.resolve({ text: "Fix tokenize()" })).toEqual(glm);
  });

  it("skips a signed-out, not installed, out-of-credit or unreachable agent", async () => {
    const signedOut = harness({ states: { "acp-opencode": "unauthenticated", "acp-antigravity": "not_installed", pi: "ready", codex: "ready" } });
    await signedOut.router.load();
    expect(await signedOut.router.decide("Fix tokenize()")).toMatchObject({ target: piSonnet, skipped: [{ target: glm, why: "unauthenticated" }, { target: gemini, why: "not installed" }] });

    const broke = harness({ usage: { "acp-opencode": { status: "ok", windows: [{ label: "Credits", usedPercent: 100, resetsAt: null, cost: { usedUsdCents: 500, limitUsdCents: 500 } }] } }, catalogs: { "acp-opencode": [glm.model], "acp-antigravity": null, pi: [piSonnet.model], codex: [codex.model] } });
    await broke.router.load();
    expect(await broke.router.decide("Fix tokenize()")).toMatchObject({ target: piSonnet, skipped: [{ target: glm, why: "out of credit" }, { target: gemini, why: "unreachable (its models can't be listed)" }] });
  });

  it("still trusts a catalog it can't read for Claude Code and Codex", async () => {
    const { router } = harness({ rule: "private", catalogs: { "acp-opencode": [glm.model], codex: null }, states: { "acp-opencode": "unauthenticated", codex: "ready" } });
    await router.load();
    expect((await router.decide("Summarize my notes")).target).toEqual(codex);
  });

  it("uses an agent whose readiness is unknown only after the ready ones, and says why", async () => {
    const { router } = harness({ states: { "acp-opencode": "unknown", "acp-antigravity": "ready", pi: "ready", codex: "ready" } });
    await router.load();
    const decision = await router.decide("Fix tokenize()");
    expect(decision).toMatchObject({ target: gemini, skipped: [{ target: glm, why: UNSURE_PASSED }] });
    expect(decision.note).toBeUndefined();
    const checks = await router.checkTargets();
    expect(checks.find((check) => check.model === glm.model)).toMatchObject({ problem: null, note: "Readiness unknown: used only when no ready model is left in the chain" });

    const only = harness({ states: { "acp-opencode": "unknown", "acp-antigravity": "unauthenticated", pi: "unauthenticated", codex: "unauthenticated" } });
    await only.router.load();
    expect(await only.router.decide("Fix tokenize()")).toMatchObject({ target: glm, note: UNSURE_PICKED });
  });

  it("never gives Pi more access than asked: accept-edits skips Pi, which runs only with full access", async () => {
    const { router } = harness({ rule: "none" });
    await router.load();
    expect(await router.decide("Hello", { permissionMode: "accept-edits" })).toMatchObject({ target: codex, skipped: [{ target: piSonnet, why: "no permission mode at or below accept-edits" }] });
  });
});

describe("Lean tools when Auto lands on a local model", () => {
  it("marks a local model of an ACP agent lean, and a cloud one not", async () => {
    const local = harness({ rule: "private" });
    await local.router.load();
    expect(await local.router.decide("My tax notes")).toMatchObject({ target: qwenLocal, lean: true });
    const cloud = harness();
    await cloud.router.load();
    expect((await cloud.router.decide("Fix tokenize()")).lean).toBeUndefined();
  });

  it("is the same rule the session uses (leanFor on the thread Auto creates)", () => {
    expect(leanFor({}, qwenLocal.providerId, qwenLocal.model)).toBe(true);
    expect(leanFor({}, glm.providerId, glm.model)).toBe(false);
    expect(leanFor({}, "acp-lmstudio", "acp-default")).toBe(true);
    expect(leanFor({ "acp-opencode": "full" }, qwenLocal.providerId, qwenLocal.model)).toBe(false);
  });
});

describe("the usage-limit notice for ACP and Pi", () => {
  it("reads an ACP agent's error words when BB has no classification, and offers the next model", async () => {
    const { router, errorText } = harness({ errorText: "429 Too Many Requests: rate limit for zai/glm-5.3" });
    await router.load();
    const notice = await router.onTurnFailed(failed());
    expect(errorText).toHaveBeenCalledWith("thr_1");
    expect(notice).toMatchObject({ kind: "usage-limit", failedProviderName: "OpenCode", reason: "usage limit, reset unknown", target: gemini, text: "The auto router detected a usage limit on OpenCode (usage limit, reset unknown). Hand off to Gemini 3 Pro (Antigravity)?" });
  });

  it("blocks only the failed model of an ACP agent: its local model stays available", async () => {
    const { router } = harness({ errorText: "Quota exceeded. Your quota will reset after 2h." });
    await router.load();
    await router.onTurnFailed(failed());
    const decision = await router.decide("Fix tokenize()");
    expect(decision.target).toEqual(gemini);
    expect(decision.skipped[0]).toMatchObject({ target: glm, why: `usage limit until ${formatReset(now + 2 * 3_600_000)}` });
    const local = harness({ rule: "private", errorText: "Quota exceeded" });
    await local.router.load();
    await local.router.onTurnFailed(failed());
    expect((await local.router.decide("My tax notes")).target).toEqual(qwenLocal);
  });

  it("can hand off to another model of the same ACP agent", async () => {
    const { router } = harness({ thread: { providerId: "acp-opencode" }, execution: { model: qwenLocal.model, permissionMode: "full" }, errorText: "rate limit" });
    await router.load();
    const notice = await router.onTurnFailed(failed());
    // qwenLocal's own rule is "private": its chain goes on to Codex, not back to the failed model.
    expect(notice?.target).toEqual(codex);
    const fromGlm = harness({ thread: { providerId: "acp-opencode" }, execution: { model: glm.model, permissionMode: "full" }, errorText: "rate limit" });
    await fromGlm.router.setPolicy({ ...policy, rules: [{ id: "coding", text: "Pure coding", chain: [glm, qwenLocal, codex] }] });
    expect((await fromGlm.router.onTurnFailed(failed()))?.target).toEqual(qwenLocal);
  });

  it("keeps BB's own classification when the agent gave one", async () => {
    const { router, errorText } = harness({ errorText: "rate limit" });
    await router.load();
    expect(await router.onTurnFailed(failed({ category: "overloaded", providerCode: null, httpStatusCode: 529 }))).toBeNull();
    expect(errorText).not.toHaveBeenCalled();
  });

  it("marks an unreachable local model so Auto keeps off it for a while, with no notice", async () => {
    const { router } = harness({ thread: { providerId: "acp-opencode" }, execution: { model: qwenLocal.model, permissionMode: "full" }, errorText: "connect ECONNREFUSED 127.0.0.1:11434", rule: "private" });
    await router.load();
    expect(await router.onTurnFailed(failed())).toBeNull();
    expect(await router.decide("My tax notes")).toMatchObject({ target: codex, skipped: [{ target: qwenLocal, why: "unreachable" }] });
    expect(UNREACHABLE_MS).toBe(5 * 60_000);
  });

  it("raises the notice on Pi's own rate-limit and billing classifications", async () => {
    // As Pi reports them (provider-pi piErrorInfo): a category and the HTTP status, no provider code, no windows.
    const pi = harness({ thread: { providerId: "pi" }, execution: { model: piSonnet.model, permissionMode: "full" }, rule: "none" });
    await pi.router.setPolicy(piPolicy);
    expect(await pi.router.onTurnFailed(failed({ category: "rate-limit", providerCode: null, httpStatusCode: 429 }))).toMatchObject({ failedProviderName: "Pi", reason: "429 rate limit", target: codex });
    expect(await pi.router.onTurnFailed(failed({ category: "billing", providerCode: null, httpStatusCode: 402 }))).toMatchObject({ reason: "billing limit", target: codex });
  });

  it("reads Pi's unclassified errors from their words", async () => {
    // Pi files an error with no status that its patterns don't know as "unknown".
    const pi = harness({ thread: { providerId: "pi" }, execution: { model: piSonnet.model, permissionMode: "full" }, rule: "none", errorText: "You have exhausted your capacity on this model. Your quota will reset after 1h." });
    await pi.router.setPolicy(piPolicy);
    expect(await pi.router.onTurnFailed(failed({ category: "unknown", providerCode: null, httpStatusCode: null }))).toMatchObject({ reason: `usage limit until ${formatReset(now + 3_600_000)}`, target: codex });
  });

  it("a sign-in failure of an ACP agent is the app's to show, and blocks the whole agent", async () => {
    const { router } = harness({ errorText: "Authentication required" });
    await router.load();
    expect(await router.onTurnFailed(failed())).toBeNull();
    expect((await router.decide("Fix tokenize()")).skipped.slice(0, 1)).toEqual([{ target: glm, why: "sign-in failed" }]);
    const local = harness({ rule: "private", errorText: "Authentication required" });
    await local.router.load();
    await local.router.onTurnFailed(failed());
    expect((await local.router.decide("My tax notes")).target).toEqual(codex);
  });
});

describe("Hand off to and from Pi and ACP agents", () => {
  it("from ACP: BB's handoff request on the notice's model", async () => {
    const { router, spawned } = harness({ errorText: "429" });
    await router.load();
    await router.onTurnFailed(failed());
    expect(await router.handoff("thr_1")).toMatchObject({ threadId: "thr_new", target: gemini });
    expect(spawned[0]).toMatchObject({ projectId: "prj_1", providerId: "acp-antigravity", model: "gemini-3-pro", permissionMode: "full", environment: { type: "reuse", environmentId: "env_1" } });
    expect((spawned[0]!.input as { text: string }[])[0]!.text).toBe("Continue from @thread:thr_1");
  });

  it("from Pi to Codex, keeping Pi's full access only because it was asked for", async () => {
    const { router, spawned } = harness({ thread: { providerId: "pi" }, execution: { model: piSonnet.model, permissionMode: "full" }, rule: "none" });
    await router.setPolicy(piPolicy);
    await router.onTurnFailed(failed({ category: "rate-limit", providerCode: null, httpStatusCode: 429 }));
    await router.handoff("thr_1");
    expect(spawned[0]).toMatchObject({ providerId: "codex", model: codex.model, permissionMode: "full" });
  });

  it("to an ACP agent from a thread on auto permissions: narrowed to accept-edits, never wider", () => {
    const thread: RouterThread = { id: "thr_c", projectId: "prj_1", providerId: "codex", environmentId: null, title: "T" };
    expect(handoffRequest(thread, glm, "accept-edits")).toMatchObject({ providerId: "acp-opencode", model: glm.model, permissionMode: "accept-edits", environment: { type: "project-default" } });
  });

  it("to Pi: refused when the thread asked for less than full access", async () => {
    const { router } = harness({ thread: { providerId: "codex" }, execution: { model: codex.model, permissionMode: "accept-edits" } });
    await router.setPolicy({ ...policy, rules: [{ id: "coding", text: "Pure coding", chain: [codex, piSonnet] }] });
    // The notice itself skips Pi under accept-edits, so it names no model.
    expect(await router.onTurnFailed(failed({ category: "rate-limit", providerCode: "rate_limit", httpStatusCode: 429 }))).toMatchObject({ target: null });
    await expect(router.handoff("thr_1")).rejects.toThrow("no router notice with a model");
  });
});
