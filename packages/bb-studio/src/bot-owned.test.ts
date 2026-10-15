import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { automationMarker, BotOwnedThreads, ownedThreads } from "./bot-owned";
import { MIGRATIONS } from "./migrations";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });
type Thread = ReturnType<typeof makeThreadResponse>;

async function setup() {
  const threads = new Map<string, Thread>();
  const add = (fields: Partial<Thread> & { id: string }) => { const thread = makeThreadResponse({ projectId: "proj_personal", visibility: "visible", ...fields }); threads.set(thread.id, thread); return thread; };
  const list = vi.fn(async (args: { includeHidden?: boolean; archived?: boolean; limit?: number; offset?: number } = {}) => {
    const all = [...threads.values()].filter((thread) => (args.includeHidden || thread.visibility !== "hidden") && (args.archived === undefined || !!thread.archivedAt === args.archived));
    return all.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? all.length));
  });
  const update = vi.fn(async (args: { threadId: string; visibility?: "hidden" | "visible" }) => { threads.set(args.threadId, { ...threads.get(args.threadId)!, ...args } as Thread); return {}; });
  const automations: Record<string, unknown>[] = [];
  const runs = new Map<string, string[]>();
  const callRpc = vi.fn(async ({ method, input }: { method: string; input: Record<string, unknown> }) => {
    if (method === "automations_overview") return { automations: automations.map((automation) => ({ automation, project: { id: automation.projectId, name: "Personal" } })) };
    if (method === "automations_runs") return { runs: (runs.get(String(input.automationId)) ?? []).map((threadId, i) => ({ id: `run${i}`, threadId })), nextCursor: null };
    return {};
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: { list: list as never, update: update as never, get: (async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw Object.assign(new Error("Not found"), { status: 404 }); return thread; }) as never },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const bots = [{ id: "bot_main", chain: ["thr_old_chief", "thr_k3mtxc4nju"] }];
  const skip = new Set<string>();
  const handed = vi.fn(async (_thread: { id: string; title: string; projectId: string | null }, _botId: string) => {});
  const owned = new BotOwnedThreads({ db, sdk: bb.sdk, bots: () => bots, skip: () => skip, handed, sweepDelayMs: 0 });
  dispose.push(async () => owned.dispose());
  return { owned, threads, add, update, automations, runs, skip, db, callRpc, bots, handed };
}

/** Patrick's data: the Bot's child made an automation; each run is a top-level thread. */
function seedChief(x: Awaited<ReturnType<typeof setup>>) {
  x.add({ id: "thr_old_chief", title: "Chief of Staff" });
  x.add({ id: "thr_k3mtxc4nju", title: "Chief of Staff", sourceThreadId: "thr_old_chief" });
  x.add({ id: "thr_g3hgcvzv2n", title: "Experiment article backlog", parentThreadId: "thr_k3mtxc4nju" });
  x.automations.push({ id: "auto_3gql_e3lrei", projectId: "proj_personal", origin: "agent", createdByThreadId: "thr_g3hgcvzv2n", execution: { mode: "agent", prompt: "Scan." } });
  x.add({ id: "thr_wj23f5639w", title: "Scan for new experiment topics", originPluginId: "automations", titleFallback: "[bb automation due:auto_3gql_e3lrei] Scan." });
  x.runs.set("auto_3gql_e3lrei", ["thr_wj23f5639w", "thr_run_untitled"]);
  // A run whose first message has no marker: only the run links it.
  x.add({ id: "thr_run_untitled", title: "Untitled", originPluginId: "automations" });
  // An old run past the runs page: the marker links it.
  x.add({ id: "thr_run_old", originPluginId: "automations", titleFallback: "[bb automation due:auto_3gql_e3lrei] Scan." });
  // A subagent of a run.
  x.add({ id: "thr_run_child", parentThreadId: "thr_wj23f5639w" });
  // Not the Bot's: the user's own thread, the user's fork of the Bot's chat, a user automation's run, a thread the Bot's automation only wakes.
  x.add({ id: "thr_user", title: "Mine" });
  x.add({ id: "thr_fork", sourceThreadId: "thr_k3mtxc4nju", originKind: "fork" });
  x.automations.push({ id: "auto_user", projectId: "proj_personal", origin: "app", createdByThreadId: null, execution: { mode: "agent" } });
  x.add({ id: "thr_user_run", originPluginId: "automations", titleFallback: "[bb automation due:auto_user] Daily." });
  x.automations.push({ id: "auto_wake", projectId: "proj_personal", origin: "agent", createdByThreadId: "thr_k3mtxc4nju", execution: { mode: "agent", targetThreadId: "thr_user" } });
}

