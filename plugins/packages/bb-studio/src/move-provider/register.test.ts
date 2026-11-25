import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createMoveProvider } from "./register";

const TO = "acp-antigravity-acp";

function fakeBb(options: { events?: unknown[]; automationsOn?: boolean; noHook?: boolean; refuse?: Record<string, unknown> } = {}) {
  const kv = new Map<string, unknown>();
  const rpc: { pluginId: string; method: string; input: unknown }[] = [];
  const thread = { id: "thr_a", title: "A", providerId: "claude-code", status: "idle", archivedAt: null, projectId: "proj_a" };
  const moves: { threadId: string; input: unknown }[] = [];
  const bb = {
    ...(options.noHook ? {} : {
      experimental_hooks: {
        experimental_features: { providerMove: true },
        experimental_moveThreadProvider: async (threadId: string, input: { dryRun?: boolean }) => {
          moves.push({ threadId, input });
          if (options.refuse) return { ok: false, threadId, ...options.refuse };
          return { ok: true, threadId, status: input.dryRun ? "would-move" : "moved" };
        },
      },
    }),
    storage: { kv: { get: async (key: string) => kv.get(key), set: async (key: string, value: unknown) => { kv.set(key, value); } } },
    events: { on: () => {} },
    log: { info: () => {}, warn: () => {} },
    sdk: {
      threads: {
        list: async (args: { threadIds?: string[]; archived?: boolean }) => (args.archived ? [] : args.threadIds && !args.threadIds.includes("thr_a") ? [] : [thread]),
        defaultExecutionOptions: async () => ({ model: "opus", permissionMode: "auto" }),
        events: { list: async (args: { limit?: string }) => { if (Number(args.limit) > 100) throw new Error("Thread event limit cannot exceed 100"); return options.events ?? []; } },
      },
      providers: {
        catalog: async () => [{ id: "claude-code" }, { id: TO }],
        list: async () => [{ id: TO, capabilities: { permissionModes: ["accept-edits", "full"] } }],
        models: async () => ({ models: [{ model: "gemini-3-pro", isDefault: true }] }),
      },
      projects: { list: async () => [{ id: "proj_a" }] },
      plugins: {
        list: async () => ({ plugins: options.automationsOn ? [{ id: "automations", enabled: true }] : [] }),
        callRpc: async (call: { pluginId: string; method: string; input: unknown }) => {
          rpc.push(call);
          if (call.method === "moveProvider.prepare") return { ok: true, transcriptPath: "/tmp/t.md", verbatimTurns: 1, outlinedTurns: 0, bytes: 10 };
          if (call.method === "automations_list") return [{ id: "aut_1", name: "Daily", execution: { mode: "agent", targetThreadId: "thr_a", providerId: "claude-code", model: "opus", permissionMode: "auto" } }];
          return {};
        },
      },
    },
  };
  return { bb, kv, rpc, moves };
}

function deps(bb: unknown) {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE bot_runners (id TEXT, bot_id TEXT, name TEXT, thread_id TEXT, cleanup_pending INTEGER DEFAULT 0); CREATE TABLE bot_automations (id TEXT, name TEXT, target_thread_id TEXT, provider_id TEXT, model TEXT, cleanup_pending INTEGER DEFAULT 0, updated_at INTEGER)");
  return { bb: bb as never, db, bots: () => [], botThreads: async () => [], setBotDefault: async () => {}, leadThreads: () => [] };
}

