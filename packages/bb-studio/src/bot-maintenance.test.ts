import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { BotMaintenance, archiveAge, finished, maintenanceDefaults, maintenanceDryRun, memoryNeedsTidy, safeWorkspace } from "./bot-maintenance";
import { MIGRATIONS } from "./migrations";
const DAY = 86_400_000;
const now = 200 * DAY;
const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });
function thread(id = "child", days = 8) {
  return { ...makeThreadResponse({ id, status: "idle", updatedAt: now - days * DAY, parentThreadId: "main", environmentId: null }), environmentBranchName: "bb/child", hasPendingInteraction: false, queuedWork: "none", activity: { activeBackgroundAgentCount: 0, activeBackgroundCommandCount: 0, activeGoalCount: 0, activePlanModeCount: 0, activeWorkflowCount: 0 }, environmentPath: null };
}
const clean = () => ({ outcome: "available", workspace: { checkout: { kind: "branch", branchName: "bb/child" }, workingTree: { state: "clean", hasUncommittedChanges: false }, mergeBase: { mergeBaseBranch: "origin/bb/child", baseRef: "4f2a0930f358881edf6a22ce40d56212f8432f40", aheadCount: 0, hasCommittedUnmergedChanges: false } } });
async function setup() {
  const rows = [thread()];
  const targets: Record<string, unknown>[] = [];
  const interactions: { status: string }[] = [];
  const events: Record<string, unknown>[] = [];
  const archive = vi.fn(async () => ({ ok: true }));
  const send = vi.fn(async () => ({ ok: true }));
  const status = vi.fn(async () => clean());
  const rpcCalls: { method: string; input: unknown }[] = [];
  const pause = vi.fn(async () => {}), del = vi.fn(async () => {}), curate = vi.fn(async () => ({ result: "Nothing to retire" })), alert = vi.fn(async () => {}), refreshOwned = vi.fn(async () => {});
  const runs: { status: string; output: string }[] = [];
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: { listRunning: async () => [], get: (async ({ threadId }: { threadId: string }) => { const t = rows.find((t) => t.id === threadId); if (!t) throw Object.assign(new Error("Not found"), { status: 404 }); return t; }) as never, list: (async ({ offset }: { offset?: number }) => offset ? [] : rows) as never, archive: archive as never, send: send as never, interactions: { list: (async () => interactions) as never }, events: { list: (async () => events) as never } },
    environments: { status: status as never, pullRequest: (async () => ({ outcome: "not_applicable" })) as never },
    plugins: { callRpc: (async ({ method, input }: { method: string; input: unknown }) => { rpcCalls.push({ method, input }); return method === "automations_overview" ? { automations: targets } : { runs }; }) as never },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database(); bb.storage.migrate(db, MIGRATIONS);
  const bot = { id: "bot", state: "active", threadId: "main" };
  let memory: { id: string; markdown: string; updatedAt: number } | null = null;
  const owned = new Set(["child"]);
  const maintenance = new BotMaintenance({ db, sdk: bb.sdk, changed: () => {}, bots: () => [bot], owned: () => owned, refreshOwned, memory: () => memory, curate, automationPause: pause, automationDelete: del, adoptable: async () => [], alert });
  const enable = async () => { await maintenance.set("bot", { enabled: true }, now - DAY); archive.mockClear(); curate.mockClear(); };
  const local = (id: string, kind: string, state = "active", age = 1, target = "main", instruction = "report") => db.prepare("INSERT INTO bot_automations (id, bot_id, kind, name, state, schedule_json, project_id, created_at, updated_at, target, instruction, bb_ids) VALUES (?, 'bot', ?, ?, ?, '{}', 'proj', 0, ?, ?, ?, '[\"a\"]')").run(id, kind, id, state, now - age * DAY, target, instruction);
  return { harness, db, bot, maintenance, rows, owned, targets, interactions, events, archive, send, status, rpcCalls, pause, del, curate, alert, refreshOwned, runs, enable, local, memory: (m: typeof memory) => { memory = m; } };
}
it("defaults off and waits one day before going live", () => {
  const s = maintenanceDefaults(); expect(s.enabled).toBe(false); expect(s.memoryWords).toBe(8000);
  expect(maintenanceDryRun(s, now)).toBe(true); s.enabled = true; s.enabledAt = now;
  expect(maintenanceDryRun(s, now + DAY - 1)).toBe(true); expect(maintenanceDryRun(s, now + DAY)).toBe(false);
});
it("distinguishes finished threads from running, queued, pending and open plans", () => {
  const t = thread(); expect(finished(t as never, false, [])).toBe(true);
  for (const patch of [{ status: "active" }, { queuedWork: "waiting" }, { hasPendingInteraction: true }, { activity: { activePlanModeCount: 1 } }]) expect(finished({ ...t, ...patch } as never, false, [])).toBe(false);
  expect(finished(t as never, true, [])).toBe(false); expect(finished(t as never, false, [{ status: "pending" }])).toBe(false);
});
it("uses captured results and owner replies for retention", () => {
  expect(archiveAge(false, true, false)).toBe(3 * DAY); expect(archiveAge(false, false, false)).toBe(7 * DAY);
  expect(archiveAge(true, false, true)).toBe(DAY); expect(archiveAge(true, false, false)).toBe(3 * DAY);
});
it("requires confirmed clean workspace and no ahead commits", () => {
  expect(safeWorkspace(clean() as never)).toBe(true);
  for (const mutate of [(s: ReturnType<typeof clean>) => { s.workspace.workingTree.state = "dirty_uncommitted"; }, (s: ReturnType<typeof clean>) => { s.workspace.workingTree.hasUncommittedChanges = true; }, (s: ReturnType<typeof clean>) => { s.workspace.mergeBase.aheadCount = 1; }, (s: ReturnType<typeof clean>) => { s.workspace.checkout.kind = "detached"; }]) { const s = clean(); mutate(s); expect(safeWorkspace(s as never)).toBe(false); }
  expect(safeWorkspace({ outcome: "not_applicable" } as never)).toBe(false); expect(safeWorkspace({ outcome: "unavailable" } as never)).toBe(false);
});
it("checks Memory word budget and old entries", () => {
  expect(memoryNeedsTidy("one two three", 2, now, now)).toBe(true);
  expect(memoryNeedsTidy("one two", 2, now, now)).toBe(false);
  expect(memoryNeedsTidy("remember this", 8000, now - 61 * DAY, now)).toBe(true);
  expect(memoryNeedsTidy("2020-01-01 old fact", 8000, Date.now(), Date.now())).toBe(true);
  expect(memoryNeedsTidy("", 8000, 0, now)).toBe(false);
});
it("archives only owned, finished threads; records a single run", async () => {
  const x = await setup(); x.rows.push(thread("user")); await x.enable();
  const result = await x.maintenance.run("bot", { now }); expect(x.archive).toHaveBeenCalledExactlyOnceWith({ threadId: "child" }); expect(result?.dryRun).toBe(false); expect(x.maintenance.view("bot").runs).toHaveLength(2); expect(x.alert).not.toHaveBeenCalled();
});
it("words the summary in the singular for one, and says Dry run only once", async () => {
  const x = await setup(); await x.enable();
  const result = await x.maintenance.run("bot", { now, dryRun: true });
  expect(result?.summary).toMatch(/^Dry run: would archive 1 finished thread, 0 workers;/);
  expect(result?.summary).not.toMatch(/Skills: Dry run:/);
});
it("does nothing while off, paused, or in the initial dry-run day", async () => {
  const x = await setup(); await x.maintenance.tick(now); expect(x.maintenance.view("bot").runs).toHaveLength(0);
  await x.maintenance.set("bot", { enabled: true }, now); expect(x.maintenance.view("bot").runs[0]?.dryRun).toBe(true); expect(x.archive).not.toHaveBeenCalled(); expect(x.refreshOwned).not.toHaveBeenCalled();
  x.bot.state = "paused"; expect(await x.maintenance.run("bot", { now: now + DAY })).toBeNull();
});
it("dry run leaves threads, automations, Memory and skills alone", async () => {
  const x = await setup(); await x.enable(); x.local("done", "reminder", "done", 15); x.memory({ id: "mem", markdown: "word ".repeat(8001), updatedAt: now });
  const result = await x.maintenance.run("bot", { dryRun: true, now }); expect(result?.actions).toContain("Delete done reminder: done"); expect(x.archive).not.toHaveBeenCalled(); expect(x.del).not.toHaveBeenCalled(); expect(x.send).not.toHaveBeenCalled(); expect(x.curate).toHaveBeenCalledWith("bot", true);
});
it("protects BB automation targets, pending interactions and open plans", async () => {
  const x = await setup(); await x.enable(); x.targets.push({ automation: { id: "external", enabled: true, execution: { targetThreadId: "child" }, trigger: {} }, project: { id: "p" } });
  await x.maintenance.run("bot", { now }); expect(x.archive).not.toHaveBeenCalled(); x.targets.length = 0;
  x.interactions.push({ status: "pending" }); await x.maintenance.run("bot", { now }); expect(x.archive).not.toHaveBeenCalled(); x.interactions.length = 0;
  x.events.push({ data: { plan: [{ status: "in_progress" }] } }); await x.maintenance.run("bot", { now }); expect(x.archive).not.toHaveBeenCalled();
});
it.each(["dirty", "error", "not_applicable", "ahead"])("sends %s workspace to Needs your call", async (mode) => {
  const x = await setup(); await x.enable(); x.rows[0]!.environmentId = "env";
  if (mode === "error") x.status.mockRejectedValue(new Error("offline"));
  else if (mode === "not_applicable") x.status.mockResolvedValue({ outcome: "not_applicable" } as never);
  else { const s = clean(); if (mode === "dirty") s.workspace.workingTree.hasUncommittedChanges = true; else s.workspace.mergeBase.aheadCount = 1; x.status.mockResolvedValue(s); }
  const r = await x.maintenance.run("bot", { now }); expect(x.archive).not.toHaveBeenCalled(); expect(r?.needsCall).toHaveLength(1); expect(x.alert).toHaveBeenCalledOnce();
});
it("archives captured threads at 3 days, otherwise waits 7", async () => {
  const x = await setup(); await x.enable(); x.rows[0]!.updatedAt = now - 4 * DAY;
  await x.maintenance.run("bot", { now }); expect(x.archive).not.toHaveBeenCalled();
  x.db.prepare("INSERT INTO item_threads VALUES ('child', 'studio', 'item', 'created', 'active', 0, 0, '{}')").run();
  await x.maintenance.run("bot", { now }); expect(x.archive).toHaveBeenCalledOnce();
});
it("waits for the owner to reply before archiving a one-day worker", async () => {
  const x = await setup(); await x.enable(); Object.assign(x.rows[0]!, { visibility: "hidden", lifecycleOwnerThreadId: "main", updatedAt: now - 2 * DAY }); x.rows.push(thread("main", 0));
  await x.maintenance.run("bot", { now }); expect(x.archive).not.toHaveBeenCalled();
  x.events.push({ createdAt: now, data: {} }); await x.maintenance.run("bot", { now }); expect(x.archive).toHaveBeenCalledOnce();
});
it("deletes only done reminders after 14 days and folds finished check-ins", async () => {
  const x = await setup(); await x.enable(); x.local("old", "reminder", "done", 15); x.local("young", "reminder", "done", 13); x.local("check", "checkin", "ended", 15); x.local("paused", "checkin", "paused", 31);
  const r = await x.maintenance.run("bot", { now }); expect(x.del).toHaveBeenCalledExactlyOnceWith("old", "bot"); expect(x.db.prepare("SELECT state FROM bot_automations WHERE id = 'check'").get()).toEqual({ state: "done" }); expect(r?.suggestions.some((s) => s.text.includes("Suggest delete: paused"))).toBe(true);
});
it("pauses stale watchers and duplicate recurring instructions", async () => {
  const x = await setup(); await x.enable(); x.rows.push(thread("main")); x.local("watch", "watcher", "active", 1, "retired"); x.local("first", "checkin"); x.local("second", "checkin");
  await x.maintenance.run("bot", { now }); expect(x.pause).toHaveBeenCalledWith("watch", "bot"); expect(x.pause).toHaveBeenCalledWith("second", "bot"); expect(x.pause).not.toHaveBeenCalledWith("first", "bot");
});
it("lists ten empty successful runs without pausing them", async () => {
  const x = await setup(); await x.enable(); x.rows.push(thread("main")); x.local("report", "checkin"); x.runs.push(...Array.from({ length: 10 }, () => ({ status: "succeeded", output: "[PASS]" })));
  const r = await x.maintenance.run("bot", { now }); expect(r?.suggestions.some((s) => s.text.includes("no useful output"))).toBe(true); expect(x.pause).not.toHaveBeenCalled();
});
it("asks for Memory maintenance in one agent-only message", async () => {
  const x = await setup(); await x.enable(); x.memory({ id: "mem", markdown: "word ".repeat(8001), updatedAt: now });
  await x.maintenance.run("bot", { now }); expect(x.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ input: [expect.objectContaining({ visibility: "agent-only", text: expect.stringContaining("8000 words") })] }));
});
it("runs at 4 AM local and deduplicates heartbeat runs that day", async () => {
  const x = await setup(); const at = new Date(2026, 9, 21, 4).getTime(); await x.maintenance.set("bot", { enabled: true }, at - 2 * DAY);
  await x.maintenance.tick(at); const count = x.maintenance.view("bot").runs.length;
  await x.maintenance.tick(at + 1000, "bot"); await x.maintenance.tick(at + 2000); expect(x.maintenance.view("bot").runs).toHaveLength(count);
  await x.maintenance.tick(at + DAY); expect(x.maintenance.view("bot").runs).toHaveLength(count + 1);
});
it("blocks a local merge base because it cannot prove the branch was pushed", () => {
  const s = clean(); s.workspace.mergeBase.mergeBaseBranch = "main"; expect(safeWorkspace(s as never)).toBe(false);
  s.workspace.mergeBase.mergeBaseBranch = "origin/other"; expect(safeWorkspace(s as never)).toBe(false);
});
it("allows a confirmed clean, pushed workspace", async () => {
  const x = await setup(); await x.enable(); x.rows[0]!.environmentId = "env";
  await x.maintenance.run("bot", { now }); expect(x.status).toHaveBeenCalledWith({ environmentId: "env", mergeBaseBranch: "origin/bb/child" }); expect(x.archive).toHaveBeenCalledOnce();
});
it("calls the Automations overview with its null input contract", async () => {
  const x = await setup(); await x.enable();
  expect(x.rpcCalls.find((call) => call.method === "automations_overview")?.input).toBeNull();
});
it("protects Studio automation and runner targets", async () => {
  const x = await setup(); await x.enable(); x.local("target", "checkin"); x.db.prepare("UPDATE bot_automations SET target_thread_id = 'child'").run();
  await x.maintenance.run("bot", { now }); expect(x.archive).not.toHaveBeenCalled();
});
it("honors per-rule toggles", async () => {
  const x = await setup(); await x.enable(); await x.maintenance.set("bot", { rules: { threads: false, skills: false, memory: false, automations: false } }, now);
  x.curate.mockClear(); await x.maintenance.run("bot", { now }); expect(x.archive).not.toHaveBeenCalled(); expect(x.curate).not.toHaveBeenCalled();
});
it("folds completed one-shot reminders without deleting them immediately", async () => {
  const x = await setup(); await x.enable(); x.local("once", "reminder"); x.targets.push({ automation: { id: "a", enabled: false, lastRunAt: now - DAY, lastRunStatus: "succeeded", nextRunAt: null, execution: {}, trigger: {} }, project: { id: "proj" } });
  await x.maintenance.run("bot", { now }); expect(x.db.prepare("SELECT state FROM bot_automations WHERE id = 'once'").get()).toEqual({ state: "done" }); expect(x.del).not.toHaveBeenCalled();
});
it("does not run twice when an early check-in is followed by 4 AM", async () => {
  const x = await setup(); const at = new Date(2026, 9, 21, 2).getTime(); await x.maintenance.set("bot", { enabled: true }, at - 2 * DAY);
  await x.maintenance.tick(at, "bot"); const count = x.maintenance.view("bot").runs.length;
  await x.maintenance.tick(at + 2 * 3_600_000); expect(x.maintenance.view("bot").runs).toHaveLength(count);
});
it("settings and run records reject updates and deletes", async () => {
  const x = await setup(); await x.enable();
  for (const table of ["bot_maintenance_settings", "bot_maintenance_runs"]) {
    expect(() => x.db.prepare(`UPDATE ${table} SET at = 0`).run()).toThrow(/append-only/);
    expect(() => x.db.prepare(`DELETE FROM ${table}`).run()).toThrow(/append-only/);
  }
});
it("fails closed and records a run when the automation overview is unavailable", async () => {
  const x = await setup(); await x.enable();
  x.harness.sdk.stub("plugins.callRpc", async () => { throw new Error("overview unavailable"); });
  const run = await x.maintenance.run("bot", { now }); expect(run?.summary).toContain("stopped: overview unavailable"); expect(x.archive).not.toHaveBeenCalled();
});
