import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { AutomaticStore, AUTOMATIC_MIGRATION, AUTOMATIC_FILTER_MIGRATION } from "./automatic-store";
import { recurringThread } from "./automatic-contract";
import { quietReply } from "./automatic";

describe("automatic Inbox persistence", () => {
  it("coalesces jobs, ignores old model results, and never replays a processed turn", () => {
    const db = new Database(":memory:"); db.exec(AUTOMATIC_MIGRATION); db.exec(AUTOMATIC_FILTER_MIGRATION);
    const store = new AutomaticStore(db);
    const old = { thread_id: "t", at: 10, body: "Old" };
    const next = { ...old, at: 20, body: "New" };
    store.enqueue(old); store.enqueue(next);
    expect(store.finish(old, { headline: "Old", urgent: false, readAt: null })).toBe(false);
    expect(store.get("t")).toBeNull();
    store.finish(next, { headline: "New", urgent: false, readAt: null });
    store.enqueue(next); store.enqueue(old);
    expect(store.next()).toBeNull();
    store.read("t", 10); expect(store.get("t")?.read_at).toBeNull();
    store.read("t", 20); expect(store.get("t")?.read_at).toBe(20);
    store.enqueue({ ...next, at: 30 }); store.finish({ ...next, at: 30 });
    expect(store.get("t")?.at).toBe(20); // A quiet run does not erase a result.
    expect(new AutomaticStore(db).get("t")?.headline).toBe("New");
    db.close();
  });
  it("distinguishes recurring agent work from one-time schedules and scripts", () => {
    const base = { id: "a", name: "Check", projectId: "p", trigger: { triggerType: "schedule" }, execution: { mode: "agent", targetThreadId: "t" } };
    expect(recurringThread(base, "t")).toBe(true);
    expect(recurringThread({ ...base, execution: { mode: "agent" }, lastRunThreadId: "t" }, "t")).toBe(true);
    expect(recurringThread({ ...base, trigger: { triggerType: "once" } }, "t")).toBe(false);
    expect(recurringThread({ ...base, execution: { mode: "script", targetThreadId: "t" } }, "t")).toBe(false);
    expect(quietReply("Nothing new.")).toBe(true);
    expect(quietReply("Nothing new. But the backup failed.")).toBe(false);
  });
});

const disposals: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); });
async function setup(options: { profile?: boolean; recurring?: boolean; choice?: string; unavailable?: boolean; notify?: boolean; fallback?: string; listFails?: boolean } = {}) {
  let thread = makeThreadResponse({ id: "t", projectId: "p", title: "Watcher", status: "idle", environmentId: "env_test", visibility: "visible", latestAttentionAt: 1000, lastReadAt: null });
  let gone = false;
  const notifications: unknown[] = [];
  const decisions: unknown[] = [];
  const fallbackRequests: { prompt: string; hostId: string }[] = [];
  const { bb, harness } = createFakePluginHost({ pluginId: "feed", settings: { automaticNotify: options.notify ?? false }, sdk: {
    threads: { get: async () => { if (gone) throw new Error("Thread not found"); return thread; },
      list: async () => { if (options.listFails) throw new Error("Host restarting"); return []; } },
    plugins: { callRpc: async ({ pluginId, method, input }: { pluginId: string; method: string; input?: unknown }) => {
      if (method === "automations_overview") return { automations: [] };
      if (method === "threadProfile") return { botId: options.profile ? "bot_a" : null };
      if (method === "automations_list") return options.recurring ? [{ id: "a", name: "Check", projectId: "p", trigger: { triggerType: "schedule" }, execution: { mode: "agent", targetThreadId: "t" } }] : [];
      if (method === "systemOne.ask") {
        decisions.push(input);
        if (options.unavailable) throw new Error("Offline");
        return { ok: true, answers: { disposition: { type: "choice", choice: options.choice ?? "show", confidence: 0.99, probabilities: {} } }, via: "test", ms: 1 };
      }
      if (method === "model.ask") {
        fallbackRequests.push(input as { prompt: string; hostId: string });
        if (options.fallback === undefined) throw new Error("Fallback offline");
        return { ok: true, text: options.fallback, via: "test", ms: 1 };
      }
      if (pluginId === "mobile") { notifications.push(input); return { ok: true, sent: 1 }; }
      throw new Error(`Unexpected RPC ${pluginId}/${method}`);
    } },
  } });
  harness.inspection.sdk.stub("environments.get", async () => ({ hostId: "host_test" }));
  await plugin(bb);
  const svc = harness.behavior.runService("inbox-triage");
  disposals.push(async () => { svc.controller.abort(); await svc.done; await harness.lifecycle.dispose(); });
  const result = () => harness.behavior.callRpc("inbox.updates", {}) as Promise<{ updates: { headline: string; read: boolean; at: number }[]; degraded: boolean }>;
  const emit = async (text = "Found three new opportunities.", at = 1000) => {
    thread = { ...thread, latestAttentionAt: at };
    await harness.behavior.emitThreadEvent("thread.idle", { thread, lastAssistantText: text });
  };
  const settled = async () => { await vi.waitFor(() => expect(bb.storage.database().prepare("SELECT count(*) AS n FROM inbox_jobs").get()).toEqual({ n: 0 }), { timeout: 3000 }); };
  return { harness, result, emit, settled, notifications, decisions, fallbackRequests, read: (at: number) => { thread = { ...thread, lastReadAt: at }; },
    remove: () => { gone = true; }, rows: () => bb.storage.database().prepare("SELECT count(*) AS n FROM inbox_updates").get() };
}

