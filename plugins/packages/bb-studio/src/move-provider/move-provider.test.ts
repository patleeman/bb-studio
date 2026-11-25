import { describe, expect, it } from "vitest";
import { scopeTools } from "../tool-scope";
import { ToolDeliveryStore, TOOL_DELIVERY_KEY } from "../tool-delivery";
import { botCli, moveProviderCli, runnerCli, toolDeliveryCli } from "./cli";
import { coreOutcome, LEDGER_KEY, parseLedger, rewriteRouterPolicy, targetPermission, type CoreMoveBody, type PermissionMode, type RouterPolicy } from "./core";
import { MoveProviderService, type BbAutomation, type BotRef, type MoveDeps, type StudioAutomation, type ThreadInfo } from "./service";

const TO = "acp-antigravity-acp";
const MODEL = "gemini-3-pro";

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
  const deps: MoveDeps = {
    kv: { get: (key) => kv.get(key), set: (key, value) => { kv.set(key, JSON.parse(JSON.stringify(value))); } },
    listThreads: async ({ providerId, projectId, includeArchived }) => [...store.values()].filter((each) => (!providerId || each.providerId === providerId) && (!projectId || each.projectId === projectId) && (includeArchived || !each.archived)).map((each) => ({ ...each })),
    getThreads: async (ids) => ids.flatMap((id) => store.has(id) ? [{ ...store.get(id)! }] : []),
    bots: () => bots,
    botThreads: async () => ["main", "w1"],
    runnerThreads: (botId) => runners.filter((each) => !botId || each.botId === botId),
    leadThreads: async () => ["lead"],
    target: async (providerId) => providerId === TO ? { known: true, ready: true, models: [MODEL, "gemini-flash"], defaultModel: MODEL, permissionModes: null } : providerId === "claude-code" ? { known: true, ready: true, models: ["opus", "sonnet"], defaultModel: "opus", permissionModes: null } : { known: false, ready: false, models: [], defaultModel: null, permissionModes: null },
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
    setBotDefault: async (botId, providerId, model) => { calls.botDefaults.push(botId); bots.find((each) => each.id === botId)!.defaultModel = { providerId, model }; },
    router: { get: async () => policy, set: async (next) => { policy = next; } },
    moveEvents: async (threadId) => { const move = moves.get(threadId); return { move: move ? { seq: move.seq, at: 1, to: move.to } : null, turnStarted: !!move?.turnStarted, turnCompleted: !!move?.turnCompleted }; },
    handoffDelivered: async () => true,
    ask: async (threadId, question) => { calls.asks.push(threadId); return `answer to ${question}`; },
    now: () => 1000,
  };
  const service = new MoveProviderService(deps);
  return {
    service, store, kv, calls, moves, busy, bbAutomations, studioAutomations, bots, runners, deps,
    get policy() { return policy; },
    failNextBbUpdate: () => { failNextBbUpdate = true; },
    cli: (argv: string[], callerThreadId: string | null = null) => moveProviderCli(argv, { service, toolDelivery: new ToolDeliveryStore({ get: () => undefined, set: () => {} }), callerThreadId }),
  };
}

const base = { dryRun: false, automations: true, botDefaults: false, routerRules: false } as const;
const parse = (out: { stdout?: string }) => JSON.parse(out.stdout ?? "null");

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
