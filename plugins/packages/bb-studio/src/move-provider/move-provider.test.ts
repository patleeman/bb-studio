import { describe, expect, it, vi } from "vitest";
import { scopeTools } from "../tool-scope";
import { ToolDeliveryStore, TOOL_DELIVERY_KEY } from "../tool-delivery";
import { botCli, moveProviderCli, runnerCli, toolDeliveryCli } from "./cli";
import { coreOutcome, LEDGER_KEY, parseLedger, rewriteRouterPolicy, targetPermission, type CoreMoveBody, type PermissionMode, type RouterPolicy } from "./core";
import { MoveProviderService, type BbAutomation, type BotRef, type MoveDeps, type StudioAutomation, type ThreadInfo } from "./service";

const TO = "acp-antigravity-acp";
const MODEL = "gemini-3-pro";
// provider-antigravity: a plugin provider (family "acp") that declares accept-edits and full, not auto.
const AG = "antigravity";
const AG_MODEL = "gemini-4-neon";
const AG_MODES: PermissionMode[] = ["accept-edits", "full"];

function thread(id: string, extra: Partial<ThreadInfo> = {}): ThreadInfo {
  return { id, title: `Thread ${id}`, providerId: "claude-code", model: "opus", permission: "accept-edits", status: "idle", archived: false, projectId: "proj_a", ...extra };
}

/** A fake BB and Studio: threads, the core route, W2's prepare, automations, Bots, runners, router and KV. */
function world(threads: ThreadInfo[], options: { busy?: string[]; modelMissingOn?: string[]; coreMissing?: boolean; prepareFails?: string[] } = {}) {
  const store = new Map(threads.map((each) => [each.id, { ...each }]));
  const kv = new Map<string, unknown>();
  const calls = { core: [] as { threadId: string; body: CoreMoveBody }[], prepare: [] as string[], bbUpdates: [] as string[], studioUpdates: [] as string[], botDefaults: [] as string[], asks: [] as string[] };
  const moves = new Map<string, { seq: number; turnStarted: boolean; turnCompleted?: boolean; to: { providerId: string; model: string } }>();
  const busy = new Set(options.busy ?? []);
  const bbAutomations: BbAutomation[] = [];
  const studioAutomations: StudioAutomation[] = [];
  const bots: BotRef[] = [{ id: "bot_1", name: "Chief", threadId: "main", defaultModel: { providerId: "claude-code", model: "opus" } }];
  const runners = [{ id: "run_1", botId: "bot_1", name: "Comms", threadId: "r1" }];
  let policy: RouterPolicy = { rules: [{ id: "code", chain: [{ providerId: "claude-code", model: "opus", reasoningLevel: null }, { providerId: "codex", model: "gpt", reasoningLevel: null }] }], defaultChain: [{ providerId: "claude-code", model: "sonnet", reasoningLevel: null }] };
  let failNextBbUpdate = false;
  let failNextBotDefault = false;
  const deps: MoveDeps = {
    kv: { get: (key) => kv.get(key), set: (key, value) => { kv.set(key, JSON.parse(JSON.stringify(value))); } },
    listThreads: async ({ providerId, projectId, includeArchived }) => [...store.values()].filter((each) => (!providerId || each.providerId === providerId) && (!projectId || each.projectId === projectId) && (includeArchived || !each.archived)).map((each) => ({ ...each })),
    getThreads: async (ids) => ids.flatMap((id) => store.has(id) ? [{ ...store.get(id)! }] : []),
    bots: () => bots,
    botThreads: async () => ["main", "w1"],
    runnerThreads: (botId) => runners.filter((each) => !botId || each.botId === botId),
    leadThreads: async () => ["lead"],
    target: async (providerId) => providerId === AG ? { known: true, ready: true, models: [AG_MODEL], defaultModel: AG_MODEL, permissionModes: AG_MODES } : providerId === TO ? { known: true, ready: true, models: [MODEL, "gemini-flash"], defaultModel: MODEL, permissionModes: null } : providerId === "claude-code" ? { known: true, ready: true, models: ["opus", "sonnet"], defaultModel: "opus", permissionModes: null } : { known: false, ready: false, models: [], defaultModel: null, permissionModes: null },
    coreMove: async (threadId, body) => {
      calls.core.push({ threadId, body });
      if (options.coreMissing) return { status: 404, body: null };
      if (busy.has(threadId)) return { status: 409, body: { code: "thread_busy" } };
      if (options.modelMissingOn?.includes(threadId)) return { status: 422, body: { code: "model_unavailable", message: "not on this machine" } };
      const current = store.get(threadId)!;
      if (current.providerId === body.providerId && current.model === body.model) return { status: 200, body: { status: "already-moved" } };
      if (body.dryRun) return { status: 200, body: { status: "would-move" } };
      store.set(threadId, { ...current, providerId: body.providerId, model: body.model, permission: body.permissionMode ?? current.permission });
      moves.set(threadId, { seq: 10, turnStarted: false, to: { providerId: body.providerId, model: body.model } });
      return { status: 200, body: { status: "moved" } };
    },
    prepare: async (threadId) => {
      calls.prepare.push(threadId);
      if (options.prepareFails?.includes(threadId)) return { ok: false, error: "too big" };
      return { ok: true, transcriptPath: `/tmp/${threadId}.md`, verbatimTurns: 3, outlinedTurns: 1, bytes: 1200 };
    },
    bbAutomations: async () => bbAutomations.map((each) => ({ ...each, execution: { ...each.execution } })),
    updateBbAutomation: async (automation, execution) => {
      if (failNextBbUpdate) { failNextBbUpdate = false; throw new Error("automations plugin went away"); }
      calls.bbUpdates.push(automation.id);
      bbAutomations.find((each) => each.id === automation.id)!.execution = execution;
    },
    studioAutomations: (ids) => studioAutomations.filter((each) => ids.includes(each.threadId)),
    setStudioAutomationModel: (id, providerId, model) => { calls.studioUpdates.push(id); Object.assign(studioAutomations.find((each) => each.id === id)!, { providerId, model }); },
    setBotDefault: async (botId, providerId, model) => {
      if (failNextBotDefault) { failNextBotDefault = false; throw new Error("bots table locked"); }
      calls.botDefaults.push(botId); bots.find((each) => each.id === botId)!.defaultModel = { providerId, model };
    },
    router: { get: async () => policy, set: async (next) => { policy = next; } },
    moveEvents: async (threadId) => { const move = moves.get(threadId); return { move: move ? { seq: move.seq, at: 1, to: move.to } : null, turnStarted: !!move?.turnStarted, turnCompleted: !!move?.turnCompleted, inputAccepted: !!move?.turnCompleted }; },
    handoffDelivered: async () => true,
    ask: async (threadId, question) => { calls.asks.push(threadId); return `answer to ${question}`; },
    now: () => 1000,
  };
  const service = new MoveProviderService(deps);
  return {
    service, store, kv, calls, moves, busy, bbAutomations, studioAutomations, bots, runners, deps,
    get policy() { return policy; },
    failNextBbUpdate: () => { failNextBbUpdate = true; },
    failNextBotDefault: () => { failNextBotDefault = true; },
    cli: (argv: string[], callerThreadId: string | null = null) => moveProviderCli(argv, { service, toolDelivery: new ToolDeliveryStore({ get: () => undefined, set: () => {} }), callerThreadId }),
  };
}