it("reads the automation marker a run's first message starts with", () => {
  expect(automationMarker({ originPluginId: "automations", titleFallback: "[bb automation due:auto_3gql_e3lrei] Scan for topics" })).toBe("auto_3gql_e3lrei");
  expect(automationMarker({ originPluginId: null, title: "[bb automation due:a1] x" })).toBe("a1");
  expect(automationMarker({ originPluginId: "pages", titleFallback: "[bb automation due:a1] x" })).toBeNull();
  expect(automationMarker({ originPluginId: "automations", titleFallback: "Scan" })).toBeNull();
});

it("hides every thread a Bot uses: its chain, what it spawned at any depth and its automations' runs, never the user's threads or forks", async () => {
  const x = await setup();
  seedChief(x);
  expect(await x.owned.sweep()).toBe(7);
  const hidden = [...x.threads.values()].filter((thread) => thread.visibility === "hidden").map((thread) => thread.id).sort();
  expect(hidden).toEqual(["thr_g3hgcvzv2n", "thr_k3mtxc4nju", "thr_old_chief", "thr_run_child", "thr_run_old", "thr_run_untitled", "thr_wj23f5639w"]);
  const reasons = Object.fromEntries((x.db.prepare("SELECT thread_id, reason FROM bot_hidden_threads").all() as { thread_id: string; reason: string }[]).map((row) => [row.thread_id, row.reason]));
  expect(reasons).toMatchObject({ thr_k3mtxc4nju: "chain", thr_old_chief: "chain", thr_g3hgcvzv2n: "spawned", thr_wj23f5639w: "automation" });
  // Activity lists the work, not the chain (it shows the Bot's chat as "self").
  expect(x.owned.owned("bot_main")).toEqual(new Set(hidden.filter((id) => id !== "thr_k3mtxc4nju" && id !== "thr_old_chief")));
  for (const id of ["thr_user", "thr_fork", "thr_user_run"]) expect(x.threads.get(id)?.visibility).toBe("visible");
  // Idempotent.
  expect(await x.owned.sweep()).toBe(0);
});

it("hides a thread once: one the user shows again stays visible", async () => {
  const x = await setup();
  seedChief(x);
  await x.owned.sweep();
  x.threads.set("thr_wj23f5639w", { ...x.threads.get("thr_wj23f5639w")!, visibility: "visible" });
  expect(await x.owned.sweep()).toBe(0);
  expect(x.threads.get("thr_wj23f5639w")?.visibility).toBe("visible");
  // Still the Bot's, so Activity keeps listing it.
  expect(x.owned.owned("bot_main").has("thr_wj23f5639w")).toBe(true);
  await x.owned.created(x.threads.get("thr_wj23f5639w")!);
  expect(x.threads.get("thr_wj23f5639w")?.visibility).toBe("visible");
});