describe("createMoveProvider wiring", () => {
  it("prepares through Studio's RPC with the same historyTokens, then moves through core's hook", async () => {
    const { bb, rpc, moves } = fakeBb();
    const service = createMoveProvider(deps(bb));
    const report = await service.move({ ids: ["thr_a"], includeArchived: false, runners: false }, { to: TO, dryRun: false, automations: false, botDefaults: false, routerRules: false, historyTokens: 40000 });
    expect(report.threads[0]).toMatchObject({ result: "moved", from: { permission: "auto" }, to: { model: "gemini-3-pro", permission: "accept-edits" } });
    expect(rpc[0]).toMatchObject({ pluginId: "studio", method: "moveProvider.prepare", input: { threadId: "thr_a", from: { providerId: "claude-code", model: "opus" }, to: { providerId: TO, model: "gemini-3-pro" }, historyTokens: 40000 } });
    expect(moves).toEqual([{ threadId: "thr_a", input: { providerId: TO, model: "gemini-3-pro", permissionMode: "accept-edits", historyTokens: 40000 } }]);
  });

  it("fails clearly on a BB without the move hook, and maps the hook's refusals", async () => {
    const run = (bb: unknown) => createMoveProvider(deps(bb)).move({ ids: ["thr_a"], includeArchived: false, runners: false }, { to: TO, dryRun: false, automations: false, botDefaults: false, routerRules: false });
    expect((await run(fakeBb({ noHook: true }).bb)).threads[0]).toMatchObject({ result: "failed", reason: "core-unavailable", detail: "this BB Studio build can't move providers; update the app" });
    expect((await run(fakeBb({ refuse: { httpStatus: 409, code: "thread_busy", reason: "queued-messages", message: "queued" } }).bb)).threads[0]).toMatchObject({ result: "deferred", reason: "busy" });
    expect((await run(fakeBb({ refuse: { httpStatus: 409, code: "thread_busy", reason: "archived", message: "archived" } }).bb)).threads[0]).toMatchObject({ result: "failed", reason: "thread-archived" });
    expect((await run(fakeBb({ refuse: { httpStatus: 422, code: "model_unavailable", message: "no" } }).bb)).threads[0]).toMatchObject({ result: "failed", reason: "model-unavailable" });
    expect((await run(fakeBb({ refuse: { httpStatus: 501, code: "not_implemented", message: "stub" } }).bb)).threads[0]).toMatchObject({ result: "failed", reason: "core-unavailable" });
  });

  it("patches BB automations only when BB's automations plugin is on", async () => {
        const off = fakeBb();
    await createMoveProvider(deps(off.bb)).move({ ids: ["thr_a"], includeArchived: false, runners: false }, { to: TO, dryRun: false, automations: true, botDefaults: false, routerRules: false });
    expect(off.rpc.map((call) => call.method)).toEqual(["moveProvider.prepare"]);
    const on = fakeBb({ automationsOn: true });
    const report = await createMoveProvider(deps(on.bb)).move({ ids: ["thr_a"], includeArchived: false, runners: false }, { to: TO, dryRun: false, automations: true, botDefaults: false, routerRules: false });
    expect(report.automations[0]).toMatchObject({ automationId: "aut_1", result: "patched", to: { permission: "accept-edits" } });
    expect(on.rpc.find((call) => call.method === "automations_update")?.input).toMatchObject({ projectId: "proj_a", automationId: "aut_1", execution: { providerId: TO, model: "gemini-3-pro", permissionMode: "accept-edits", targetThreadId: "thr_a" } });
  });

  it("reads the move from a system/operation event and a turn after it", async () => {
    const move = { seq: 5, type: "system/operation", createdAt: 1, data: { operation: "thread/provider-move", metadata: { to: { providerId: TO, model: "gemini-3-pro" }, at: "2026-11-25T20:54:24.685Z" } } };
    const other = { seq: 4, type: "system/operation", data: { operation: "thread/context-clear" } };
    const pending = createMoveProvider(deps(fakeBb({ events: [move, other] }).bb));
    expect((await pending.verify(["thr_a"], { all: false }))[0]).toMatchObject({ moveEvent: true, turnStarted: false, verdict: "pending", movedTo: { providerId: TO } });
    const started = createMoveProvider(deps(fakeBb({ events: [{ seq: 6, type: "turn/started" }, move] }).bb));
    expect((await started.verify(["thr_a"], { all: false }))[0]).toMatchObject({ verdict: "pending", turnStarted: true, turnCompleted: false });
    const failed = createMoveProvider(deps(fakeBb({ events: [{ seq: 7, type: "turn/completed", data: { status: "failed" } }, { seq: 6, type: "turn/started" }, move] }).bb));
    expect((await failed.verify(["thr_a"], { all: false }))[0]).toMatchObject({ verdict: "pending", turnCompleted: false });
    const done = createMoveProvider(deps(fakeBb({ events: [{ seq: 9, type: "turn/completed", data: { status: "completed" } }, { seq: 8, type: "turn/started" }, { seq: 7, type: "turn/completed", data: { status: "failed" } }, { seq: 6, type: "turn/started" }, move] }).bb));
    expect((await done.verify(["thr_a"], { all: false }))[0]).toMatchObject({ verdict: "ok", turnStarted: true, turnCompleted: true, handoffDelivered: null });
    const none = createMoveProvider(deps(fakeBb({ events: [{ seq: 6, type: "turn/started" }, other] }).bb));
    expect((await none.verify(["thr_a"], { all: false }))[0]).toMatchObject({ verdict: "no-move-event" });
  });
});