const base = { dryRun: false, automations: true, botDefaults: false, routerRules: false } as const;
const parse = (out: { stdout?: string }) => JSON.parse(out.stdout ?? "null");

/**
 * Core's rule (desktop: resolveMovePermissionMode in
 * apps/server/src/services/threads/thread-provider-move.fork.ts, the
 * `provider-move` seam in STUDIO_FORK.md), copied so Studio's choice is
 * checked against what core accepts. Throws where core answers 422.
 */
function coreMovePermission(args: { current: PermissionMode; requested: PermissionMode | undefined; supported: readonly PermissionMode[] | null; ceiling: PermissionMode }): PermissionMode {
  const rank = (mode: PermissionMode) => ["accept-edits", "auto", "full"].indexOf(mode);
  const supported = args.supported && args.supported.length > 0 ? args.supported : null;
  if (args.requested !== undefined) {
    if (rank(args.requested) > rank(args.current) && args.requested !== "full") throw new Error("permission_widening");
    if (rank(args.requested) > rank(args.ceiling)) throw new Error("permission_widening");
    if (supported !== null && !supported.includes(args.requested)) throw new Error("permission_unsupported");
    return args.requested;
  }
  const limit = rank(args.ceiling) < rank(args.current) ? args.ceiling : args.current;
  const chosen = (supported ?? [limit]).filter((mode) => rank(mode) <= rank(limit)).sort((a, b) => rank(b) - rank(a))[0];
  if (chosen === undefined) throw new Error("permission_unsupported");
  return chosen;
}

describe("moving to antigravity (a provider plugin of the ACP family, no acp- prefix)", () => {
  it("lands an auto thread on accept-edits from the declared modes alone, never full", () => {
    expect(targetPermission("auto", null, AG, AG_MODES)).toEqual({ ok: true, mode: "accept-edits" });
    expect(targetPermission("full", null, AG, AG_MODES)).toEqual({ ok: true, mode: "accept-edits" });
    expect(targetPermission("accept-edits", null, AG, AG_MODES)).toEqual({ ok: true, mode: "accept-edits" });
    expect(targetPermission("auto", "auto", AG, AG_MODES)).toMatchObject({ ok: true, mode: "accept-edits" });
    expect(targetPermission("auto", "full", AG, AG_MODES)).toMatchObject({ ok: false, reason: "permission-widening" });
    expect(targetPermission("full", "full", AG, AG_MODES)).toEqual({ ok: true, mode: "full" });
  });

  it("matches core's route: core takes Studio's mode as asked, and lands auto on accept-edits on its own", () => {
    for (const current of ["accept-edits", "auto", "full"] as const) {
      const studio = targetPermission(current, null, AG, AG_MODES);
      expect(studio.ok).toBe(true);
      if (!studio.ok) continue;
      expect(studio.mode).not.toBe("full");
      expect(coreMovePermission({ current, requested: studio.mode, supported: AG_MODES, ceiling: "full" })).toBe(studio.mode);
    }
    expect(coreMovePermission({ current: "auto", requested: undefined, supported: AG_MODES, ceiling: "full" })).toBe("accept-edits");
    expect(() => coreMovePermission({ current: "auto", requested: "auto", supported: AG_MODES, ceiling: "full" })).toThrow("permission_unsupported");
    expect(() => coreMovePermission({ current: "auto", requested: "full", supported: AG_MODES, ceiling: "accept-edits" })).toThrow("permission_widening");
  });

  it("moves an auto thread end to end: core gets accept-edits, the thread and its automation never full", async () => {
    const w = world([thread("a", { permission: "auto" }), thread("b", { permission: "full" })]);
    w.bbAutomations.push({ id: "aut_1", projectId: "p", name: "Daily", execution: { mode: "agent", targetThreadId: "a", providerId: "claude-code", model: "opus", permissionMode: "auto", prompt: "go" } });
    const report = await w.service.move({ ids: ["a", "b"], includeArchived: false, runners: false }, { ...base, to: AG });
    expect(report.threads.map((each) => [each.threadId, each.result, each.to.permission])).toEqual([["a", "moved", "accept-edits"], ["b", "moved", "accept-edits"]]);
    expect(w.calls.core.map((each) => each.body)).toEqual([
      { providerId: AG, model: AG_MODEL, permissionMode: "accept-edits", historyTokens: 150000 },
      { providerId: AG, model: AG_MODEL, permissionMode: "accept-edits", historyTokens: 150000 },
    ]);
    expect(w.store.get("a")!.permission).toBe("accept-edits");
    expect(w.store.get("b")!.permission).toBe("accept-edits");
    expect(w.bbAutomations[0]!.execution).toMatchObject({ providerId: AG, model: AG_MODEL, permissionMode: "accept-edits" });
  });

  it("narrows --permission auto to accept-edits, so core never sees an auto it would refuse", async () => {
    const w = world([thread("a", { permission: "auto" })]);
    const out = parse(await w.cli(["a", "--to", AG, "--permission", "auto", "--json"]));
    expect(out.threads[0]).toMatchObject({ result: "moved", to: { permission: "accept-edits" } });
    expect(w.calls.core[0]!.body.permissionMode).toBe("accept-edits");
  });
});

describe("targetPermission: never wider", () => {
  it("lowers auto to accept-edits on an ACP target and steps full down without an explicit mode", () => {
    expect(targetPermission("auto", null, TO)).toEqual({ ok: true, mode: "accept-edits" });
    expect(targetPermission("auto", null, "codex")).toEqual({ ok: true, mode: "auto" });
    expect(targetPermission("full", null, "codex")).toEqual({ ok: true, mode: "auto" });
    expect(targetPermission("full", null, TO)).toEqual({ ok: true, mode: "accept-edits" });
    expect(targetPermission("accept-edits", null, TO)).toEqual({ ok: true, mode: "accept-edits" });
    expect(targetPermission(null, null, "codex")).toEqual({ ok: true, mode: "accept-edits" });
  });
  it("takes full only when asked for and the thread is full now", () => {
    expect(targetPermission("full", "full", TO)).toEqual({ ok: true, mode: "full" });
    expect(targetPermission("auto", "full", TO)).toMatchObject({ ok: false, reason: "permission-widening" });
    expect(targetPermission("accept-edits", "auto", "codex")).toMatchObject({ ok: false, reason: "permission-widening" });
    expect(targetPermission(null, "auto", "codex")).toMatchObject({ ok: false, reason: "permission-widening" });
  });
  it("narrows to a mode the target offers", () => {
    expect(targetPermission("full", "full", "x", ["accept-edits", "auto"])).toEqual({ ok: true, mode: "auto" });
    expect(targetPermission("accept-edits", null, "x", ["full"])).toMatchObject({ ok: false, reason: "permission-unsupported" });
  });
});

