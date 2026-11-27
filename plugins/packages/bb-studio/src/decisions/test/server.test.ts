import { afterEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import { mainRunIdleFrom, readMainRunIdle, registerDecisions } from "../server";
const plugin = (bb: any) => registerDecisions(bb, { get: async () => Object.fromEntries(Object.entries(await bb.settings.define().get()).map(([key, value]) => [`decisions_${key}`, value])) });
import { rpcContract } from "../contract";

afterEach(() => vi.restoreAllMocks());

function setup() {
  const handlers: Record<string, (input: any) => Promise<any>> = {};
  const hooks: Record<string, (input: any) => Promise<any>> = {};
  const stored = new Map<string, unknown>();
  const warnings: string[] = [];
  const bb = {
    pluginId: "studio",
    settings: { define: () => ({ get: async () => ({ enabled: false, jevProvider: "custom" }) }) },
    storage: { kv: { get: async (key: string) => stored.get(key), set: async (key: string, value: unknown) => { stored.set(key, value); } } },
    sdk: {
      plugins: { list: async () => ({ plugins: [] }) },
      projects: { list: async () => [{ id: "personal", kind: "personal" }] },
      providers: { list: async () => [] },
    },
    rpc: { register: (_contract: unknown, registered: typeof handlers) => Object.assign(handlers, registered) },
    experimental_hooks: { on: (name: string, hook: (input: any) => Promise<any>) => { hooks[name] = hook; }, recheck: async () => {} },
    events: { on: () => {} },
    background: { service: () => {} },
    cli: { register: () => {} },
    onDispose: () => {},
    log: { warn: (message: string) => warnings.push(message), info: () => {} },
  };
  return { bb, handlers, hooks, stored, warnings };
}

test("RPC handlers keep unavailable distinct from a failed call", async () => {
  const { bb, handlers, stored, warnings } = setup();
  await plugin(bb as never);
  const questions = { action: { type: "noul", instructions: "Is this urgent?" } };
  const ask = rpcContract["decisions.systemOne.ask"].input.parse({ caller: "test", state: {}, questions });
  const noJev = rpcContract["decisions.systemOne.ask"].output.parse(await handlers["decisions.systemOne.ask"]!(ask));
  assert.equal(noJev.ok, false);
  if (!noJev.ok) assert.equal(noJev.unavailable, true);
  assert.equal(warnings.length, 0);
  assert.deepEqual(await handlers["decisions.fallback.get"]!(null), { mode: "thread" });
  await handlers["decisions.fallback.set"]!({ mode: "off" });
  assert.deepEqual(stored.get("decisions:fallback"), { mode: "off" });
  const model = rpcContract["decisions.model.ask"].input.parse({ caller: "test", requestId: "one", hostId: "host", prompt: "Classify", providerId: null });
  const noModel = rpcContract["decisions.model.ask"].output.parse(await handlers["decisions.model.ask"]!(model));
  assert.equal(noModel.ok, false);
  if (!noModel.ok) assert.equal(noModel.unavailable, true);
});

test("dispatch hook passes a message through when Smart Queue is off", async () => {
  const { bb, hooks } = setup();
  const list = vi.fn(async () => ({ plugins: [] }));
  bb.sdk.plugins.list = list as never;
  await plugin(bb as never);
  const hook = hooks["message.dispatch"]!;
  expect(list).toHaveBeenCalledTimes(1); // Registration initializes the cache.
  assert.deepEqual(await hook({
    attempt: "start-turn", initiator: "user", senderThreadId: null,
    experimental_submission: null, queuedMessages: [],
    thread: { id: "thr_1", status: "idle", visibility: "visible", originPluginId: null },
  }), { action: "proceed" });
  expect(list).toHaveBeenCalledTimes(1); // Dispatch never asks the SDK for plugin state.
});

test("the before guard runs first in the single dispatch hook, and its result wins", async () => {
  const { bb, hooks } = setup();
  const guarded = new Set(["thr_runner"]);
  await registerDecisions(bb as never, { get: async () => ({}) }, async (context) => guarded.has(context.thread.id) ? { action: "reject", message: "Machine offline" } : null);
  assert.deepEqual(Object.keys(hooks), ["message.dispatch"]);
  const input = (id: string) => ({ attempt: "start-turn", initiator: "user", senderThreadId: null, experimental_submission: null, queuedMessages: [], thread: { id, status: "idle", visibility: "visible", originPluginId: null } });
  assert.deepEqual(await hooks["message.dispatch"]!(input("thr_runner")), { action: "reject", message: "Machine offline" });
  assert.deepEqual(await hooks["message.dispatch"]!(input("thr_other")), { action: "proceed" });
});

test("Studio registers exactly one message.dispatch hook, which BB requires", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = join(__dirname, "../../..");
  const files = [join(root, "server.ts")];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !path.includes("/test/")) files.push(path); } };
  walk(join(root, "src"));
  const registrations = files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/experimental_hooks\.on\(\s*"message\.dispatch"/g)].map(() => file));
  assert.equal(registrations.length, 1, registrations.join("\n"));
});

