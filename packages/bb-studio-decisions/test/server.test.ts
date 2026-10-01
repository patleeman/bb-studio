import { test } from "vitest";
import assert from "node:assert/strict";
import plugin from "../server";
import { rpcContract } from "../contract";

function setup() {
  const handlers: Record<string, (input: any) => Promise<any>> = {};
  const hooks: Record<string, (input: any) => Promise<any>> = {};
  const stored = new Map<string, unknown>();
  const warnings: string[] = [];
  const bb = {
    pluginId: "smart-decisions",
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
  const noJev = rpcContract["systemOne.ask"].output.parse(await handlers["systemOne.ask"]!(ask));
  assert.equal(noJev.ok, false);
  if (!noJev.ok) assert.equal(noJev.unavailable, true);
  assert.equal(warnings.length, 0);
  assert.deepEqual(await handlers["fallback.get"]!(null), { mode: "thread" });
  await handlers["fallback.set"]!({ mode: "off" });
  assert.deepEqual(stored.get("fallback"), { mode: "off" });
  const model = rpcContract["model.ask"].input.parse({ caller: "test", requestId: "one", hostId: "host", prompt: "Classify", providerId: null });
  const noModel = rpcContract["model.ask"].output.parse(await handlers["model.ask"]!(model));
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