describe("automatic Inbox lifecycle", () => {
  it("collects bot results without a tool and shares thread read state", async () => {
    const f = await setup({ profile: true }); await f.emit(); await f.settled();
    expect((await f.result()).updates).toMatchObject([{ headline: "Found three new opportunities.", read: false }]);
    f.read(1000); expect((await f.result()).updates[0]?.read).toBe(true);
    await f.emit("Found four opportunities.", 2000); await f.settled();
    expect((await f.result()).updates).toMatchObject([{ headline: "Found four opportunities.", read: false, at: 2000 }]);
    expect(f.notifications).toHaveLength(0);
    await f.harness.behavior.callRpc("seen", {});
    expect((await f.result()).updates[0]?.read).toBe(true);
  });
  it("collects recurring threads and leaves ordinary threads out", async () => {
    const scheduled = await setup({ recurring: true }); await scheduled.emit(); await scheduled.settled();
    expect((await scheduled.result()).updates).toHaveLength(1);
    const plain = await setup(); await plain.emit(); await plain.settled();
    expect((await plain.result()).updates).toHaveLength(0);
  });
  it("keeps triaging when startup recovery fails, and prunes results of deleted threads", async () => {
    const f = await setup({ profile: true, listFails: true }); await f.emit(); await f.settled();
    expect((await f.result()).updates).toHaveLength(1);
    f.remove();
    expect((await f.result()).updates).toHaveLength(0);
    expect(f.rows()).toEqual({ n: 0 });
  });
  it("suppresses quiet runs, repeated replies and explicit reports without a second model call", async () => {
    const f = await setup({ profile: true });
    await f.emit(); await f.settled();
    await f.emit("Found three new opportunities.", 2000); await f.settled();
    await f.emit("Nothing new.", 3000); await f.settled();
    await f.emit('A report\n::post{id="post_a"}', 4000); await f.settled();
    expect(f.decisions).toHaveLength(1);
    expect((await f.result()).updates).toHaveLength(1);
  });
  it("uses triage and retains useful results if Decisions is unavailable", async () => {
    const quiet = await setup({ profile: true, choice: "drop" }); await quiet.emit(); await quiet.settled();
    expect((await quiet.result()).updates).toHaveLength(0);
    const offline = await setup({ profile: true, unavailable: true }); await offline.emit(); await offline.settled();
    expect(await offline.result()).toMatchObject({ updates: [{ headline: "Found three new opportunities." }], degraded: true });
  });
  it("requires a separate opt-in for urgent phone alerts", async () => {
    const off = await setup({ profile: true, choice: "urgent" }); await off.emit(); await off.settled();
    expect(off.notifications).toHaveLength(0);
    const on = await setup({ profile: true, choice: "urgent", notify: true }); await on.emit(); await on.settled();
    expect(on.notifications).toHaveLength(1);
  });
  it("uses the configured fallback when Jev fails, with a bounded result-only payload", async () => {
    const f = await setup({ profile: true, unavailable: true, fallback: '{"choice":"show","confidence":0.99}' });
    await f.emit("A".repeat(15000)); await f.settled();
    expect(await f.result()).toMatchObject({ degraded: false, updates: [{ read: false }] });
    const request = f.fallbackRequests[0]!;
    expect(request.hostId).toBe("host_test");
    const data = JSON.parse(request.prompt.split("\n").at(-1)!);
    expect(Object.keys(data)).toEqual(["title", "reply", "previous"]);
    expect(data.reply).toHaveLength(12000);
    await f.emit("New result", 2000); await f.settled();
    const next = JSON.parse(f.fallbackRequests[1]!.prompt.split("\n").at(-1)!);
    expect(next.previous).toHaveLength(6000);
  });
  it("accepts fallback drops, preserves uncertain results, and survives malformed responses", async () => {
    const drop = await setup({ profile: true, unavailable: true, fallback: '{"choice":"drop","confidence":0.99}' });
    await drop.emit(); await drop.settled();
    expect((await drop.result()).updates).toHaveLength(0);
    const uncertain = await setup({ profile: true, unavailable: true, fallback: '{"choice":"drop","confidence":0.3}' });
    await uncertain.emit(); await uncertain.settled();
    expect((await uncertain.result()).updates).toHaveLength(1);
    const malformed = await setup({ profile: true, unavailable: true, fallback: 'Done.' });
    await malformed.emit(); await malformed.settled();
    expect(await malformed.result()).toMatchObject({ degraded: true, updates: [{ read: false }] });
  });

});
