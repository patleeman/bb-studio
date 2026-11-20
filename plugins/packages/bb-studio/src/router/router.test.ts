import { describe, expect, it, vi } from "vitest";
import { defaultPolicy, type Notice, type Policy, type Target } from "./contract";
import type { RouterDecisions } from "./decide";
import { handoffRequest, ModelRouter, noticeKey, POLICY_KEY, type RouterDeps, type RouterThread } from "./router";

const opus: Target = { providerId: "claude-code", model: "claude-opus-5-5", reasoningLevel: "high", label: "Opus 5.5" };
const glm: Target = { providerId: "acp-opencode", model: "zai/glm-5.3", reasoningLevel: null, label: "GLM 5.3" };
const codex: Target = { providerId: "codex", model: "gpt-5.5-codex", reasoningLevel: "medium", label: "GPT-5.5 Codex" };

const policy: Policy = {
  enabled: true,
  autoDefault: true,
  rules: [
    { id: "visual", text: "Design, front end, anything strongly visual", chain: [opus, codex] },
    { id: "coding", text: "Pure coding", chain: [glm, codex] },
  ],
  defaultChain: [codex],
};

const baseThread: RouterThread = { id: "thr_1", projectId: "prj_1", providerId: "claude-code", environmentId: "env_1", title: "Settings page", status: "error", visibility: "visible" };

interface HarnessOptions {
  states?: Record<string, string>;
  jevRule?: string;
  execution?: { model: string | null; permissionMode: string | null };
  thread?: Partial<RouterThread>;
  /** Thread status read after the notice is built (a retry may have started). */
  laterStatus?: string;
  catalogs?: Record<string, string[] | null>;
  modes?: Record<string, string[]>;
  appHandlesSignIn?: boolean;
  queuedRetries?: number;
}

function harness(options: HarnessOptions = {}) {
  const store = new Map<string, unknown>([[POLICY_KEY, policy]]);
  const changed: string[] = [];
  const spawned: Record<string, unknown>[] = [];
  const cancelled: string[] = [];
  let reads = 0;
  const thread = { ...baseThread, ...options.thread };
  const decisions: RouterDecisions = {
    systemOne: vi.fn(async () => ({ ok: true as const, answers: { rule: { type: "choice", choice: options.jevRule ?? "visual", confidence: 0.9, probabilities: {} } }, via: "TypeSafe", ms: 2 })),
    completeText: null,
  };
  const catalogs = options.catalogs ?? { "claude-code": [opus.model], codex: [codex.model], "acp-opencode": [glm.model] };
  const modes = options.modes ?? { "claude-code": ["accept-edits", "auto", "full"], codex: ["accept-edits", "auto", "full"], "acp-opencode": ["accept-edits", "full"] };
  const deps: RouterDeps = {
    kv: {
      get: async (key) => store.get(key),
      set: async (key, value) => { store.set(key, value); },
      delete: async (key) => { store.delete(key); },
    },
    providerStates: async () => Object.entries(options.states ?? { "claude-code": "ready", codex: "ready", "acp-opencode": "ready" }).map(([providerId, status]) => ({ providerId, status })),
    providers: async () => new Map([
      ["claude-code", { name: "Claude Code", permissionModes: modes["claude-code"] ?? [] }],
      ["codex", { name: "Codex", permissionModes: modes.codex ?? [] }],
      ["acp-opencode", { name: "opencode", permissionModes: modes["acp-opencode"] ?? [] }],
    ]),
    models: async (providerId) => {
      const list = catalogs[providerId];
      return list === null || list === undefined ? null : new Set(list);
    },
    thread: async (threadId) => {
      if (threadId !== thread.id) return null;
      reads += 1;
      return reads > 1 && options.laterStatus ? { ...thread, status: options.laterStatus } : thread;
    },
    execution: async () => ({ reasoningLevel: null, ...(options.execution ?? { model: "claude-opus-5-5", permissionMode: "full" }) }),
    spawn: async (request) => { spawned.push(request); return { id: "thr_new" }; },
    cancelRetries: async (threadId) => { cancelled.push(threadId); return options.queuedRetries ?? 1; },
    changed: (threadId) => changed.push(threadId),
    decisions,
    appHandlesSignIn: options.appHandlesSignIn ?? false,
    log: { info: () => undefined, warn: () => undefined },
    now: () => Date.UTC(2026, 10, 20, 12, 0),
  };
  const router = new ModelRouter(deps);
  return { router, store, changed, spawned, cancelled, decisions, thread };
}