describe("coreOutcome", () => {
  it("maps the route's answers", () => {
    expect(coreOutcome({ status: 200, body: { status: "moved" } })).toEqual({ kind: "done", result: "moved" });
    expect(coreOutcome({ status: 409, body: { code: "thread_busy" } })).toEqual({ kind: "busy" });
    expect(coreOutcome({ status: 422, body: { code: "provider_unavailable" } })).toMatchObject({ kind: "failed", reason: "provider-unavailable-on-machine" });
    expect(coreOutcome({ status: 422, body: { code: "permission_widening" } })).toMatchObject({ kind: "failed", reason: "permission-widening" });
    expect(coreOutcome({ status: 422, body: { code: "permission_unsupported" } })).toMatchObject({ kind: "failed", reason: "permission-unsupported" });
    expect(coreOutcome({ status: 409, body: { code: "thread_busy", reason: "changed" } })).toEqual({ kind: "busy" });
    expect(coreOutcome({ status: 422, body: { code: "no_handoff_handler", message: "no plugin carries the handoff" } })).toEqual({ kind: "failed", reason: "no-handoff-handler", detail: "no plugin carries the handoff" });
    expect(coreOutcome({ status: 404, body: null })).toMatchObject({ kind: "failed", reason: "core-unavailable" });
    expect(coreOutcome({ status: 500, body: { message: "boom" } })).toMatchObject({ kind: "failed", reason: "core-error", detail: "HTTP 500: boom" });
  });
});

describe("selectors", () => {
  const threads = () => [thread("a"), thread("b", { projectId: "proj_b" }), thread("c", { providerId: "codex", model: "gpt" }), thread("old", { archived: true }), thread("main"), thread("r1"), thread("w1")];

  it("--from picks that provider's threads, leaves archived out and puts Main last", async () => {
    const w = world(threads());
    const { threads: picked, roles } = await w.service.select({ ids: [], from: "claude-code", includeArchived: false, runners: false });
    expect(picked.map((each) => each.id)).toEqual(["a", "b", "r1", "w1", "main"]);
    expect(roles.get("main")).toBe("main");
    expect(roles.get("r1")).toBe("runner");
  });

  it("--include-archived adds archived threads; an archived id counts without it", async () => {
    const w = world(threads());
    expect((await w.service.select({ ids: [], from: "claude-code", includeArchived: true, runners: false })).threads.map((each) => each.id)).toContain("old");
    expect((await w.service.select({ ids: ["old"], includeArchived: false, runners: false })).threads.map((each) => each.id)).toEqual(["old"]);
  });

  it("--project, --bot and --runners narrow or select", async () => {
    const w = world(threads());
    expect((await w.service.select({ ids: [], from: "claude-code", projectId: "proj_b", includeArchived: false, runners: false })).threads.map((each) => each.id)).toEqual(["b"]);
    expect((await w.service.select({ ids: [], bot: "chief", includeArchived: false, runners: false })).threads.map((each) => each.id)).toEqual(["w1", "main"]);
    expect((await w.service.select({ ids: [], runners: true, includeArchived: false })).threads.map((each) => each.id)).toEqual(["r1"]);
    expect((await w.service.select({ ids: [], from: "claude-code", bot: "bot_1", runners: true, includeArchived: false })).threads.map((each) => each.id)).toEqual(["r1", "w1", "main"]);
  });

  it("refuses nothing selected, an unknown Bot and an unknown id (exit 1)", async () => {
    const w = world(threads());
    expect((await w.cli(["--to", TO])).exitCode).toBe(1);
    expect((await w.cli(["--bot", "nobody", "--to", TO])).exitCode).toBe(1);
    expect((await w.cli(["nope", "--to", TO])).exitCode).toBe(1);
    expect((await w.cli(["a", "--to", "no-such-provider"])).exitCode).toBe(1);
    expect((await w.cli(["a", "--to", TO, "--model", "nope"])).exitCode).toBe(1);
    expect((await w.cli(["a"])).exitCode).toBe(1);
    expect((await w.cli(["a", "--to", TO, "--permission", "root"])).exitCode).toBe(1);
    expect((await w.cli(["a", "--to", TO, "--bogus"])).exitCode).toBe(1);
    const zero = await w.cli(["a", "--to", TO, "--history-tokens", "0"]);
    expect(zero).toMatchObject({ exitCode: 1 });
    expect(zero.stderr).toContain("from 1 to");
    await expect(w.service.move({ ids: ["a"], includeArchived: false, runners: false }, { ...base, to: TO, historyTokens: 0 })).rejects.toThrow("at least 1");
    expect(w.calls.core).toEqual([]);
  });
});