it("hides as threads are made: a child of a known Bot thread at once, an automation's run after a sweep", async () => {
  const x = await setup();
  seedChief(x);
  x.threads.delete("thr_g3hgcvzv2n");
  x.threads.delete("thr_wj23f5639w");
  await x.owned.created(x.add({ id: "thr_g3hgcvzv2n", parentThreadId: "thr_k3mtxc4nju" }));
  expect(x.threads.get("thr_g3hgcvzv2n")?.visibility).toBe("hidden");
  await x.owned.created(x.add({ id: "thr_grandchild", lifecycleOwnerThreadId: "thr_g3hgcvzv2n" }));
  expect(x.threads.get("thr_grandchild")?.visibility).toBe("hidden");
  // The Bot's own chat hides at once; the user's thread: nothing.
  await x.owned.created(x.threads.get("thr_k3mtxc4nju")!);
  expect(x.threads.get("thr_k3mtxc4nju")?.visibility).toBe("hidden");
  await x.owned.created(x.threads.get("thr_user")!);
  expect(x.callRpc).not.toHaveBeenCalled();
  await x.owned.created(x.add({ id: "thr_wj23f5639w", originPluginId: "automations" }));
  await vi.waitFor(() => expect(x.threads.get("thr_wj23f5639w")?.visibility).toBe("hidden"));
  expect(x.threads.get("thr_user")?.visibility).toBe("visible");
});

it("hides a Bot's chain when it gets a thread, once: a chat the user shows again stays visible", async () => {
  const x = await setup();
  seedChief(x);
  // An archived handoff thread is left alone.
  x.threads.set("thr_old_chief", { ...x.threads.get("thr_old_chief")!, archivedAt: 5 });
  expect(await x.owned.claimChains()).toBe(1);
  expect(x.threads.get("thr_k3mtxc4nju")?.visibility).toBe("hidden");
  expect(x.threads.get("thr_old_chief")?.visibility).toBe("visible");
  expect(x.threads.get("thr_g3hgcvzv2n")?.visibility).toBe("visible");
  x.threads.set("thr_k3mtxc4nju", { ...x.threads.get("thr_k3mtxc4nju")!, visibility: "visible" });
  expect(await x.owned.claimChains()).toBe(0);
  expect(await x.owned.sweep()).toBe(5);
  await x.owned.created(x.threads.get("thr_k3mtxc4nju")!);
  expect(x.threads.get("thr_k3mtxc4nju")?.visibility).toBe("visible");
  expect(x.owned.ownerOf("thr_k3mtxc4nju")).toBe("bot_main");
});

it("leaves runner threads to src/runners.ts and BB's refusals to the next sweep", async () => {
  const x = await setup();
  seedChief(x);
  x.skip.add("thr_g3hgcvzv2n");
  const update = x.update.getMockImplementation()!;
  x.update.mockImplementation(async (args) => { if (args.threadId === "thr_run_old") throw new Error("busy"); return update(args); });
  expect(await x.owned.sweep()).toBe(5);
  expect(x.threads.get("thr_g3hgcvzv2n")?.visibility).toBe("visible");
  expect(x.threads.get("thr_run_old")?.visibility).toBe("visible");
  x.update.mockImplementation(update);
  expect(await x.owned.sweep()).toBe(1);
  expect(x.threads.get("thr_run_old")?.visibility).toBe("hidden");
});

it("ownedThreads follows ownership through hidden threads and chains of automations", () => {
  const chains = new Map([["bot", "b1"]]);
  const threads = [
    { id: "child", parentThreadId: "bot", visibility: "hidden" as const },
    { id: "run1", originPluginId: "automations" },
    { id: "run2", originPluginId: "automations" },
  ];
  const automations = [
    { id: "a1", createdByThreadId: "child", execution: {} },
    { id: "a2", createdByThreadId: "run1", execution: {} },
  ];
  expect(ownedThreads(threads, automations, chains, new Map([["run1", "a1"], ["run2", "a2"]]))).toEqual(new Map([["child", "b1"], ["run1", "b1"], ["run2", "b1"]]));
});

it("tells which Bot a thread belongs to: its chain, what it owns, what Studio hid for it", async () => {
  const x = await setup();
  seedChief(x);
  await x.owned.sweep();
  expect(x.owned.ownerOf("thr_old_chief")).toBe("bot_main");
  expect(x.owned.ownerOf("thr_k3mtxc4nju")).toBe("bot_main");
  expect(x.owned.ownerOf("thr_run_child")).toBe("bot_main");
  // A runner's thread, recorded by src/runners.ts.
  x.db.prepare("INSERT INTO bot_hidden_threads (thread_id, bot_id, reason, hidden_at) VALUES ('thr_runner', 'bot_main', 'runner', 1)").run();
  expect(x.owned.ownerOf("thr_runner")).toBe("bot_main");
  for (const id of ["thr_user", "thr_fork", "thr_user_run", "thr_nope"]) expect(x.owned.ownerOf(id)).toBeNull();
});