test("an explicit model overrides an off fallback and retains the chosen execution settings", async () => {
  const { bb, handlers } = setup();
  const spawn = vi.fn(async () => ({ id: "temporary" }));
  const stop = vi.fn(async () => {});
  const remove = vi.fn(async () => {});
  Object.assign(bb.sdk, {
    providers: { list: async () => [{ id: "chosen", available: true, reasoningLevels: [{ id: "low" }], capabilities: { permissionModes: ["accept-edits"] } }] },
    threads: { spawn, wait: async () => {}, output: async () => ({ output: "Cleaned text" }), stop, delete: remove },
  });
  await plugin(bb as never);
  await handlers["decisions.fallback.set"]!({ mode: "off" });
  const request = {
    caller: "talk", requestId: "cleanup:one", hostId: "host", prompt: "Clean up", providerId: null,
    modelSelection: { providerId: "chosen", model: "small", reasoningLevel: "low", serviceTier: "fast" },
  };
  const result = await handlers["decisions.model.ask"]!(rpcContract["decisions.model.ask"].input.parse(request));
  assert.equal(result.text, "Cleaned text");
  assert.equal(result.via, "chosen/small");
  assert.deepEqual(expectSelection(spawn.mock.calls[0]), request.modelSelection);
  assert.equal(stop.mock.calls.length, 1);
  assert.equal(remove.mock.calls.length, 1);
  assert.equal(rpcContract["decisions.model.ask"].input.safeParse({ ...request, modelSelection: { ...request.modelSelection, model: " " } }).success, false);
});

function expectSelection(call: unknown) {
  const { providerId, model, reasoningLevel, serviceTier } = (call as any[])[0];
  return { providerId, model, reasoningLevel, serviceTier };
}

test("a Smart Queue decision cancelled by a hand send does not count as a Jev failure", async () => {
  const { bb, handlers } = setup();
  const events: Record<string, (payload: any) => unknown> = {};
  bb.settings.define = () => ({
    get: async () => ({ enabled: true, jevProvider: "custom", customJevEndpoint: "https://gw.example.com/v1/systemone", customJevModel: "jev" }),
  });
  (bb.events as any).on = (name: string, handler: (payload: any) => unknown) => { events[name] = handler; };
  Object.assign(bb.sdk, {
    threads: {
      get: async () => ({ id: "thr_1", status: "active", visibility: "visible", originPluginId: null, title: "Work", environmentId: null }),
      promptHistory: async () => [],
      output: async () => ({ output: null }),
    },
  });
  let started!: () => void;
  const fetching = new Promise<void>((resolve) => (started = resolve));
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
    started();
    return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
  });
  await plugin(bb as never);
  const entry = {
    id: "q_1", threadId: "thr_1", createdAt: 1, initiator: "user", senderThreadId: null, originPluginId: null,
    payload: { kind: "inline" }, editable: true, waitingOn: { kind: "plugin", pluginId: "studio", reason: "" },
    content: [{ type: "text", text: "Also add tests", mentions: [] }],
  };
  events["message.queued"]!({ entry });
  await fetching;
  events["message.dispatched"]!({ entry });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const { checks } = await handlers["decisions.studio_health"]!(null);
  assert.deepEqual(checks.map((check: { id: string }) => check.id), ["jev-route"]);
});