describe("move", () => {
  it("dry run lists exactly what the real run does, and changes nothing", async () => {
    const threads = [thread("a"), thread("b", { permission: "auto" }), thread("busy1", { status: "active" }), thread("done", { providerId: TO, model: MODEL }), thread("main")];
    const dry = world(threads);
    const real = world(threads);
    dry.bbAutomations.push({ id: "aut_1", projectId: "p", name: "Daily", execution: { mode: "agent", targetThreadId: "a", providerId: "claude-code", model: "opus", permissionMode: "auto" } });
    real.bbAutomations.push({ id: "aut_1", projectId: "p", name: "Daily", execution: { mode: "agent", targetThreadId: "a", providerId: "claude-code", model: "opus", permissionMode: "auto" } });
    const dryOut = parse(await dry.cli(["--from", "claude-code", "a", "done", "--to", TO, "--automations", "--dry-run", "--json"]));
    const realOut = parse(await real.cli(["--from", "claude-code", "a", "done", "--to", TO, "--automations", "--json"]));
    const shape = (report: { threads: { threadId: string; result: string; reason?: string; to: unknown }[]; automations: { automationId: string; result: string }[] }) => ({
      threads: report.threads.map((each) => [each.threadId, each.result === "would-move" ? "moved" : each.result, each.reason ?? null, each.to]),
      automations: report.automations.map((each) => [each.automationId, each.result === "would-patch" ? "patched" : each.result]),
    });
    expect(shape(dryOut)).toEqual(shape(realOut));
    expect(dryOut.threads.map((each: { threadId: string; result: string }) => [each.threadId, each.result])).toEqual([["a", "would-move"], ["b", "would-move"], ["busy1", "deferred"], ["done", "already-moved"], ["main", "would-move"]]);
    // Nothing changed in the dry world.
    expect(dry.calls.prepare).toEqual([]);
    expect(dry.calls.bbUpdates).toEqual([]);
    expect(dry.kv.get(LEDGER_KEY)).toBeUndefined();
    expect(dry.store.get("a")!.providerId).toBe("claude-code");
    expect(dry.calls.core.every((each) => each.body.dryRun)).toBe(true);
  });

  it("moves: handoff first, then core with a lowered permission; patches automations; records the ledger", async () => {
    const w = world([thread("a", { permission: "auto" })]);
    w.bbAutomations.push({ id: "aut_1", projectId: "p", name: "Daily", execution: { mode: "agent", targetThreadId: "a", providerId: "claude-code", model: "opus", permissionMode: "auto", prompt: "go" } });
    w.bbAutomations.push({ id: "aut_other", projectId: "p", name: "Else", execution: { mode: "agent", targetThreadId: "zzz", providerId: "claude-code", model: "opus" } });
    w.studioAutomations.push({ id: "sa_1", name: "Check-in", threadId: "a", providerId: "claude-code", model: "haiku" }, { id: "sa_2", name: "Plain", threadId: "a", providerId: null, model: null });
    const report = await w.service.move({ ids: ["a"], includeArchived: false, runners: false }, { ...base, to: TO });
    expect(report.threads[0]).toMatchObject({ threadId: "a", result: "moved", from: { providerId: "claude-code", model: "opus", permission: "auto" }, to: { providerId: TO, model: MODEL, permission: "accept-edits" }, handoff: { transcriptPath: "/tmp/a.md", bytes: 1200 }, automationsPatched: ["aut_1", "sa_1"] });
    expect(w.calls.prepare).toEqual(["a"]);
    expect(w.calls.core[0]!.body).toEqual({ providerId: TO, model: MODEL, permissionMode: "accept-edits", historyTokens: 150000 });
    expect(w.bbAutomations[0]!.execution).toMatchObject({ providerId: TO, model: MODEL, permissionMode: "accept-edits", prompt: "go", targetThreadId: "a" });
    expect(w.bbAutomations[1]!.execution.providerId).toBe("claude-code");
    expect(w.studioAutomations[0]).toMatchObject({ providerId: TO, model: MODEL });
    expect(w.studioAutomations[1]).toMatchObject({ providerId: null, model: null });
    expect(parseLedger(w.kv.get(LEDGER_KEY)).a).toMatchObject({ state: "moved", attempts: 1, from: { providerId: "claude-code", model: "opus" }, request: { providerId: TO, model: MODEL, historyTokens: 150000 } });
  });

  it("passes --model, --permission and --history-tokens through; refuses widening before any side effect", async () => {
    const w = world([thread("a", { permission: "full" }), thread("b", { permission: "accept-edits" })]);
    const out = parse(await w.cli(["a", "b", "--to", TO, "--model", "gemini-flash", "--permission", "full", "--history-tokens", "50000", "--json"]));
    expect(out.threads.find((each: { threadId: string }) => each.threadId === "a")).toMatchObject({ result: "moved", to: { model: "gemini-flash", permission: "full" } });
    expect(out.threads.find((each: { threadId: string }) => each.threadId === "b")).toMatchObject({ result: "failed", reason: "permission-widening" });
    expect(w.calls.core.map((each) => each.threadId)).toEqual(["a"]);
    expect(w.calls.prepare).toEqual(["a"]);
    expect(w.calls.core[0]!.body).toMatchObject({ historyTokens: 50000, model: "gemini-flash", permissionMode: "full" });
  });

  it("never widens an automation's permission past its own", async () => {
    const w = world([thread("a", { permission: "full" })]);
    w.bbAutomations.push({ id: "aut_1", projectId: "p", name: "Daily", execution: { mode: "agent", targetThreadId: "a", providerId: "claude-code", model: "opus", permissionMode: "accept-edits" } });
    await w.service.move({ ids: ["a"], includeArchived: false, runners: false }, { ...base, to: TO, permission: "full" });
    expect(w.bbAutomations[0]!.execution.permissionMode).toBe("accept-edits");
  });

  it("a re-run is all already-moved, exit 0, with no new core calls, handoffs or patches", async () => {
    const w = world([thread("a"), thread("b")]);
    w.bbAutomations.push({ id: "aut_1", projectId: "p", name: "Daily", execution: { mode: "agent", targetThreadId: "a", providerId: "claude-code", model: "opus", permissionMode: "accept-edits" } });
    const first = await w.cli(["--from", "claude-code", "--to", TO, "--automations", "--json"]);
    expect(first.exitCode).toBe(0);
    const before = { core: w.calls.core.length, prepare: w.calls.prepare.length, bb: w.calls.bbUpdates.length };
    const second = await w.cli(["a", "b", "--to", TO, "--automations", "--json"]);
    expect(second.exitCode).toBe(0);
    expect(parse(second).threads.map((each: { result: string }) => each.result)).toEqual(["already-moved", "already-moved"]);
    expect(parse(second).automations.map((each: { result: string }) => each.result)).toEqual(["unchanged"]);
    expect({ core: w.calls.core.length, prepare: w.calls.prepare.length, bb: w.calls.bbUpdates.length }).toEqual(before);
    // The ledger keeps "moved" for threads this ledger moved.
    expect(parseLedger(w.kv.get(LEDGER_KEY)).a!.state).toBe("moved");
  });

  it("resumes after a crash between the core move and a patch", async () => {
    const w = world([thread("a")]);
    w.bbAutomations.push({ id: "aut_1", projectId: "p", name: "Daily", execution: { mode: "agent", targetThreadId: "a", providerId: "claude-code", model: "opus", permissionMode: "accept-edits" } });
    w.failNextBbUpdate();
    const first = await w.cli(["a", "--to", TO, "--automations", "--json"]);
    expect(first.exitCode).toBe(2);
    expect(parse(first).automations[0]).toMatchObject({ automationId: "aut_1", result: "failed" });
    const second = await w.cli(["a", "--to", TO, "--automations", "--json"]);
    expect(second.exitCode).toBe(0);
    expect(parse(second).threads[0].result).toBe("already-moved");
    expect(parse(second).automations[0]).toMatchObject({ result: "patched" });
    expect(w.calls.bbUpdates).toEqual(["aut_1"]);
    expect(w.calls.prepare).toEqual(["a"]);
  });

  it("a failed handoff leaves the thread where it was; the re-run retries it", async () => {
    const w = world([thread("a")], { prepareFails: ["a"] });
    const out = await w.cli(["a", "--to", TO, "--json"]);
    expect(out.exitCode).toBe(2);
    expect(parse(out).threads[0]).toMatchObject({ result: "failed", reason: "handoff-failed" });
    expect(w.calls.core).toEqual([]);
    expect(parseLedger(w.kv.get(LEDGER_KEY)).a).toMatchObject({ state: "failed", attempts: 1 });
  });

  it("a model missing on one machine fails that thread only (exit 2)", async () => {
    const w = world([thread("a"), thread("b")], { modelMissingOn: ["b"] });
    const out = await w.cli(["a", "b", "--to", TO, "--json"]);
    expect(out.exitCode).toBe(2);
    expect(parse(out).threads.map((each: { result: string; reason?: string }) => [each.result, each.reason ?? null])).toEqual([["moved", null], ["failed", "model-unavailable"]]);
    expect(parse(out).summary).toEqual({ moved: 1, alreadyMoved: 0, wouldMove: 0, deferred: 0, skipped: 0, failed: 1 });
  });

  it("says plainly when BB has no move route yet", async () => {
    const w = world([thread("a")], { coreMissing: true });
    expect(parse(await w.cli(["a", "--to", TO, "--json"])).threads[0]).toMatchObject({ result: "failed", reason: "core-unavailable" });
  });

  it("never moves the thread it runs in", async () => {
    const w = world([thread("a"), thread("me")]);
    const out = parse(await w.cli(["a", "me", "--to", TO, "--json"], "me"));
    expect(out.threads.find((each: { threadId: string }) => each.threadId === "me")).toMatchObject({ result: "skipped", reason: "current-thread" });
    expect(w.calls.core.map((each) => each.threadId)).toEqual(["a"]);
  });

  it("sets Bot defaults and rewrites router rules when asked", async () => {
    const w = world([thread("a")]);
    const out = parse(await w.cli(["--from", "claude-code", "--to", TO, "--bot-defaults", "--router-rules", "--json"]));
    expect(out.botDefaults).toEqual([{ botId: "bot_1", name: "Chief", from: { providerId: "claude-code", model: "opus" }, to: { providerId: TO, model: MODEL }, result: "patched" }]);
    expect(out.router).toEqual({ result: "patched", targetsChanged: 2 });
    expect(w.policy.rules[0]!.chain.map((each) => each.providerId)).toEqual([TO, "codex"]);
    expect(w.policy.defaultChain).toEqual([{ providerId: TO, model: MODEL, reasoningLevel: null }]);
  });
});