it("adopts a thread the user hands a Bot: hidden, owned with what it spawns, and moved from another Bot", async () => {
  const x = await setup();
  seedChief(x);
  x.bots.push({ id: "bot_scout", chain: ["thr_scout"] });
  x.add({ id: "thr_scout", title: "Scout" });
  await x.owned.sweep();
  await x.owned.adopt("thr_user", "bot_scout");
  expect(x.threads.get("thr_user")?.visibility).toBe("hidden");
  expect(x.owned.ownerOf("thr_user")).toBe("bot_scout");
  expect(x.owned.owned("bot_scout").has("thr_user")).toBe(true);
  // The Bot hears about it once; dropping it on the same Bot again says nothing.
  expect(x.handed).toHaveBeenCalledWith({ id: "thr_user", title: "Mine", projectId: "proj_personal" }, "bot_scout");
  await x.owned.adopt("thr_user", "bot_scout");
  expect(x.handed).toHaveBeenCalledTimes(1);
  // What it spawns later is the Bot's too, at once and on a sweep.
  x.add({ id: "thr_user_child", parentThreadId: "thr_user" });
  await x.owned.created(x.threads.get("thr_user_child")!);
  expect(x.owned.ownerOf("thr_user_child")).toBe("bot_scout");
  await x.owned.sweep();
  expect(x.owned.ownerOf("thr_user")).toBe("bot_scout");
  // A thread another Bot spawned moves, and leaves that Bot.
  await x.owned.adopt("thr_g3hgcvzv2n", "bot_scout");
  expect(x.owned.ownerOf("thr_g3hgcvzv2n")).toBe("bot_scout");
  expect(x.owned.owned("bot_main").has("thr_g3hgcvzv2n")).toBe(false);
  await x.owned.sweep();
  expect(x.owned.ownerOf("thr_g3hgcvzv2n")).toBe("bot_scout");
  // A Bot's chat and a runner stay put.
  await expect(x.owned.adopt("thr_k3mtxc4nju", "bot_scout")).rejects.toThrow(/another bot's chat/);
  x.skip.add("thr_run_untitled");
  await expect(x.owned.adopt("thr_run_untitled", "bot_scout")).rejects.toThrow(/runner/);
});

it("releases a thread the user takes back: shown again, no Bot's, and what it spawns stays the user's through sweeps", async () => {
  const x = await setup();
  seedChief(x);
  await x.owned.sweep();
  // A thread the Bot spawned, and one the user had handed it.
  await x.owned.adopt("thr_user", "bot_main");
  for (const id of ["thr_g3hgcvzv2n", "thr_user"]) {
    await x.owned.release(id);
    expect(x.threads.get(id)?.visibility).toBe("visible");
    expect(x.owned.ownerOf(id)).toBeNull();
    expect(x.owned.owned("bot_main").has(id)).toBe(false);
    expect(x.owned.all().has(id)).toBe(false);
  }
  x.add({ id: "thr_released_child", parentThreadId: "thr_g3hgcvzv2n" });
  await x.owned.created(x.threads.get("thr_released_child")!);
  await x.owned.sweep();
  for (const id of ["thr_g3hgcvzv2n", "thr_user", "thr_released_child"]) expect(x.threads.get(id)?.visibility).toBe("visible");
  expect(x.owned.ownerOf("thr_released_child")).toBeNull();
  // Handed back again, it's the Bot's again.
  await x.owned.adopt("thr_user", "bot_main");
  expect(x.owned.ownerOf("thr_user")).toBe("bot_main");
  // The Bot's chat and threads no Bot owns don't release.
  await expect(x.owned.release("thr_k3mtxc4nju")).rejects.toThrow(/own chat/);
  await expect(x.owned.release("thr_fork")).rejects.toThrow(/isn't a bot's/);
});