test("Smart Queue decides once for migrated data and a fresh install without a bridge gate", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: {
    action: { type: "choice", choice: "steer", confidence: 1, probabilities: { steer: 1, followup: 0 } },
  } }), { headers: { "content-type": "application/json" } }));
  globalThis.fetch = fetchMock as typeof fetch;
  try {
    const scenarios: { name: string; installed: { id: string; enabled: boolean; version?: string }[]; settings: Record<string, unknown> }[] = [
      { name: "migrated settings with a leftover bridge", installed: [{ id: "smart-decisions", enabled: true, version: "0.5.0" }], settings: { enabled: true, jevProvider: "custom", customJevEndpoint: "https://gw.example.com/v1/systemone", customJevModel: "jev" } },
      { name: "fresh settings without the old plugin", installed: [], settings: { jevProvider: "custom", customJevEndpoint: "https://gw.example.com/v1/systemone", customJevModel: "jev" } },
    ];
    for (const scenario of scenarios) {
      const { bb, hooks, stored } = setup();
      const events: Record<string, (payload: any) => unknown> = {};
      bb.settings.define = () => ({ get: async () => scenario.settings as never });
      const list = vi.fn(async () => ({ plugins: scenario.installed }));
      bb.sdk.plugins.list = list as never;
      (bb.events as any).on = (name: string, handler: (payload: any) => unknown) => { events[name] = handler; };
      Object.assign(bb.sdk, {
        threads: {
          get: async () => ({ id: "thr_1", status: "active", visibility: "visible", originPluginId: null, title: "Work", environmentId: null }),
          promptHistory: async () => [],
          output: async () => ({ output: null }),
        },
      });
      await plugin(bb as never);
      assert.equal(list.mock.calls.length, 1, `${scenario.name}: initialize standalone queue outside dispatch`);
      assert.deepEqual(Object.keys(hooks), ["message.dispatch"], scenario.name);
      const initial = await hooks["message.dispatch"]!({
        attempt: "join-turn", initiator: "user", senderThreadId: null,
        experimental_submission: null, queuedMessages: [],
        thread: { id: "thr_1", status: "active", visibility: "visible", originPluginId: null },
      });
      assert.equal(list.mock.calls.length, 1, `${scenario.name}: dispatch uses cached plugin state`);
      assert.equal(initial.action, "wait", scenario.name);
      if (initial.action === "wait") {
        assert.match(initial.reason, /Smart Queue is deciding/, scenario.name);
        assert.equal(typeof initial.sendAt, "number", scenario.name);
      }
      const entry = {
        id: "q_1", threadId: "thr_1", createdAt: 1, initiator: "user", senderThreadId: null, originPluginId: null,
        payload: { kind: "inline" }, editable: true, waitingOn: { kind: "plugin", pluginId: "studio", reason: "" },
        content: [{ type: "text", text: "Use SQLite for this task", mentions: [] }],
      };
      const requestsBefore = fetchMock.mock.calls.length;
      events["message.queued"]!({ entry });
      for (let attempt = 0; attempt < 20 && !stored.has("decisions:recent-decisions"); attempt++)
        await new Promise((resolve) => setImmediate(resolve));
      assert.equal(fetchMock.mock.calls.length, requestsBefore + 1, `${scenario.name}: one Jev request`);
      const recent = stored.get("decisions:recent-decisions");
      assert.ok(Array.isArray(recent), scenario.name);
      assert.equal(recent.length, 1, scenario.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the standalone Smart Queue plugin still suppresses Studio's queue", async () => {
  const { bb, hooks } = setup();
  bb.settings.define = () => ({ get: async () => ({ enabled: true, jevProvider: "custom" }) });
  bb.sdk.plugins.list = async () => ({ plugins: [{ id: "smart-queue", enabled: true }] }) as never;
  await plugin(bb as never);
  assert.deepEqual(await hooks["message.dispatch"]!({
    attempt: "join-turn", initiator: "user", senderThreadId: null,
    experimental_submission: null, queuedMessages: [],
    thread: { id: "thr_1", status: "active", visibility: "visible", originPluginId: null },
  }), { action: "proceed" });
});

test("registration finishes while BB can't answer yet (no host during plugin load), and dispatch waits for the first check", async () => {
  // During Studio's load, plugins.list waits on BB's plugin loading and host
  // connection, which wait on this load: awaiting it held every start 30 s.
  const { bb, hooks } = setup();
  bb.settings.define = () => ({ get: async () => ({ enabled: true, jevProvider: "custom" }) });
  let answer!: (value: { plugins: { id: string; enabled: boolean }[] }) => void;
  const list = vi.fn(() => new Promise<{ plugins: { id: string; enabled: boolean }[] }>((resolve) => { answer = resolve; }));
  bb.sdk.plugins.list = list as never;
  const registered = await Promise.race([plugin(bb as never).then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 1_000))]);
  assert.equal(registered, true, "registerDecisions must not wait on plugins.list");
  expect(list).toHaveBeenCalledTimes(1);
  // Once BB answers, the standalone Smart Queue plugin still suppresses Studio's queue, from the first dispatch on.
  const decided = hooks["message.dispatch"]!({
    attempt: "join-turn", initiator: "user", senderThreadId: null,
    experimental_submission: null, queuedMessages: [],
    thread: { id: "thr_1", status: "active", visibility: "visible", originPluginId: null },
  });
  answer({ plugins: [{ id: "smart-queue", enabled: true }] });
  assert.deepEqual(await decided, { action: "proceed" });
  expect(list).toHaveBeenCalledTimes(1);
});