describe("defer and the watcher", () => {
  it("defers a running thread and moves it once idle", async () => {
    const w = world([thread("a", { status: "active" })]);
    w.bbAutomations.push({ id: "aut_1", projectId: "p", name: "Daily", execution: { mode: "agent", targetThreadId: "a", providerId: "claude-code", model: "opus", permissionMode: "accept-edits" } });
    const out = await w.cli(["a", "--to", TO, "--automations", "--json"]);
    expect(out.exitCode).toBe(2);
    expect(parse(out).threads[0]).toMatchObject({ result: "deferred", reason: "running" });
    expect(parseLedger(w.kv.get(LEDGER_KEY)).a!.state).toBe("deferred");
    expect(w.calls.core).toEqual([]);
    w.store.get("a")!.status = "idle";
    const item = await w.service.onIdle("a");
    expect(item).toMatchObject({ result: "moved", automationsPatched: ["aut_1"] });
    expect(parseLedger(w.kv.get(LEDGER_KEY)).a!.state).toBe("moved");
    expect(w.bbAutomations[0]!.execution.providerId).toBe(TO);
    // Nothing deferred any more: a later idle does nothing.
    expect(await w.service.onIdle("a")).toBeNull();
  });

  it("a thread core calls busy stays deferred until it isn't; --no-defer skips instead", async () => {
    const w = world([thread("a"), thread("b", { status: "active" })], { busy: ["a"] });
    const out = parse(await w.cli(["a", "--to", TO, "--json"]));
    expect(out.threads[0]).toMatchObject({ result: "deferred", reason: "busy" });
    expect(await w.service.onIdle("a")).toMatchObject({ result: "deferred" });
    w.busy.delete("a");
    expect(await w.service.onIdle("a")).toMatchObject({ result: "moved" });
    const skipped = parse(await w.cli(["b", "--to", TO, "--no-defer", "--json"]));
    expect(skipped.threads[0]).toMatchObject({ result: "skipped", reason: "running" });
    expect(parseLedger(w.kv.get(LEDGER_KEY)).b).toBeUndefined();
  });

  it("claims nothing new after dispose, and finishes a move it already claimed", async () => {
    const w = world([thread("a", { status: "active" }), thread("b", { status: "active" })]);
    await w.cli(["a", "b", "--to", TO, "--json"]);
    w.store.get("a")!.status = "idle";
    w.store.get("b")!.status = "idle";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const prepare = w.deps.prepare;
    w.deps.prepare = async (threadId, input) => { await gate; return prepare(threadId, input); };
    const claimed = w.service.onIdle("a");
    await new Promise((resolve) => setTimeout(resolve, 10));
    w.service.dispose();
    release();
    expect(await claimed).toMatchObject({ result: "moved" });
    expect(await w.service.onIdle("b")).toBeNull();
    expect(parseLedger(w.kv.get(LEDGER_KEY)).b!.state).toBe("deferred");
  });

  it("sweep moves deferred threads that went idle while nothing watched", async () => {
    const w = world([thread("a", { status: "active" })]);
    await w.cli(["a", "--to", TO, "--json"]);
    w.store.get("a")!.status = "idle";
    const fresh = new MoveProviderService(w.deps);
    expect((await fresh.sweep()).map((each) => each.result)).toEqual(["moved"]);
  });

  it("two threads finishing together both land in the ledger", async () => {
    const w = world([thread("a", { status: "active" }), thread("b", { status: "active" })]);
    await w.cli(["a", "b", "--to", TO, "--json"]);
    w.store.get("a")!.status = "idle";
    w.store.get("b")!.status = "idle";
    await Promise.all([w.service.onIdle("a"), w.service.onIdle("b")]);
    const ledger = parseLedger(w.kv.get(LEDGER_KEY));
    expect([ledger.a!.state, ledger.b!.state]).toEqual(["moved", "moved"]);
  });
});

describe("runners and Bots", () => {
  it("runner move-provider moves a runner's thread and patches its automation", async () => {
    const w = world([thread("r1", { permission: "auto" })]);
    w.bbAutomations.push({ id: "aut_r", projectId: "p", name: "Comms runner", execution: { mode: "agent", targetThreadId: "r1", providerId: "claude-code", model: "opus", permissionMode: "auto" } });
    const deps = { service: w.service, toolDelivery: new ToolDeliveryStore({ get: () => undefined, set: () => {} }), callerThreadId: null, runners: (bot?: string) => w.service.runners(bot) };
    const out = await runnerCli(["move-provider", "comms", "--to", TO, "--json"], deps);
    expect(out.exitCode).toBe(0);
    expect(parse(out).threads[0]).toMatchObject({ threadId: "r1", role: "runner", result: "moved", to: { permission: "accept-edits" } });
    expect(w.bbAutomations[0]!.execution).toMatchObject({ providerId: TO, model: MODEL, permissionMode: "accept-edits" });
    expect((await runnerCli(["move-provider", "nobody", "--to", TO], deps)).exitCode).toBe(1);
    expect((await runnerCli(["move-provider", "--to", TO], deps)).exitCode).toBe(1);
    expect((await runnerCli(["move-provider", "--all", "--bot", "ghost", "--to", TO], deps)).exitCode).toBe(1);
  });

  it("bot set-model sets one Bot's default model (dry run first)", async () => {
    const w = world([]);
    const deps = { service: w.service, toolDelivery: new ToolDeliveryStore({ get: () => undefined, set: () => {} }), callerThreadId: null };
    expect(parse(await botCli(["set-model", "Chief", "--provider", TO, "--dry-run", "--json"], deps))).toMatchObject({ result: "would-patch", to: { providerId: TO, model: MODEL } });
    expect(w.calls.botDefaults).toEqual([]);
    expect(parse(await botCli(["set-model", "Chief", "--provider", TO, "--model", "gemini-flash", "--json"], deps))).toMatchObject({ result: "patched", to: { model: "gemini-flash" } });
    expect(w.bots[0]!.defaultModel).toEqual({ providerId: TO, model: "gemini-flash" });
    expect((await botCli(["set-model", "Nobody", "--provider", TO], deps)).exitCode).toBe(1);
    expect((await botCli(["set-model", "Chief"], deps)).exitCode).toBe(1);
  });
});