const rateLimited = { threadId: "thr_1", requestId: "req_1", errorInfo: { category: "rate-limit", providerCode: "rate_limit", httpStatusCode: 429 }, rateLimits: null };

describe("Auto", () => {
  it("is offered once there is a chain, and is the default only when asked", async () => {
    const { router } = harness();
    expect(router.enabled()).toBe(false);
    await router.load();
    expect(router.enabled()).toBe(true);
    expect(router.isDefault()).toBe(true);
    await router.setPolicy({ ...defaultPolicy });
    expect(router.enabled()).toBe(false);
  });

  it("resolves a task to the first available model of the rule Jev picks", async () => {
    const { router } = harness();
    await router.load();
    expect(await router.resolve({ text: "Restyle the settings page" })).toEqual(opus);
  });

  it("skips a provider that is signed out, not set up or blocked", async () => {
    const { router } = harness({ states: { "claude-code": "unauthenticated", codex: "ready" }, jevRule: "coding" });
    await router.load();
    const decision = await router.decide("Write the parser");
    expect(decision.target).toEqual(codex);
    expect(decision.skipped).toEqual([{ target: glm, why: "not set up" }]);
    const signedOut = harness({ states: { "claude-code": "unauthenticated", codex: "ready" }, jevRule: "visual" });
    await signedOut.router.load();
    expect(await signedOut.router.decide("Restyle it")).toMatchObject({ ruleId: "visual", target: codex, skipped: [{ target: opus, why: "unauthenticated" }] });
  });

  it("skips a model its provider no longer offers, and trusts a catalog it can't read", async () => {
    const stale = harness({ catalogs: { "claude-code": ["claude-opus-6"], codex: [codex.model] } });
    await stale.router.load();
    expect(await stale.router.decide("Restyle it")).toMatchObject({ target: codex, skipped: [{ target: opus, why: "model no longer offered" }] });
    // A retired model is named before a passing block on its provider.
    await stale.router.onTurnFailed(rateLimited);
    expect((await stale.router.checkTargets())[0]).toEqual({ providerId: "claude-code", model: opus.model, problem: "model no longer offered" });
    const unreadable = harness({ catalogs: { "claude-code": null, codex: [codex.model] } });
    await unreadable.router.load();
    expect((await unreadable.router.decide("Restyle it")).target).toEqual(opus);
  });

  it("skips a provider with no permission mode at or below the one asked for", async () => {
    const { router } = harness({ jevRule: "coding", modes: { "acp-opencode": ["full"], codex: ["accept-edits", "auto", "full"] } });
    await router.load();
    expect(await router.decide("Write the parser", { permissionMode: "auto" })).toMatchObject({
      target: codex,
      skipped: [{ target: glm, why: "no permission mode at or below auto" }],
    });
    expect((await router.decide("Write the parser", { permissionMode: "full" })).target).toEqual(glm);
  });

  it("says in Settings what keeps each target from being picked", async () => {
    const { router } = harness({ states: { "claude-code": "ready", codex: "ready" }, catalogs: { "claude-code": ["claude-opus-6"], codex: [codex.model] } });
    await router.load();
    expect(await router.checkTargets()).toEqual([
      { providerId: "claude-code", model: opus.model, problem: "model no longer offered" },
      { providerId: "codex", model: codex.model, problem: null },
      { providerId: "acp-opencode", model: glm.model, problem: "not set up" },
    ]);
  });

  it("returns null (BB's defaults) when nothing in the chain is available or Auto is off", async () => {
    const { router } = harness({ states: {} });
    await router.load();
    expect(await router.resolve({ text: "x" })).toBeNull();
    await router.setPolicy({ ...policy, enabled: false });
    expect(await router.resolve({ text: "x" })).toBeNull();
  });
});