test("recovery cleans hidden classifier sessions owned by both IDs and preserves visible work", async () => {
  const { bb } = setup();
  const services: Record<string, { start(signal: AbortSignal): Promise<void> }> = {};
  (bb.background as any).service = (name: string, service: any) => { services[name] = service; };
  const owners: string[] = [], removed: string[] = [];
  Object.assign(bb.sdk, { threads: {
    list: async ({ originPluginId }: { originPluginId: string }) => {
      owners.push(originPluginId);
      return [
        { id: `${originPluginId}-stale`, visibility: "hidden", title: "Studio Decisions · stale" },
        { id: `${originPluginId}-visible`, visibility: "visible", title: "Studio Decisions · visible" },
      ];
    },
    stop: async () => {},
    delete: async ({ threadId }: { threadId: string }) => { removed.push(threadId); },
  } });
  await plugin(bb as never);
  await services["decisions-recovery"]!.start(new AbortController().signal);
  assert.deepEqual(owners, ["studio"]);
  assert.deepEqual(removed, ["studio-stale"]);
});

test("no Jev provider is not a problem while the fallback model answers, and is broken when the fallback is off too", async () => {
  const { bb, handlers } = setup();
  bb.settings.define = () => ({ get: async () => ({ enabled: true, jevProvider: "auto" }) });
  await plugin(bb as never);
  const first = await handlers["decisions.studio_health"]!(null);
  assert.deepEqual(first.checks.map((check: { id: string; status: string }) => [check.id, check.status]), [["jev-route", "ok"]]);
  await handlers["decisions.fallback.set"]!({ mode: "off" });
  const off = await handlers["decisions.studio_health"]!(null);
  assert.deepEqual(off.checks.map((check: { id: string; status: string }) => [check.id, check.status]), [["jev-route", "broken"]]);
});

function chosenProvider(models: () => Promise<{ models: { model: string; isDefault?: boolean }[] }>) {
  return {
    list: async () => [{ id: "chosen", available: true, reasoningLevels: [{ id: "low" }, { id: "high" }], capabilities: { permissionModes: ["accept-edits"] } }],
    models,
  };
}

test("FM: health says plainly when the fallback model is gone from its provider, and claims nothing when the catalog can't be read", async () => {
  const { bb, handlers } = setup();
  let catalog = async () => ({ models: [{ model: "other" }, { model: "newest", isDefault: true }] });
  Object.assign(bb.sdk, { providers: chosenProvider(() => catalog()) });
  await plugin(bb as never);
  await handlers["decisions.fallback.set"]!({ mode: "model", providerId: "chosen", model: "removed", reasoningLevel: null });
  const gone = (await handlers["decisions.studio_health"]!(null)).checks.find((check: { id: string }) => check.id === "fallback-model");
  assert.ok(gone, "the missing model is reported");
  assert.equal(gone.status, "degraded");
  assert.equal(gone.title, "The fallback model, removed, is no longer offered by chosen");
  assert.match(gone.detail, /default model, newest/);
  assert.equal(gone.fix.label, "Choose a model");
  catalog = async () => { throw new Error("HTTP 503"); };
  const unread = (await handlers["decisions.studio_health"]!(null)).checks;
  assert.equal(unread.some((check: { id: string }) => check.id === "fallback-model"), false);
  catalog = async () => ({ models: [{ model: "removed" }] });
  const present = (await handlers["decisions.studio_health"]!(null)).checks;
  assert.equal(present.some((check: { id: string }) => check.id === "fallback-model"), false);
});