describe("status and verify", () => {
  it("status joins the ledger and the event log", async () => {
    const w = world([thread("a"), thread("b", { status: "active" })]);
    await w.cli(["a", "b", "--to", TO, "--json"]);
    const out = await w.cli(["status", "--json"]);
    expect(out.exitCode).toBe(2);
    const body = parse(out);
    expect(body.counts).toEqual({ moved: 1, deferred: 1 });
    expect(body.threads.find((each: { threadId: string }) => each.threadId === "a")).toMatchObject({ ledger: "moved", core: "pending", provider: { providerId: TO, model: MODEL } });
    w.moves.get("a")!.turnStarted = true;
    expect(parse(await w.cli(["status", "a", "--json"])).threads[0].core).toBe("pending");
    w.moves.get("a")!.turnCompleted = true;
    expect(parse(await w.cli(["status", "a", "--json"])).threads[0].core).toBe("rebuilt");
  });

  it("verify: ok after the first turn, pending before, no-move-event without a move", async () => {
    const w = world([thread("a"), thread("b"), thread("main")]);
    await w.cli(["a", "main", "--to", TO, "--json"]);
    let out = parse(await w.cli(["verify", "a", "b", "--json"]));
    expect(out.threads.map((each: { verdict: string }) => each.verdict)).toEqual(["pending", "no-move-event"]);
    w.moves.get("a")!.turnStarted = true;
    expect(parse(await w.cli(["verify", "a", "--json"])).threads[0].verdict).toBe("pending");
    w.moves.get("a")!.turnCompleted = true;
    w.moves.get("main")!.turnStarted = true;
    w.moves.get("main")!.turnCompleted = true;
    const ok = await w.cli(["verify", "a", "--json"]);
    expect(ok.exitCode).toBe(0);
    expect(parse(ok).threads[0]).toMatchObject({ verdict: "ok", moveEvent: true, turnStarted: true, turnCompleted: true, handoffDelivered: true, movedTo: { providerId: TO, model: MODEL } });
    // A probe asks only when asked, and never Main from --all.
    out = parse(await w.cli(["verify", "--all", "--probe", "first words?", "--json"]));
    expect(out.threads.find((each: { threadId: string }) => each.threadId === "a").probe).toEqual({ answer: "answer to first words?" });
    expect(out.threads.find((each: { threadId: string }) => each.threadId === "main").probe).toEqual({ skipped: "a Main is probed only by its id" });
    expect(w.calls.asks).toEqual(["a"]);
    await w.cli(["verify", "main", "--probe", "q", "--json"]);
    expect(w.calls.asks).toEqual(["a", "main"]);
    expect((await w.cli(["verify"])).exitCode).toBe(1);
  });
});

describe("JSON shape", () => {
  it("has the per-thread fields and a summary", async () => {
    const w = world([thread("a")]);
    const out = parse(await w.cli(["a", "--to", TO, "--json"]));
    expect(Object.keys(out).sort()).toEqual(["automations", "botDefaults", "dryRun", "router", "summary", "threads", "to"]);
    expect(Object.keys(out.threads[0]).sort()).toEqual(["automationsPatched", "from", "handoff", "result", "role", "threadId", "title", "to"]);
    expect(out.to).toEqual({ providerId: TO, model: MODEL, permission: null, historyTokens: 150000 });
  });

  it("plain text names every thread and the counts", async () => {
    const w = world([thread("a")]);
    const out = await w.cli(["a", "--to", TO]);
    expect(out.stdout).toContain("moved");
    expect(out.stdout).toMatch(/moved 1, already moved 0/);
  });
});

describe("router rewrite", () => {
  it("replaces the old provider's targets and drops duplicates", () => {
    const policy: RouterPolicy = { rules: [{ id: "r", chain: [{ providerId: "claude-code", model: "opus", reasoningLevel: "high" }, { providerId: "claude-code", model: "sonnet", reasoningLevel: null }] }], defaultChain: [] };
    const { policy: next, changed } = rewriteRouterPolicy(policy, "claude-code", { providerId: TO, model: MODEL });
    expect(changed).toBe(2);
    expect(next.rules[0]!.chain).toEqual([{ providerId: TO, model: MODEL, reasoningLevel: null }]);
  });
});

describe("tool delivery per provider", () => {
  const full = ["page_create", "page_read", "minis_data"];
  const scope = (providerId: string, delivery?: "default" | "all" | "defer" | "trio", lean = false, deferSupported = true) => scopeTools({ kind: "conversation", full, providerId, lean, deferSupported, ...(delivery ? { delivery } : {}) }).delivery;

  it("keeps today's default: Claude Code all, Codex defer, others trio", () => {
    expect(scope("claude-code")).toBe("all");
    expect(scope("codex")).toBe("defer");
    expect(scope("codex", undefined, false, false)).toBe("trio");
    expect(scope(TO)).toBe("trio");
    expect(scope(TO, "default")).toBe("trio");
  });

  it("follows a provider's setting; lean stays on the trio", () => {
    expect(scope(TO, "all")).toBe("all");
    expect(scope(TO, "defer")).toBe("defer");
    expect(scope(TO, "defer", false, false)).toBe("trio");
    expect(scope("claude-code", "trio")).toBe("trio");
    expect(scope(TO, "all", true)).toBe("trio");
  });

  it("is stored per provider and set from the CLI", async () => {
    const kv = new Map<string, unknown>();
    const store = new ToolDeliveryStore({ get: (key) => kv.get(key), set: (key, value) => { kv.set(key, value); } });
    await store.load();
    expect(store.modeFor(TO)).toBe("default");
    expect(parse(await toolDeliveryCli([TO, "all", "--json"], { toolDelivery: store }))).toEqual({ providers: { [TO]: "all" } });
    expect(kv.get(TOOL_DELIVERY_KEY)).toEqual({ [TO]: "all" });
    const again = new ToolDeliveryStore({ get: (key) => kv.get(key), set: () => {} });
    await again.load();
    expect(again.modeFor(TO)).toBe("all");
    await toolDeliveryCli([TO, "default"], { toolDelivery: store });
    expect(store.modeFor(TO)).toBe("default");
    expect((await toolDeliveryCli([TO, "sometimes"], { toolDelivery: store })).exitCode).toBe(1);
    expect((await toolDeliveryCli([TO], { toolDelivery: store })).exitCode).toBe(1);
  });
});

describe("ledger parsing", () => {
  it("drops malformed entries and fills defaults", () => {
    const ledger = parseLedger(JSON.stringify({ a: { state: "moved", at: 5, request: { providerId: TO, model: MODEL, permission: "root" } }, b: { state: "weird", request: {} }, c: null }));
    expect(Object.keys(ledger)).toEqual(["a"]);
    expect(ledger.a).toMatchObject({ state: "moved", error: null, attempts: 0, request: { permission: null, historyTokens: 150000, patchAutomations: false } });
  });
});

