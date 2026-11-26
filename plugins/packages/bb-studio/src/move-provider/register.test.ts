import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { isAcpAgent } from "../provider-family";
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

  it("moves an auto thread to antigravity (family acp, no acp- prefix) with accept-edits, from BB's provider list", async () => {
    const { bb, moves } = fakeBb();
    bb.sdk.providers = {
      ...bb.sdk.providers,
      catalog: async () => [{ id: "claude-code" }, { id: "antigravity" }],
      list: async () => [{ id: "antigravity", family: "acp", capabilities: { permissionModes: ["accept-edits", "full"] } }],
      models: async () => ({ models: [{ model: "gemini-4-neon", isDefault: true }] }),
    } as typeof bb.sdk.providers;
    const report = await createMoveProvider(deps(bb)).move({ ids: ["thr_a"], includeArchived: false, runners: false }, { to: "antigravity", dryRun: false, automations: false, botDefaults: false, routerRules: false });
    expect(report.threads[0]).toMatchObject({ result: "moved", from: { permission: "auto" }, to: { providerId: "antigravity", model: "gemini-4-neon", permission: "accept-edits" } });
    expect(moves).toEqual([{ threadId: "thr_a", input: { providerId: "antigravity", model: "gemini-4-neon", permissionMode: "accept-edits", historyTokens: 150000 } }]);
    expect(isAcpAgent("antigravity")).toBe(true);
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

  it("reads the move from a system/operation event; rebuilt is core's: a real request after it, accepted", async () => {
    const move = { seq: 5, type: "system/operation", createdAt: 1, data: { operation: "thread/provider-move", metadata: { to: { providerId: TO, model: "gemini-3-pro" }, at: "2026-11-25T20:54:24.685Z" } } };
    const other = { seq: 4, type: "system/operation", data: { operation: "thread/context-clear" } };
    const verdict = async (events: unknown[]) => (await createMoveProvider(deps(fakeBb({ events }).bb)).verify(["thr_a"], { all: false }))[0];
    expect(await verdict([move, other])).toMatchObject({ moveEvent: true, turnStarted: false, verdict: "pending", movedTo: { providerId: TO } });
    // Started, not yet accepted: pending.
    expect(await verdict([{ seq: 7, type: "turn/started" }, { seq: 6, type: "client/turn/requested", data: { requestId: "r1", input: [{ type: "text", text: "hi" }] } }, move])).toMatchObject({ verdict: "pending", turnStarted: true });
    // A bare /compact accepted doesn't count.
    expect(await verdict([{ seq: 8, type: "turn/input/accepted", data: { clientRequestId: "r1" } }, { seq: 6, type: "client/turn/requested", data: { requestId: "r1", input: [{ type: "text", text: "/compact" }] } }, move])).toMatchObject({ verdict: "pending" });
    // A real request accepted (even if its turn then failed): rebuilt.
    const real = [{ seq: 9, type: "turn/completed", data: { status: "failed" } }, { seq: 8, type: "turn/input/accepted", data: { clientRequestId: "r1" } }, { seq: 7, type: "turn/started" }, { seq: 6, type: "client/turn/requested", data: { requestId: "r1", input: [{ type: "text", text: "hi" }] } }, move];
    expect(await verdict(real)).toMatchObject({ verdict: "ok", rebuilt: true, turnCompleted: false, handoffDelivered: null });
    expect(await verdict([{ seq: 4, type: "turn/started" }, other])).toMatchObject({ verdict: "no-move-event" });
    // A forced move (handoff "none") reads started, not rebuilt.
    const forced = { ...move, data: { ...move.data, metadata: { ...move.data.metadata, handoff: "none" } } };
    const service = createMoveProvider(deps(fakeBb({ events: [real[1], real[3], forced] }).bb));
    expect((await service.status(["thr_a"]))[0]!.core).toBe("started");
  });
;
});

describe("verify --probe wiring", () => {
  it("waits for the root turn that started after the probe was sent, not the running one or a subagent's", async () => {
    const before = [{ seq: 1, type: "turn/started" }, { seq: 2, type: "item/completed", data: { item: { type: "userMessage", text: "earlier" } } }];
    const after = [
      { seq: 3, type: "item/completed", data: { item: { type: "agentMessage", text: "the running turn's answer" } } },
      { seq: 4, type: "turn/completed", data: { status: "completed" } },
      // A subagent's turn inside the running turn: not the probe's.
      { seq: 4.2, type: "turn/started", parentToolCallId: "call_sub" },
      { seq: 4.4, type: "item/completed", data: { item: { type: "agentMessage", text: "a subagent's note", parentToolCallId: "call_sub" } } },
      { seq: 4.6, type: "turn/completed", parentToolCallId: "call_sub", data: { status: "completed" } },
      { seq: 5, type: "turn/started" },
      { seq: 6, type: "item/completed", data: { item: { type: "agentMessage", text: "the probe's answer" } } },
      { seq: 7, type: "turn/completed", data: { status: "completed" } },
    ];
    let sent = false;
    const { bb } = fakeBb();
    const all = () => (sent ? [...before, ...after] : before) as { seq: number; type: string }[];
    Object.assign(bb.sdk.threads, {
      send: async () => { sent = true; return {}; },
      events: {
        list: async (args: { order?: string; limit?: string; types?: string[]; afterSeq?: string }) => {
          let rows = all().filter((row) => (!args.types || args.types.includes(row.type)) && (!args.afterSeq || row.seq > Number(args.afterSeq)));
          if (args.order === "desc") rows = [...rows].reverse();
          return rows.slice(0, Number(args.limit ?? 100));
        },
        wait: async (args: { type: string; afterSeq?: string }) => all().find((row) => row.type === args.type && (!args.afterSeq || row.seq > Number(args.afterSeq))) ?? null,
      },
    });
    const service = createMoveProvider(deps(bb));
    const [row] = await service.verify(["thr_a"], { all: false, probe: "first words?" });
    expect(row!.probe).toEqual({ answer: "the probe's answer" });
  });
});