test("FM: a fallback model the provider no longer offers runs on the provider's default model instead of failing", async () => {
  const { bb, handlers, warnings } = setup();
  const spawn = vi.fn(async () => ({ id: "temporary" }));
  Object.assign(bb.sdk, {
    providers: chosenProvider(async () => ({ models: [{ model: "other" }, { model: "newest", isDefault: true }] })),
    threads: { spawn, wait: async () => {}, output: async () => ({ output: "Answer" }), stop: async () => {}, delete: async () => {} },
  });
  await plugin(bb as never);
  await handlers["decisions.fallback.set"]!({ mode: "model", providerId: "chosen", model: "removed", reasoningLevel: "high" });
  const request = rpcContract["decisions.model.ask"].input.parse({ caller: "test", requestId: "one", hostId: "host", prompt: "Classify", providerId: null });
  const result = await handlers["decisions.model.ask"]!(request);
  assert.equal(result.ok, true);
  assert.equal(result.via, "chosen/newest");
  const call = (spawn.mock.calls[0] as any[])[0];
  assert.equal(call.model, "newest");
  // The removed model's reasoning level may not suit the default, so the lowest is used.
  assert.equal(call.reasoningLevel, "low");
  assert.deepEqual(warnings, []);
});

test("FM: a fallback model is kept when its provider's catalog can't be read", async () => {
  const { bb, handlers } = setup();
  const spawn = vi.fn(async () => ({ id: "temporary" }));
  Object.assign(bb.sdk, {
    providers: chosenProvider(async () => { throw new Error("HTTP 503"); }),
    threads: { spawn, wait: async () => {}, output: async () => ({ output: "Answer" }), stop: async () => {}, delete: async () => {} },
  });
  await plugin(bb as never);
  await handlers["decisions.fallback.set"]!({ mode: "model", providerId: "chosen", model: "kept", reasoningLevel: "high" });
  const request = rpcContract["decisions.model.ask"].input.parse({ caller: "test", requestId: "one", hostId: "host", prompt: "Classify", providerId: null });
  assert.equal((await handlers["decisions.model.ask"]!(request)).via, "chosen/kept");
  assert.equal((spawn.mock.calls[0] as any[])[0].reasoningLevel, "high");
});

test("FM: a signed-out provider in thread mode is unavailable, not a failure logged on every message", async () => {
  const { bb, handlers, warnings } = setup();
  Object.assign(bb.sdk, { providers: { list: async () => [{ id: "codex", available: false, capabilities: { permissionModes: [] } }] } });
  await plugin(bb as never);
  const request = rpcContract["decisions.model.ask"].input.parse({ caller: "test", requestId: "one", hostId: "host", prompt: "Classify", providerId: "codex" });
  const result = rpcContract["decisions.model.ask"].output.parse(await handlers["decisions.model.ask"]!(request));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.unavailable, true);
    assert.match(result.error, /signed out or unavailable.*Sign in to it, or choose a fallback model/);
  }
  assert.deepEqual(warnings, []);
});

test("the main run reads idle only from the newest root turn event", () => {
  const idle = { type: "turn/mainRun/updated", data: { state: "idle" } };
  const running = { type: "turn/mainRun/updated", data: { state: "running" } };
  assert.equal(mainRunIdleFrom([idle, { type: "turn/started" }]), true);
  assert.equal(mainRunIdleFrom([running, idle]), false);
  assert.equal(mainRunIdleFrom([{ type: "turn/started" }, idle]), false, "a new turn after idle");
  assert.equal(mainRunIdleFrom([{ type: "turn/started", data: { parentToolCallId: "call_1" } }, idle]), true, "a child turn is skipped");
  assert.equal(mainRunIdleFrom([]), false);
});

test("the main run check is false when the events can't be read", async () => {
  const list = vi.fn(async () => { throw new Error("offline"); });
  assert.equal(await readMainRunIdle({ threads: { events: { list } } } as never, "thr_1"), false);
  const idle = vi.fn(async () => [{ type: "turn/mainRun/updated", data: { state: "idle" } }]);
  assert.equal(await readMainRunIdle({ threads: { events: { list: idle } } } as never, "thr_1"), true);
});

test("the dispatch hook reads Studio's cached settings, and follows a change without get()", async () => {
  const { bb, hooks } = setup();
  let current: Record<string, unknown> = { decisions_enabled: true };
  const get = vi.fn(async () => current);
  await registerDecisions(bb as never, { get, current: () => current });
  const hook = hooks["message.dispatch"]!;
  const busySend = {
    attempt: "join-turn", initiator: "user", senderThreadId: null, experimental_submission: null, queuedMessages: [],
    input: { blocks: [], text: "also this" },
    thread: { id: "thr_1", status: "active", visibility: "visible", originPluginId: null },
  };
  get.mockClear();
  assert.equal((await hook(busySend)).action, "wait");
  current = { decisions_enabled: false };
  assert.deepEqual(await hook(busySend), { action: "proceed" });
  expect(get).not.toHaveBeenCalled();
});
