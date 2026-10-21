import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { registerDecisions } from "../server";
const plugin = (bb: any) => registerDecisions(bb, { get: async () => Object.fromEntries(Object.entries(await bb.settings.define().get()).map(([key, value]) => [`decisions_${key}`, value])), experimental_set: async () => {} });
import { rpcContract } from "../../kit/decisions-legacy-contract";

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
  const ask = rpcContract["systemOne.ask"].input.parse({ caller: "test", state: {}, questions });
  const noJev = rpcContract["systemOne.ask"].output.parse(await handlers["decisions.systemOne.ask"]!(ask));
  assert.equal(noJev.ok, false);
  if (!noJev.ok) assert.equal(noJev.unavailable, true);
  assert.equal(warnings.length, 0);
  assert.deepEqual(await handlers["decisions.fallback.get"]!(null), { mode: "thread" });
  await handlers["decisions.fallback.set"]!({ mode: "off" });
  assert.deepEqual(stored.get("decisions:fallback"), { mode: "off" });
  const model = rpcContract["model.ask"].input.parse({ caller: "test", requestId: "one", hostId: "host", prompt: "Classify", providerId: null });
  const noModel = rpcContract["model.ask"].output.parse(await handlers["decisions.model.ask"]!(model));
  assert.equal(noModel.ok, false);
  if (!noModel.ok) assert.equal(noModel.unavailable, true);
});

test("dispatch hook passes a message through when Smart Queue is off", async () => {
  const { bb, hooks } = setup();
  await plugin(bb as never);
  const hook = hooks["message.dispatch"]!;
  assert.deepEqual(await hook({
    attempt: "start-turn", initiator: "user", senderThreadId: null,
    experimental_submission: null, queuedMessages: [],
    thread: { id: "thr_1", status: "idle", visibility: "visible", originPluginId: null },
  }), { action: "proceed" });
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
  const result = await handlers["decisions.model.ask"]!(rpcContract["model.ask"].input.parse(request));
  assert.equal(result.text, "Cleaned text");
  assert.equal(result.via, "chosen/small");
  assert.deepEqual(expectSelection(spawn.mock.calls[0]), request.modelSelection);
  assert.equal(stop.mock.calls.length, 1);
  assert.equal(remove.mock.calls.length, 1);
  assert.equal(rpcContract["model.ask"].input.safeParse({ ...request, modelSelection: { ...request.modelSelection, model: " " } }).success, false);
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

test("Studio registers one hook, suppresses it while standalone Smart Queue is enabled, and waits for the old bridge", async () => {
  for (const installed of [
    [{ id: "smart-queue", enabled: true }],
    [{ id: "smart-decisions", enabled: true, version: "0.4.0" }],
    [{ id: "smart-decisions", enabled: true, version: "0.5.0" }],
  ]) {
    const { bb, hooks } = setup();
    bb.settings.define = () => ({ get: async () => ({ enabled: true, jevProvider: "custom" }) });
    bb.sdk.plugins.list = async () => ({ plugins: installed }) as never;
    await plugin(bb as never);
    assert.deepEqual(Object.keys(hooks), ["message.dispatch"]);
    assert.deepEqual(await hooks["message.dispatch"]!({
      attempt: "start-turn", initiator: "user", senderThreadId: null,
      experimental_submission: null, queuedMessages: [],
      thread: { id: "thr_1", status: "active", visibility: "visible", originPluginId: null },
    }), { action: "proceed" });
  }
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
  assert.deepEqual(owners, ["studio", "smart-decisions"]);
  assert.deepEqual(removed, ["studio-stale", "smart-decisions-stale"]);
});