describe("the usage-limit notice", () => {
  it("suggests the next available model in the failed model's chain, on another provider", async () => {
    const { router, store, changed } = harness();
    await router.load();
    const notice = await router.onTurnFailed(rateLimited);
    expect(notice).toMatchObject({
      threadId: "thr_1",
      requestId: "req_1",
      kind: "usage-limit",
      failedProviderName: "Claude Code",
      target: codex,
      targetName: "GPT-5.5 Codex",
      text: "The auto router detected a usage limit on Claude Code (429 rate limit). Hand off to GPT-5.5 Codex?",
    });
    expect(store.get(noticeKey("thr_1"))).toEqual(notice);
    expect(changed).toEqual(["thr_1"]);
    expect(await router.notice("thr_1")).toEqual(notice);
  });

  it("then keeps Auto off the blocked provider until its reset", async () => {
    const { router } = harness();
    await router.load();
    await router.onTurnFailed(rateLimited);
    expect(await router.decide("Restyle the settings page")).toMatchObject({ target: codex, skipped: [{ target: opus, why: "429 rate limit" }] });
  });

  it("blocks a provider after a billing failure too", async () => {
    const { router } = harness();
    await router.load();
    await router.onTurnFailed({ ...rateLimited, errorInfo: { category: "billing", providerCode: null, httpStatusCode: 402 } });
    expect(await router.decide("Restyle the settings page")).toMatchObject({ target: codex, skipped: [{ target: opus, why: "billing limit" }] });
  });

  it("follows the rule the failed model belongs to (GLM → Codex), within the thread's permission mode", async () => {
    const { router } = harness({ execution: { model: "zai/glm-5.3", permissionMode: "auto" }, thread: { providerId: "acp-opencode" } });
    await router.load();
    const notice = await router.onTurnFailed(rateLimited);
    expect(notice?.target).toEqual(codex);
    expect(notice?.failedProviderName).toBe("opencode");
  });

  it("says so when no other model is available", async () => {
    const { router } = harness({ states: { "claude-code": "ready" } });
    await router.load();
    const notice = await router.onTurnFailed(rateLimited);
    expect(notice).toMatchObject({ target: null, targetName: null });
    expect(notice?.text).toMatch(/No other model in its chain is available\.$/u);
  });

  it("gives a sign-in failure its own words, unless the app shows its own sign-in prompt", async () => {
    const signIn = { ...rateLimited, errorInfo: { category: "unauthorized", providerCode: null, httpStatusCode: 401 } };
    const plain = harness();
    await plain.router.load();
    expect((await plain.router.onTurnFailed(signIn))?.text).toBe("The auto router detected a sign-in failure on Claude Code (sign-in failed (401)). Hand off to GPT-5.5 Codex?");
    const desktop = harness({ appHandlesSignIn: true });
    await desktop.router.load();
    expect(await desktop.router.onTurnFailed(signIn)).toBeNull();
    // Auto still keeps off the provider that can't sign in.
    expect((await desktop.router.decide("Restyle the settings page")).target).toEqual(codex);
  });

  it("leaves Decisions' own threads, other failures, unknown threads and a router that isn't set up alone", async () => {
    const decisionsThread = harness({ thread: { visibility: "hidden", title: "Studio Decisions · req_1" } });
    await decisionsThread.router.load();
    expect(await decisionsThread.router.onTurnFailed(rateLimited)).toBeNull();
    // A Bot conversation is hidden from BB's sidebar too, and does get the notice.
    const conversation = harness({ thread: { visibility: "hidden", title: "Fix the parser" } });
    await conversation.router.load();
    expect(await conversation.router.onTurnFailed(rateLimited)).not.toBeNull();
    const { router, store } = harness();
    await router.load();
    expect(await router.onTurnFailed({ ...rateLimited, errorInfo: { category: "overloaded", providerCode: null, httpStatusCode: 529 } })).toBeNull();
    expect(await router.onTurnFailed({ ...rateLimited, errorInfo: null })).toBeNull();
    expect(await router.onTurnFailed({ ...rateLimited, threadId: "thr_gone" })).toBeNull();
    await router.setPolicy({ ...policy, enabled: false });
    expect(await router.onTurnFailed(rateLimited)).toBeNull();
    await router.setPolicy({ ...defaultPolicy });
    expect(await router.onTurnFailed(rateLimited)).toBeNull();
    expect([...store.keys()].filter((key) => key.startsWith("router:notice:"))).toEqual([]);
  });

  it("writes nothing when the thread started again while the notice was being built", async () => {
    const { router, store } = harness({ laterStatus: "active" });
    await router.load();
    expect(await router.onTurnFailed(rateLimited)).toBeNull();
    expect(store.has(noticeKey("thr_1"))).toBe(false);
  });

  it("goes away when dismissed, and when the thread is gone", async () => {
    const { router, changed, store } = harness();
    await router.load();
    await router.onTurnFailed(rateLimited);
    await router.dismiss("thr_1");
    expect(await router.notice("thr_1")).toBeNull();
    await router.dismiss("thr_1");
    expect(changed).toEqual(["thr_1", "thr_1"]);
    await router.onTurnFailed(rateLimited);
    await router.forget("thr_1");
    expect(store.has(noticeKey("thr_1"))).toBe(false);
  });
});

