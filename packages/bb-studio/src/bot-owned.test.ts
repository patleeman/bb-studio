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
    threads: { list: list as never, update: update as never },
    plugins: { callRpc: callRpc as never, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const bots = [{ id: "bot_main", chain: ["thr_old_chief", "thr_k3mtxc4nju"] }];
  const skip = new Set<string>();
  const owned = new BotOwnedThreads({ db, sdk: bb.sdk, bots: () => bots, skip: () => skip, sweepDelayMs: 0 });
  dispose.push(async () => owned.dispose());
  return { owned, threads, add, update, automations, runs, skip, db, callRpc };
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

it("finds what a Bot owns: spawned at any depth and its automations' runs, never its chain or the user's forks", async () => {
  const x = await setup();
  seedChief(x);
  expect(await x.owned.sweep()).toBe(5);
  const hidden = [...x.threads.values()].filter((thread) => thread.visibility === "hidden").map((thread) => thread.id).sort();
  expect(hidden).toEqual(["thr_g3hgcvzv2n", "thr_run_child", "thr_run_old", "thr_run_untitled", "thr_wj23f5639w"]);
  expect(x.owned.owned("bot_main")).toEqual(new Set(hidden));
  for (const id of ["thr_old_chief", "thr_k3mtxc4nju", "thr_user", "thr_fork", "thr_user_run"]) expect(x.threads.get(id)?.visibility).toBe("visible");
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
  // The Bot's own chat and the user's thread: nothing.
  await x.owned.created(x.threads.get("thr_k3mtxc4nju")!);
  await x.owned.created(x.threads.get("thr_user")!);
  expect(x.callRpc).not.toHaveBeenCalled();
  await x.owned.created(x.add({ id: "thr_wj23f5639w", originPluginId: "automations" }));
  await vi.waitFor(() => expect(x.threads.get("thr_wj23f5639w")?.visibility).toBe("hidden"));
  expect(x.threads.get("thr_k3mtxc4nju")?.visibility).toBe("visible");
});

it("leaves runner threads to src/runners.ts and BB's refusals to the next sweep", async () => {
  const x = await setup();
  seedChief(x);
  x.skip.add("thr_g3hgcvzv2n");
  const update = x.update.getMockImplementation()!;
  x.update.mockImplementation(async (args) => { if (args.threadId === "thr_run_old") throw new Error("busy"); return update(args); });
  expect(await x.owned.sweep()).toBe(3);
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
