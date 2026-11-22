// Phase 2: Pi and other ACP agents as Auto targets, their errors raising the
// usage-limit notice, handing off to and from them, and Lean tools on a local
// model. Pi's errors are stubbed with the shapes its provider reports.
import { describe, expect, it, vi } from "vitest";
import { leanFor } from "../context-lean";
import type { Policy, Target } from "./contract";
import type { RouterDecisions } from "./decide";
import { errorEventText, labelled } from "./register";
import { effectivePermission, handoffRequest, ModelRouter, noticeKey, POLICY_KEY, UNREACHABLE_MS, type FailedTurnEvent, type RouterDeps, type RouterThread } from "./router";
import { agentResetAt, firstAvailable, formatReset, readAgentErrorText, readAgentError, readFailure, UNSURE_PASSED, UNSURE_PICKED, usageProblem, type UsageSnapshot } from "./select";

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
  catalogs?: Record<string, string[] | null | { error: string }>;
  /** Execution options by thread id (a parent thread), beside `execution` for the failed thread. */
  executions?: Record<string, { model: string | null; permissionMode: string | null }>;
  primaryHost?: string;
  /** BB's provider list fails (a plugin reload, a host hiccup). */
  providersFail?: boolean;
  threadHost?: string;
  usage?: Record<string, UsageSnapshot | null>;
  thread?: Partial<RouterThread>;
  execution?: { model: string | null; permissionMode: string | null };
  errorText?: string | null;
  lean?: boolean;
}

const modes: Record<string, string[]> = { "acp-opencode": ["accept-edits", "full"], "acp-antigravity": ["accept-edits", "full"], pi: ["full"], codex: ["accept-edits", "auto", "full"] };
const names: Record<string, string> = { "acp-opencode": "OpenCode", "acp-antigravity": "Antigravity", pi: "Pi", codex: "Codex" };

const clock = { now };

function harness(options: Options = {}) {
  clock.now = now;
  const store = new Map<string, unknown>([[POLICY_KEY, policy]]);
  const spawned: Record<string, unknown>[] = [];
  const thread: RouterThread = { id: "thr_1", projectId: "prj_1", providerId: "acp-opencode", environmentId: "env_1", title: "Parser", status: "error", visibility: "visible", ...options.thread };
  const decisions: RouterDecisions = {
    systemOne: vi.fn(async () => ({ ok: true as const, answers: { rule: { type: "choice", choice: options.rule ?? "coding", confidence: 0.9 } }, via: "test", ms: 1 })),
    completeText: null,
  };
  const catalogs = options.catalogs ?? { "acp-opencode": [glm.model, qwenLocal.model], "acp-antigravity": [gemini.model], pi: [piSonnet.model], codex: [codex.model] };
  // ACP's provider/error: BB's generic message, the agent's words in the detail.
  const errorText = vi.fn(async (_threadId: string, _turnId: string) => (options.errorText ? { message: "Provider error", detail: options.errorText } : null));
  const deps: RouterDeps = {
    kv: { get: async (key) => store.get(key), set: async (key, value) => { store.set(key, value); }, delete: async (key) => { store.delete(key); } },
    providerStates: async () => Object.entries(options.states ?? { "acp-opencode": "ready", "acp-antigravity": "ready", pi: "ready", codex: "ready" }).map(([providerId, status]) => ({ providerId, status })),
    providers: async () => {
      if (options.providersFail) throw new Error("providers unavailable");
      return new Map(Object.keys(modes).map((id) => [id, { name: names[id]!, permissionModes: modes[id]! }] as const));
    },
    models: async (providerId) => {
      const list = catalogs[providerId];
      if (list === null || list === undefined) return null;
      return Array.isArray(list) ? new Set(list) : list;
    },
    primaryHostId: async () => options.primaryHost ?? "host_mac",
    threadHost: async () => options.threadHost ?? "host_mac",
    thread: async (threadId) => (threadId === thread.id ? thread : null),
    execution: async (threadId) => ({ reasoningLevel: null, ...(options.executions?.[threadId] ?? options.execution ?? { model: glm.model, permissionMode: "full" }) }),
    spawn: async (request) => { spawned.push(request); return { id: "thr_new" }; },
    cancelRetries: async () => 0,
    changed: () => undefined,
    decisions,
    errorText,
    usage: async (providerId) => options.usage?.[providerId] ?? null,
    lean: (providerId, model) => leanFor({}, providerId, model),
    appHandlesSignIn: true,
    log: { info: () => undefined, warn: () => undefined },
    now: () => clock.now,
  };
  const router = new ModelRouter(deps);
  return { router, store, spawned, thread, errorText };
}