describe("Hand off", () => {
  it("after the app's handoff, cancels the old thread's queued retry and clears the notice", async () => {
    const { router, cancelled } = harness({ queuedRetries: 1 });
    await router.load();
    await router.onTurnFailed(rateLimited);
    expect(await router.handedOff("thr_1")).toEqual({ cancelledRetries: 1 });
    expect(cancelled).toEqual(["thr_1"]);
    expect(await router.notice("thr_1")).toBeNull();
  });

  it("through the API: sends BB's handoff request for the notice's model, cancels the retry, keeps the old thread", async () => {
    const { router, spawned, cancelled, thread } = harness();
    await router.load();
    await router.onTurnFailed(rateLimited);
    expect(await router.handoff("thr_1")).toEqual({ threadId: "thr_new", target: codex, cancelledRetries: 1 });
    expect(spawned).toEqual([handoffRequest(thread, codex, "full")]);
    expect(cancelled).toEqual(["thr_1"]);
    expect(await router.notice("thr_1")).toBeNull();
  });

  it("through the API: narrows the permission mode to one the target supports, never wider", async () => {
    const { router, spawned } = harness({ execution: { model: "claude-opus-5-5", permissionMode: "auto" }, modes: { codex: ["accept-edits", "full"] } });
    await router.load();
    await router.onTurnFailed(rateLimited);
    await router.handoff("thr_1");
    expect(spawned[0]).toMatchObject({ permissionMode: "accept-edits" });
  });

  it("refuses without a notice that names a model", async () => {
    const { router } = harness();
    await router.load();
    await expect(router.handoff("thr_1")).rejects.toThrow(/no router notice/u);
  });

  it("builds the same request as BB's picker handoff", () => {
    expect(handoffRequest(baseThread, codex, "full")).toEqual({
      projectId: "prj_1",
      providerId: "codex",
      model: "gpt-5.5-codex",
      reasoningLevel: "medium",
      permissionMode: "full",
      executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
      environment: { type: "reuse", environmentId: "env_1" },
      input: [{
        type: "text",
        text: "Continue from @thread:thr_1",
        mentions: [{ start: 14, end: 27, resource: { kind: "thread", projectId: "prj_1", threadId: "thr_1", label: "Settings page" } }],
      }],
      startedOnBehalfOf: null,
    });
    expect(handoffRequest({ ...baseThread, environmentId: null }, glm, null)).toMatchObject({
      environment: { type: "project-default" },
      executionInputSources: { providerId: "explicit", model: "explicit" },
    });
    expect(handoffRequest(baseThread, glm, null)).not.toHaveProperty("reasoningLevel");
  });
});

it("keeps the notice shape the banner reads", () => {
  const notice: Notice = { threadId: "t", requestId: "r", kind: "usage-limit", failedProviderId: "p", failedProviderName: "P", reason: "x", target: null, targetName: null, text: "x", createdAt: 1 };
  expect(Object.keys(notice).sort()).toEqual(["createdAt", "failedProviderId", "failedProviderName", "kind", "reason", "requestId", "target", "targetName", "text", "threadId"]);
});