// The CLI never reads stdin: nothing here passes any, and every command above returned.
export type { PermissionMode };

describe("router rules without --from", () => {
  it("is a note, not a failure: exit 0", async () => {
    const w = world([thread("a")]);
    const out = await w.cli(["a", "--to", TO, "--router-rules", "--json"]);
    expect(out.exitCode).toBe(0);
    expect(parse(out).router).toMatchObject({ result: "skipped-info", targetsChanged: 0 });
    expect(w.policy.rules[0]!.chain[0]!.providerId).toBe("claude-code");
  });
});


describe("review fixes", () => {
  it("a deferred thread whose provider changed since is failed, not moved (changed-since-deferred)", async () => {
    const w = world([thread("a", { status: "active" })]);
    await w.cli(["a", "--to", TO, "--json"]);
    Object.assign(w.store.get("a")!, { status: "idle", providerId: "codex", model: "gpt" });
    expect(await w.service.onIdle("a")).toMatchObject({ result: "failed", reason: "changed-since-deferred" });
    expect(w.calls.core).toEqual([]);
    expect(parseLedger(w.kv.get(LEDGER_KEY)).a).toMatchObject({ state: "failed" });
  });

  it("cancel drops deferred entries by id or all; a deleted thread's entry goes; --no-defer drops an earlier deferral", async () => {
    const w = world([thread("a", { status: "active" }), thread("b", { status: "active" }), thread("c", { status: "active" }), thread("d", { status: "active" })]);
    await w.cli(["a", "b", "c", "d", "--to", TO, "--json"]);
    expect(parse(await w.cli(["cancel", "a", "--json"]))).toEqual({ cancelled: ["a"] });
    await w.service.forgetThread("b");
    await w.cli(["c", "--to", TO, "--no-defer", "--json"]);
    expect(Object.keys(parseLedger(w.kv.get(LEDGER_KEY)))).toEqual(["d"]);
    expect(parse(await w.cli(["cancel", "--all-deferred", "--json"]))).toEqual({ cancelled: ["d"] });
    w.store.get("d")!.status = "idle";
    expect(await w.service.onIdle("d")).toBeNull();
    expect((await w.cli(["cancel"])).exitCode).toBe(1);
  });

  it("claims before awaiting: two idles at once move the thread once; a CLI run meanwhile leaves it to the watcher", async () => {
    const w = world([thread("a", { status: "active" })]);
    await w.cli(["a", "--to", TO, "--json"]);
    w.store.get("a")!.status = "idle";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const prepare = w.deps.prepare;
    w.deps.prepare = async (threadId, input) => { await gate; return prepare(threadId, input); };
    const first = w.service.onIdle("a");
    const second = w.service.onIdle("a");
    const viaCli = await w.service.move({ ids: ["a"], includeArchived: false, runners: false }, { ...base, to: TO });
    expect(viaCli.threads[0]).toMatchObject({ result: "deferred", reason: "busy" });
    release();
    expect([(await first)?.result, await second]).toEqual(["moved", null]);
    expect(w.calls.prepare).toEqual(["a"]);
    expect(w.calls.core.length).toBe(1);
  });

  it("an automation with no permission mode keeps none: it follows its thread", async () => {
    const w = world([thread("a", { permission: "auto" })]);
    w.bbAutomations.push({ id: "aut_n", projectId: "p", name: "No mode", execution: { mode: "agent", targetThreadId: "a", providerId: "claude-code", model: "opus" } });
    const report = await w.service.move({ ids: ["a"], includeArchived: false, runners: false }, { ...base, to: "codex-like" as never }).catch(() => null);
    expect(report).toBeNull(); // unknown provider: bad input
    await w.service.move({ ids: ["a"], includeArchived: false, runners: false }, { ...base, to: TO });
    expect(w.bbAutomations[0]!.execution).toEqual({ mode: "agent", targetThreadId: "a", providerId: TO, model: MODEL });
  });

  it("failed automation and Bot default patches are in the ledger and status (exit 2), and a re-run to the target retries them", async () => {
    const w = world([thread("a")]);
    w.bbAutomations.push({ id: "aut_1", projectId: "p", name: "Daily", execution: { mode: "agent", targetThreadId: "a", providerId: "claude-code", model: "opus", permissionMode: "accept-edits" } });
    w.failNextBbUpdate();
    w.failNextBotDefault();
    const first = await w.cli(["--from", "claude-code", "--to", TO, "--automations", "--bot-defaults", "--json"]);
    expect(first.exitCode).toBe(2);
    expect(parseLedger(w.kv.get(LEDGER_KEY)).a!.patchErrors).toEqual(["bb automation aut_1 (Daily): automations plugin went away"]);
    const status = await w.cli(["status", "--json"]);
    expect(status.exitCode).toBe(2);
    expect(parse(status).patches.failures).toBe(2);
    expect(parse(status).threads[0].patchErrors).toHaveLength(1);
    // --from claude-code now selects nothing (a moved), yet the owed patches are tried again.
    const again = await w.cli(["--from", "claude-code", "--to", TO, "--json"]);
    expect(again.exitCode).toBe(0);
    expect(parse(again).automations.map((each: { result: string }) => each.result)).toEqual(["patched"]);
    expect(parse(again).botDefaults.map((each: { result: string }) => each.result)).toEqual(["patched"]);
    expect((await w.cli(["status", "--json"])).exitCode).toBe(0);
  });

  it("verify --probe never asks the thread running the command", async () => {
    const w = world([thread("a"), thread("me")]);
    await w.cli(["a", "me", "--to", TO, "--json"]);
    w.moves.get("a")!.turnCompleted = true;
    const out = parse(await w.cli(["verify", "a", "me", "--probe", "q", "--json"], "me"));
    expect(out.threads.find((each: { threadId: string }) => each.threadId === "me").probe).toEqual({ skipped: "the thread running this command" });
    expect(w.calls.asks).toEqual(["a"]);
  });

  it("rebuilt follows core: the new provider accepted a request after the move", async () => {
    const w = world([thread("a")]);
    await w.cli(["a", "--to", TO, "--json"]);
    const events = w.deps.moveEvents;
    w.deps.moveEvents = async (id) => ({ ...(await events(id)), inputAccepted: true });
    expect(parse(await w.cli(["status", "a", "--json"])).threads[0].core).toBe("rebuilt");
    expect(parse(await w.cli(["verify", "a", "--json"])).threads[0]).toMatchObject({ rebuilt: true, verdict: "ok" });
  });

  it("bot set-model refuses a model the provider doesn't offer", async () => {
    const w = world([]);
    const deps = { service: w.service, toolDelivery: new ToolDeliveryStore({ get: () => undefined, set: () => {} }), callerThreadId: null };
    expect(await botCli(["set-model", "Chief", "--provider", TO, "--model", "gemini-typo"], deps)).toMatchObject({ exitCode: 1 });
    expect(w.calls.botDefaults).toEqual([]);
  });

  it("--exclude-main leaves Main out unless it is named", async () => {
    const w = world([thread("a"), thread("main")]);
    expect((await w.service.select({ ids: [], from: "claude-code", includeArchived: false, runners: false, excludeMain: true })).threads.map((each) => each.id)).toEqual(["a"]);
    expect((await w.service.select({ ids: ["main"], from: "claude-code", includeArchived: false, runners: false, excludeMain: true })).threads.map((each) => each.id)).toEqual(["a", "main"]);
  });

  it("the watcher moves a deferred Main last", async () => {
    const w = world([thread("a", { status: "active" }), thread("main", { status: "active" })]);
    await w.cli(["a", "main", "--to", TO, "--json"]);
    w.store.get("a")!.status = "idle";
    w.store.get("main")!.status = "idle";
    expect(await w.service.onIdle("main")).toBeNull();
    expect(await w.service.onIdle("a")).toMatchObject({ result: "moved" });
    await vi.waitFor(() => expect(parseLedger(w.kv.get(LEDGER_KEY)).main!.state).toBe("moved"));
    expect(w.calls.core.map((each) => each.threadId)).toEqual(["a", "main"]);
  });

  it("the dry run shows the most the handoff can be", async () => {
    const w = world([thread("a")]);
    const out = parse(await w.cli(["a", "--to", TO, "--history-tokens", "2000", "--dry-run", "--json"]));
    expect(out.threads[0].handoffEstimate).toEqual({ maxChars: 16_000, historyTokens: 2000 });
  });
});