const failed = (errorInfo: FailedTurnEvent["errorInfo"] = null, rateLimits: FailedTurnEvent["rateLimits"] = null): FailedTurnEvent => ({ threadId: "thr_1", requestId: "req_1", turnId: "turn_9", errorInfo, rateLimits });

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

  it("takes only the failed turn's own provider/error, and none the provider is retrying", () => {
    const row = (turnId: string, data: Record<string, unknown>) => ({ type: "provider/error", scope: { kind: "turn", turnId }, data });
    const rows = [row("turn_9", { message: "Provider error", detail: "429 later, retrying", willRetry: true }), row("turn_9", { message: "Provider error", detail: "429 Too Many Requests" }), row("turn_3", { message: "rate limit" })];
    expect(errorEventText(rows, "turn_9")).toEqual({ message: "Provider error", detail: "429 Too Many Requests" });
    // An earlier turn's 429 says nothing about this failure.
    expect(errorEventText([row("turn_3", { message: "Provider error", detail: "429 rate limit" })], "turn_9")).toBeNull();
    expect(errorEventText([], "turn_9")).toBeNull();
  });
});

describe("usage snapshots", () => {
  it("rules out a provider out of credit or with a used-up window, and nothing else", () => {
    // Sign-in is readiness's to say: OpenCode without a Go key and Claude Code on an API key read "unauthenticated" here.
    expect(usageProblem({ status: "unauthenticated" }, now)).toBeNull();
    expect(usageProblem({ status: "expired" }, now)).toBeNull();
    expect(usageProblem({ status: "ok", windows: [{ label: "Credits", usedPercent: 100, resetsAt: null, cost: { usedUsdCents: 2000, limitUsdCents: 2000 } }] }, now)).toBe("out of credit");
    expect(usageProblem({ status: "ok", windows: [{ label: "Day", usedPercent: 100, resetsAt: "2026-11-22T00:00:00Z" }] }, now, "UTC")).toBe("usage limit until 22 Nov, 00:00");
    expect(usageProblem({ status: "ok", windows: [{ label: "Day", usedPercent: 100, resetsAt: "2026-11-21T11:00:00Z" }] }, now)).toBeNull();
    expect(usageProblem({ status: "ok", windows: [{ label: "Day", usedPercent: 80, resetsAt: null }] }, now)).toBeNull();
    expect(usageProblem({ status: "error" }, now)).toBeNull();
    expect(usageProblem(null, now)).toBeNull();
  });

  it("doesn't apply a Pi or ACP agent's plan window to all its models", () => {
    const full = { status: "ok", windows: [{ label: "Go weekly", usedPercent: 100, resetsAt: "2026-11-22T00:00:00Z" }] };
    expect(usageProblem(full, now, "UTC", "acp-opencode")).toBeNull();
    expect(usageProblem(full, now, "UTC", "pi")).toBeNull();
    expect(usageProblem(full, now, "UTC", "codex")).toBe("usage limit until 22 Nov, 00:00");
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
    expect(await router.resolve({ text: "Fix tokenize()", permissionMode: "full" })).toEqual(glm);
  });

  it("skips a signed-out or not installed agent, and one that can't start", async () => {
    const signedOut = harness({ states: { "acp-opencode": "unauthenticated", "acp-antigravity": "not_installed", pi: "ready", codex: "ready" } });
    await signedOut.router.load();
    expect(await signedOut.router.decide("Fix tokenize()")).toMatchObject({ target: piSonnet, skipped: [{ target: glm, why: "unauthenticated" }, { target: gemini, why: "not installed" }] });

    const broke = harness({ catalogs: { "acp-opencode": [glm.model], "acp-antigravity": { error: "provider_unavailable: spawn agy ENOENT" }, pi: [piSonnet.model], codex: [codex.model] } });
    await broke.router.load();
    expect(await broke.router.decide("Fix tokenize()")).toMatchObject({ target: glm });
    expect((await broke.router.checkTargets()).find((check) => check.providerId === "acp-antigravity")).toMatchObject({ problem: "unreachable (its models can't be listed)" });
  });

  it("calls an agent unreachable only after its catalog fails twice, and trusts it again once it answers", async () => {
    const catalogs: Record<string, string[] | null | { error: string }> = { "acp-opencode": [glm.model], "acp-antigravity": { error: "timeout" }, pi: [piSonnet.model], codex: [codex.model] };
    const { router } = harness({ catalogs });
    await router.load();
    const gem = async () => (await router.checkTargets()).find((check) => check.providerId === "acp-antigravity")!.problem;
    // A cold start can time out once.
    expect(await gem()).toBeNull();
    clock.now += 20_000;
    expect(await gem()).toBe("unreachable (its models can't be listed)");
    catalogs["acp-antigravity"] = [gemini.model];
    clock.now += 20_000;
    expect(await gem()).toBeNull();
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
    expect(errorText).toHaveBeenCalledWith("thr_1", "turn_9");
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
    const { router, spawned } = harness({ errorText: "429 Too Many Requests" });
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

const unlabelled = ({ label: _label, ...target }: Target): Target => target;

it("saves a chain naming an agent that isn't installed: no catalog, so no label (an RPC result can't carry undefined)", async () => {
  const bb = { sdk: { providers: { models: async ({ providerId }: { providerId: string }) => {
    if (providerId === "acp-antigravity") throw new Error("not installed");
    return { models: [{ model: glm.model, displayName: "GLM-5.3" }], selectedOnlyModels: [] };
  } } } } as never;
  const saved = await labelled(bb, { ...policy, rules: [{ id: "coding", text: "Pure coding", chain: [unlabelled(gemini), unlabelled(glm)] }], defaultChain: [] });
  expect(saved.rules[0]!.chain[0]).not.toHaveProperty("label");
  expect(saved.rules[0]!.chain[1]).toMatchObject({ label: "GLM-5.3" });
  expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
});

describe("review fixes: words that are not limits or sign-in", () => {
  it("reads none of these as a usage limit or a sign-in failure", () => {
    for (const text of [
      "Max turns limit reached",
      "Tool call limit reached (25)",
      "Recursion limit reached",
      "Token limit exceeded for this request",
      "The model's output token limit exceeded",
      "Agent exited with code 1\n429 tests passed",
      "done\n401 lines of output truncated",
      "MCP server unauthorized",
      "Unauthorized tool call: permission denied",
    ]) {
      const reading = readAgentError(text, now);
      expect([text, reading?.errorInfo.category ?? null]).toEqual([text, null]);
    }
  });

  it("still reads real ones", () => {
    expect(readAgentError("Error: 401 Unauthorized", now)?.errorInfo.category).toBe("unauthorized");
    expect(readAgentError("Invalid API key provided", now)?.errorInfo.category).toBe("unauthorized");
    expect(readAgentError("Daily request limit reached", now)?.errorInfo.category).toBe("rate-limit");
    expect(readAgentError("Rate limit exceeded", now)?.errorInfo.category).toBe("rate-limit");
    expect(readAgentError("HTTP 429", now)?.errorInfo.category).toBe("rate-limit");
  });

  it("reads the message first, and only the detail's first line", () => {
    expect(readAgentErrorText({ message: "Rate limit exceeded", detail: "stack trace" }, now)?.errorInfo.category).toBe("rate-limit");
    expect(readAgentErrorText({ message: "Provider error", detail: "429 RESOURCE_EXHAUSTED: quota" }, now)?.errorInfo.category).toBe("rate-limit");
    // Tool output after the first line is not the agent's error.
    expect(readAgentErrorText({ message: "Provider error", detail: "Agent crashed\nquota exceeded in test fixture" }, now)).toBeNull();
    expect(readAgentErrorText(null, now)).toBeNull();
  });
});

describe("review fixes: permission modes", () => {
  it("treats a create with no mode as BB's fill-in, which the target must offer as is", () => {
    expect(effectivePermission(null, null)).toEqual({ mode: "auto", exact: true });
    expect(effectivePermission(undefined, "accept-edits")).toEqual({ mode: "accept-edits", exact: true });
    expect(effectivePermission("accept-edits", "full")).toEqual({ mode: "accept-edits", exact: false });
  });

  it("never gives Pi or an ACP agent full access to a create that named no mode", async () => {
    const { router } = harness();
    await router.load();
    // BB would fill in "auto", and an agent without it would run with "full".
    expect(await router.resolve({ text: "Fix tokenize()" })).toEqual(codex);
    const decision = await router.decide("Fix tokenize()", { permissionMode: "auto", exactPermission: true });
    expect(decision.skipped.map((each) => [each.target.providerId, each.why])).toEqual([
      ["acp-opencode", "doesn't offer auto, the mode this thread would get"],
      ["acp-antigravity", "doesn't offer auto, the mode this thread would get"],
      ["pi", "doesn't offer auto, the mode this thread would get"],
    ]);
  });

  it("uses the parent's mode for a worker that names none", async () => {
    const { router } = harness({ executions: { thr_parent: { model: "gpt-5.5-codex", permissionMode: "full" } } });
    await router.load();
    expect(await router.resolve({ text: "Fix tokenize()", parentThreadId: "thr_parent" })).toEqual(glm);
    const narrow = harness({ executions: { thr_parent: { model: "gpt-5.5-codex", permissionMode: "accept-edits" } } });
    await narrow.router.load();
    // ACP offers accept-edits; Pi (full only) is never picked under it.
    expect(await narrow.router.resolve({ text: "Fix tokenize()", parentThreadId: "thr_parent" })).toEqual(glm);
    expect((await narrow.router.decide("Fix tokenize()", { permissionMode: "accept-edits", exactPermission: true })).skipped).toEqual([]);
  });

  it("an explicit mode is narrowed by BB, so a narrower ACP mode is fine and Pi still isn't", async () => {
    const { router } = harness({ rule: "none" });
    await router.load();
    expect(await router.resolve({ text: "Hello", permissionMode: "auto" })).toEqual(codex);
    expect((await router.decide("Hello", { permissionMode: "auto" })).skipped).toEqual([{ target: piSonnet, why: "no permission mode at or below auto" }]);
  });

  it("puts the narrowed mode on the notice: a Codex thread on auto hands off to ACP with accept-edits", async () => {
    const { router } = harness({ thread: { providerId: "codex" }, execution: { model: codex.model, permissionMode: "auto" } });
    await router.setPolicy({ ...policy, rules: [{ id: "coding", text: "Pure coding", chain: [codex, glm] }] });
    expect(await router.onTurnFailed(failed({ category: "rate-limit", providerCode: "rate_limit", httpStatusCode: 429 }))).toMatchObject({ target: glm, permissionMode: "accept-edits" });
  });

  it("the handoff RPC always names the mode, narrowed from the thread's", async () => {
    const { router, spawned, store } = harness({ thread: { providerId: "codex" }, execution: { model: codex.model, permissionMode: "auto" } });
    await router.load();
    store.set(noticeKey("thr_1"), { threadId: "thr_1", target: glm, targetName: "GLM 5.3", permissionMode: "accept-edits" });
    await router.handoff("thr_1");
    expect(spawned[0]).toMatchObject({ providerId: "acp-opencode", permissionMode: "accept-edits" });
  });
});

describe("review fixes: the failed turn's own error", () => {
  it("reads no error words without the failed turn, so an older turn's 429 can't raise a notice", async () => {
    const { router, errorText } = harness({ errorText: "429 Too Many Requests" });
    await router.load();
    expect(await router.onTurnFailed({ ...failed(), turnId: null })).toBeNull();
    expect(errorText).not.toHaveBeenCalled();
  });

  it("blocks a model that ran out of credits for an hour, though no reset was given", async () => {
    const { router } = harness({ errorText: "Insufficient credits. Add more to continue." });
    await router.load();
    expect(await router.onTurnFailed(failed())).toMatchObject({ reason: "out of credits" });
    expect((await router.decide("Fix tokenize()")).skipped[0]).toMatchObject({ target: glm, why: "out of credits" });
    clock.now += 61 * 60_000;
    expect((await router.decide("Fix tokenize()")).target).toEqual(glm);
  });

  it("ignores the thread's older rate-limit snapshot when the words of this turn say what happened", async () => {
    const { router } = harness({ errorText: "Insufficient credits" });
    await router.load();
    const old = { status: "blocked", kind: "usage", windows: [{ label: null, status: "blocked", resetsAtMs: now + 5 * 3_600_000 }] };
    expect(await router.onTurnFailed(failed(null, old))).toMatchObject({ reason: "out of credits" });
  });
});

describe("review fixes: an unreachable model server is per machine", () => {
  it("a local model that didn't answer on another machine stays usable on Auto's machine", async () => {
    const remote = harness({ rule: "private", execution: { model: qwenLocal.model, permissionMode: "full" }, errorText: "connect ECONNREFUSED 127.0.0.1:11434", threadHost: "host_remote" });
    await remote.router.load();
    await remote.router.onTurnFailed(failed());
    expect((await remote.router.decide("My tax notes")).target).toEqual(qwenLocal);
    const local = harness({ rule: "private", execution: { model: qwenLocal.model, permissionMode: "full" }, errorText: "connect ECONNREFUSED 127.0.0.1:11434" });
    await local.router.load();
    await local.router.onTurnFailed(failed());
    expect((await local.router.decide("My tax notes")).skipped[0]).toMatchObject({ target: qwenLocal, why: "unreachable" });
  });
});

describe("re-review fixes", () => {
  it("N1: with BB's provider list failing, no target is picked under a permission mode (BB's defaults instead)", async () => {
    const { router } = harness({ providersFail: true });
    await router.load();
    // A create with no mode: BB would fill in "auto", and Pi (full only) would get "full".
    expect(await router.resolve({ text: "Fix tokenize()" })).toBeNull();
    expect((await router.decide("Fix tokenize()", { permissionMode: "auto", exactPermission: true })).skipped.map((each) => each.why)).toEqual(["permission modes unknown", "permission modes unknown", "permission modes unknown", "permission modes unknown"]);
    // Settings' check names no mode, so it isn't affected.
    expect((await router.checkTargets()).every((check) => check.problem === null)).toBe(true);
  });

  it("N2: with the thread's mode unreadable, the notice offers no model and the handoff RPC refuses", async () => {
    const { router, store, spawned } = harness({ thread: { providerId: "codex" }, execution: { model: codex.model, permissionMode: null } });
    await router.setPolicy({ ...policy, rules: [{ id: "coding", text: "Pure coding", chain: [codex, glm] }] });
    const notice = await router.onTurnFailed(failed({ category: "rate-limit", providerCode: "rate_limit", httpStatusCode: 429 }));
    expect(notice).toMatchObject({ target: null, permissionMode: null });
    expect(notice?.text).toContain("permission mode can't be read");
    store.set(noticeKey("thr_1"), { threadId: "thr_1", target: glm, targetName: "GLM 5.3", permissionMode: "accept-edits" });
    await expect(router.handoff("thr_1")).rejects.toThrow("permission mode can't be read");
    expect(spawned).toEqual([]);
  });

  it("N8: catalog failures count per host and project, like the catalog", async () => {
    const catalogs: Record<string, string[] | null | { error: string }> = { "acp-opencode": [glm.model], "acp-antigravity": { error: "timeout" }, pi: [piSonnet.model], codex: [codex.model] };
    const { router } = harness({ catalogs });
    await router.load();
    // One failure read for project A, one for project B: neither project has failed twice.
    await router.decide("Fix tokenize()", { permissionMode: "full", projectId: "prj_a" });
    const second = await router.decide("Fix tokenize()", { permissionMode: "full", projectId: "prj_b" });
    expect(second.target).toEqual(glm);
    expect(second.skipped).toEqual([]);
    clock.now += 20_000;
    const again = await router.availability({ projectId: "prj_a", targets: [gemini] });
    expect(again(gemini)).toBe("unreachable (its models can't be listed)");
  });
});