describe("deferred threads that went away", () => {
  it("a thread deleted or archived since it was deferred is dropped, not left deferred or failed", async () => {
    const w = world([thread("gone", { status: "active" }), thread("put-away", { status: "active" })]);
    await w.cli(["gone", "put-away", "--to", TO, "--json"]);
    w.store.delete("gone");
    Object.assign(w.store.get("put-away")!, { status: "idle", archived: true });
    expect(await w.service.onIdle("gone")).toBeNull();
    expect(await w.service.onIdle("put-away")).toBeNull();
    expect(parseLedger(w.kv.get(LEDGER_KEY))).toEqual({});
    expect(w.calls.core).toEqual([]);
    expect((await w.cli(["status", "--json"])).exitCode).toBe(0);
  });

  it("core's thread_not_found during the watcher's move drops the entry too", async () => {
    const w = world([thread("a", { status: "active" })]);
    await w.cli(["a", "--to", TO, "--json"]);
    w.store.get("a")!.status = "idle";
    w.deps.coreMove = async () => ({ status: 404, body: { code: "thread_not_found", message: "Thread not found" } });
    expect(await w.service.onIdle("a")).toMatchObject({ result: "skipped", reason: "thread-not-found" });
    expect(parseLedger(w.kv.get(LEDGER_KEY))).toEqual({});
  });

  it("an archived thread that was asked for still moves when its deferral comes due", async () => {
    const w = world([thread("old", { status: "active", archived: true })]);
    await w.cli(["old", "--to", TO, "--include-archived", "--json"]);
    w.store.get("old")!.status = "idle";
    expect(await w.service.onIdle("old")).toMatchObject({ result: "moved" });
  });
});


describe("Studio's own threads", () => {
  it("are never selected by --from (only by id); a deferral whose handoff says not found is dropped", async () => {
    const w = world([thread("a"), thread("cls", { title: "Studio Decisions · strands backfill" })]);
    w.deps.internal = (each) => each.title.startsWith("Studio Decisions");
    expect((await w.service.select({ ids: [], from: "claude-code", includeArchived: false, runners: false })).threads.map((each) => each.id)).toEqual(["a"]);
    expect((await w.service.select({ ids: ["cls"], includeArchived: false, runners: false })).threads.map((each) => each.id)).toEqual(["cls"]);
    w.store.get("a")!.status = "active";
    await w.cli(["a", "--to", TO, "--json"]);
    w.store.get("a")!.status = "idle";
    w.deps.prepare = async () => ({ ok: false, error: "HTTP 404: Thread not found" });
    expect(await w.service.onIdle("a")).toMatchObject({ result: "skipped" });
    expect(parseLedger(w.kv.get(LEDGER_KEY))).toEqual({});
  });
});

describe("final review fixes", () => {
  it("a second move deferred while busy (rollback) is carried out, not failed changed-since-deferred", async () => {
    const w = world([thread("a")]);
    await w.cli(["a", "--to", TO, "--json"]);
    expect(w.store.get("a")!.providerId).toBe(TO);
    w.store.get("a")!.status = "active";
    const back = parse(await w.cli(["a", "--to", "claude-code", "--model", "sonnet", "--json"]));
    expect(back.threads[0]).toMatchObject({ result: "deferred" });
    const entry = parseLedger(w.kv.get(LEDGER_KEY)).a!;
    expect(entry.from).toEqual({ providerId: "claude-code", model: "opus" });
    expect(entry.deferredFrom).toEqual({ providerId: TO, model: MODEL });
    w.store.get("a")!.status = "idle";
    expect(await w.service.onIdle("a")).toMatchObject({ result: "moved", to: { providerId: "claude-code", model: "sonnet" } });
    expect(w.store.get("a")!).toMatchObject({ providerId: "claude-code", model: "sonnet" });
  });

  it("owed automation patches aren't cleared by a run that didn't try them; without --automations only owed threads are patched", async () => {
    const w = world([thread("a"), thread("b")]);
    w.bbAutomations.push({ id: "aut_a", projectId: "p", name: "A", execution: { mode: "agent", targetThreadId: "a", providerId: "claude-code", model: "opus", permissionMode: "accept-edits" } });
    w.failNextBbUpdate();
    await w.cli(["a", "--to", TO, "--automations", "--json"]);
    expect(parseLedger(w.kv.get(LEDGER_KEY)).a!.patchErrors).toHaveLength(1);
    // b has an automation too, but this run doesn't pass --automations: b's isn't touched.
    w.bbAutomations.push({ id: "aut_b", projectId: "p", name: "B", execution: { mode: "agent", targetThreadId: "b", providerId: "claude-code", model: "opus", permissionMode: "accept-edits" } });
    w.failNextBbUpdate();
    const again = parse(await w.cli(["a", "b", "--to", TO, "--json"]));
    expect(again.automations.map((each: { automationId: string; result: string }) => [each.automationId, each.result])).toEqual([["aut_a", "failed"]]);
    expect(parseLedger(w.kv.get(LEDGER_KEY)).a!.patchErrors).toHaveLength(1);
    expect(w.bbAutomations[1]!.execution.providerId).toBe("claude-code");
    // Selected this run and owed: retried, and cleared once patched.
    const third = parse(await w.cli(["a", "--to", TO, "--json"]));
    expect(third.automations.map((each: { automationId: string; result: string }) => [each.automationId, each.result])).toEqual([["aut_a", "patched"]]);
    expect(parseLedger(w.kv.get(LEDGER_KEY)).a!.patchErrors).toBeUndefined();
    expect((await w.cli(["status", "--json"])).exitCode).toBe(0);
  });
});
