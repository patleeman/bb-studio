import { test } from "vitest";
import assert from "node:assert/strict";
import type { MessageDispatchHookContext } from "@get-bb/plugin-sdk";
import type { Verdict } from "../server/classifier";
import {
  RouteFailed,
  SmartQueue,
  batchingReason,
  decidingReason,
  followupReason,
  followupRecheckMs,
  maxDecideMs,
  type QueuedRow,
  type SmartQueueDeps,
  type ThreadInfo,
} from "../server/queue";

const thread = (overrides: Partial<ThreadInfo> = {}) =>
  ({
    id: "thr_1",
    status: "active",
    visibility: "visible",
    originPluginId: null,
    projectId: "proj_1",
    environmentId: "env_1",
    title: "Build storage",
    ...overrides,
  }) as ThreadInfo;
const row = (overrides: Partial<QueuedRow> = {}) =>
  ({
    id: "q_1",
    threadId: "thr_1",
    createdAt: 1,
    initiator: "user",
    senderThreadId: null,
    originPluginId: null,
    payload: { kind: "inline" },
    editable: true,
    waitingOn: { kind: "plugin", pluginId: "smart-queue", reason: decidingReason },
    content: [{ type: "text", text: "Actually use SQLite", mentions: [] }],
    ...overrides,
  }) as QueuedRow;
const context = (overrides: Partial<MessageDispatchHookContext> = {}) =>
  ({
    thread: thread(),
    attempt: "join-turn",
    initiator: "user",
    senderThreadId: null,
    experimental_submission: null,
    queuedMessages: [],
    ...overrides,
  }) as MessageDispatchHookContext;
const steer: Verdict = { action: "steer", source: "jev", confidence: 0.9, note: null };
const followup: Verdict = { action: "followup", source: "jev", confidence: 0.8, note: null };

function harness(verdict: Verdict | Promise<Verdict> = followup, overrides: Partial<SmartQueueDeps> = {}) {
  const calls = {
    steered: [] as string[],
    routed: [] as string[],
    grouped: [] as string[][],
    asked: [] as string[][],
    rechecks: 0,
    records: [] as unknown[],
    classified: 0,
  };
  let now = 1_000;
  const queue = new SmartQueue({
    pluginId: "smart-queue",
    enabled: async () => true,
    thread: async () => thread(),
    classify: async () => {
      calls.classified++;
      return verdict;
    },
    steer: async (r) => {
      calls.steered.push(r.id);
    },
    route: async (r) => {
      calls.routed.push(r.id);
    },
    list: async () => [],
    batch: async (_head, candidates) => {
      calls.asked.push(candidates.map((r) => r.id));
      return [];
    },
    group: async (_threadId, ids) => {
      calls.grouped.push(ids);
    },
    recheck: async () => {
      calls.rechecks++;
    },
    record: async (r) => {
      calls.records.push(r);
    },
    warn: () => {},
    now: () => now,
    ...overrides,
  });
  return { queue, calls, advance: (ms: number) => (now += ms) };
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

test("an owner message joining a busy turn is held while Smart Queue decides", async () => {
  const { queue } = harness();
  const decision = await queue.dispatch(context());
  assert.equal(decision.action, "wait");
  assert.equal(decision.action === "wait" && decision.reason, decidingReason);
});

test("idle threads, agent messages, and plugin submissions pass through", async () => {
  const { queue } = harness();
  for (const ctx of [
    context({ attempt: "start-turn", thread: thread({ status: "idle" }) }),
    context({ initiator: "agent" }),
    context({ senderThreadId: "thr_other" }),
    context({ experimental_submission: { pluginId: "bot-teams", data: null } }),
    context({ thread: thread({ visibility: "hidden" }) }),
  ])
    assert.deepEqual(await queue.dispatch(ctx), { action: "proceed" });
});

test("a disabled plugin never holds messages", async () => {
  const { queue } = harness(followup, { enabled: async () => false });
  assert.deepEqual(await queue.dispatch(context()), { action: "proceed" });
});

test("a steer decision sends the held row into the running turn", async () => {
  const { queue, calls } = harness(steer);
  queue.queued(row());
  await settle();
  assert.deepEqual(calls.steered, ["q_1"]);
  assert.equal(calls.records.length, 1);
});

test("a failed recheck after a follow-up decision warns instead of rejecting", async () => {
  const warnings: string[] = [];
  const { queue } = harness(followup, {
    recheck: async () => {
      throw new Error("hook offline");
    },
    warn: (message) => warnings.push(message),
  });
  queue.queued(row());
  await settle();
  assert.ok(warnings.some((message) => message.includes("hook offline")));
});

test("a follow-up decision keeps the row held until the thread is free", async () => {
  const { queue, calls } = harness(followup);
  queue.queued(row());
  await settle();
  assert.equal(calls.rechecks, 1, "the card reason refreshes");
  const busy = await queue.dispatch(context({ queuedMessages: [row()] }));
  assert.deepEqual(busy, { action: "wait", reason: followupReason(followup), sendAt: 1_000 + followupRecheckMs });
  await queue.settled("thr_1");
  assert.equal(calls.rechecks, 2);
  const idle = await queue.dispatch(context({ attempt: "start-turn", thread: thread({ status: "idle" }), queuedMessages: [row()] }));
  assert.deepEqual(idle, { action: "proceed" });
});

test("a pending decision re-holds the row, then times out to follow-up", async () => {
  const { queue, advance } = harness(new Promise<Verdict>(() => {}));
  queue.queued(row());
  await settle();
  const first = await queue.dispatch(context({ queuedMessages: [row()] }));
  assert.equal(first.action === "wait" && first.reason, decidingReason);
  advance(maxDecideMs);
  const second = await queue.dispatch(context({ queuedMessages: [row()] }));
  assert.equal(second.action === "wait" && second.reason.includes("follow-up"), true);
});

test("a row the plugin held before a restart waits as a follow-up", async () => {
  const { queue } = harness();
  const decision = await queue.dispatch(context({ queuedMessages: [row()] }));
  assert.equal(decision.action === "wait" && decision.reason.startsWith("Smart Queue: follow-up"), true);
});

test("core-queued owner rows are sent back through the hook, which holds them", async () => {
  const { queue, calls } = harness(steer);
  queue.queued(row({ waitingOn: { kind: "thread-busy" } }));
  queue.queued(row({ waitingOn: { kind: "thread-busy" } }));
  await settle();
  assert.deepEqual(calls.routed, ["q_1"], "routed once, without a decision of its own");
  assert.deepEqual(calls.steered, []);
  assert.equal(calls.classified, 0);
});

test("core-queued rows route in the order they were queued", async () => {
  const order: string[] = [];
  const { queue } = harness(steer, {
    thread: async () => {
      // The first row's thread read is the slow one.
      if (!order.length) await new Promise((resolve) => setTimeout(resolve, 5));
      return thread();
    },
    route: async (r) => {
      order.push(r.id);
    },
  });
  queue.queued(row({ id: "q_first", waitingOn: { kind: "thread-busy" } }));
  queue.queued(row({ id: "q_second", waitingOn: { kind: "thread-busy" } }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ["q_first", "q_second"]);
});

test("a core-queued row on an idle thread stays with core", async () => {
  const { queue, calls } = harness(steer, { thread: async () => thread({ status: "idle" }) });
  queue.queued(row({ waitingOn: { kind: "thread-busy" } }));
  await settle();
  assert.deepEqual(calls.routed, []);
  assert.equal(queue.entries.get("q_1")?.state, "ignored");
});

test("agent, plugin, retry, and timed rows are ignored", async () => {
  const { queue, calls } = harness(steer);
  for (const r of [
    row({ id: "a", initiator: "agent" }),
    row({ id: "b", originPluginId: "agent-checklists" }),
    row({ id: "c", payload: { kind: "retry", attempt: 2, reason: "x", retryOfTurnRequestId: "t" } }),
    row({ id: "d", waitingOn: { kind: "time" } }),
  ])
    queue.queued(r);
  await settle();
  assert.equal(calls.classified, 0);
});

test("a row sent or deleted mid-decision drops the decision", async () => {
  let release!: (verdict: Verdict) => void;
  const { queue, calls } = harness(new Promise<Verdict>((resolve) => (release = resolve)));
  queue.queued(row());
  await settle();
  queue.gone(row());
  release(steer);
  await settle();
  assert.deepEqual(calls.steered, []);
  assert.equal(queue.entries.size, 0);
});

test("a thread that went idle before classification releases the row without a model call", async () => {
  const { queue, calls } = harness(steer, { thread: async () => thread({ status: "idle" }) });
  queue.queued(row());
  await settle();
  assert.equal(calls.classified, 0);
  assert.equal(calls.rechecks, 1);
});

test("a failed steer falls back to follow-up", async () => {
  const { queue, calls } = harness(steer, {
    steer: async () => {
      throw new Error("HTTP 409 conflict");
    },
  });
  queue.queued(row());
  await settle();
  assert.equal(calls.rechecks, 1);
  const decision = await queue.dispatch(context({ queuedMessages: [row()] }));
  assert.equal(decision.action, "wait");
});

test("a steer that loses to a manual send is dropped, not relabeled as a follow-up", async () => {
  const { queue, calls } = harness(steer, {
    steer: async () => {
      throw new Error("BbHttpError: HTTP 409: Queued message is already being sent");
    },
  });
  queue.queued(row());
  await settle();
  assert.equal(queue.entries.size, 0);
  assert.equal(calls.records.length, 0);
  assert.equal(calls.rechecks, 0);
});

test("sending a held row by hand cancels its pending decision", async () => {
  let aborted = false;
  const { queue, calls, advance } = harness(steer, {
    classify: (_, __, signal) =>
      new Promise<Verdict>((_resolve, reject) =>
        signal.addEventListener("abort", () => ((aborted = true), reject(signal.reason)), { once: true }),
      ),
  });
  queue.queued(row());
  await settle();
  advance(10);
  queue.sync([row({ editable: false })], 1_005);
  await settle();
  assert.equal(aborted, true);
  assert.equal(queue.entries.size, 0, "a claimed row is not tracked again");
  assert.deepEqual(calls.steered, []);
  assert.equal(calls.records.length, 0);
});

test("editing a held row restarts its decision with the new text", async () => {
  const classified: string[] = [];
  let aborts = 0;
  const { queue, advance } = harness(followup, {
    classify: (r, _, signal) => {
      classified.push(r.content.map((block) => (block.type === "text" ? block.text : "")).join(""));
      if (classified.length === 1)
        return new Promise<Verdict>((_resolve, reject) =>
          signal.addEventListener("abort", () => (aborts++, reject(signal.reason)), { once: true }),
        );
      return Promise.resolve(followup);
    },
  });
  queue.queued(row());
  await settle();
  advance(10);
  const edited = row({ content: [{ type: "text", text: "Actually use Postgres", mentions: [] }] });
  queue.sync([edited], 1_005);
  await settle();
  assert.equal(aborts, 1);
  assert.deepEqual(classified, ["Actually use SQLite", "Actually use Postgres"]);
  assert.equal(queue.entries.get("q_1")?.state, "decided");
  advance(10);
  queue.sync([edited], 1_015);
  await settle();
  assert.equal(classified.length, 2, "an unchanged row is not classified again");
});

test("steers land in send order when a later classification finishes first", async () => {
  const releases = new Map<string, (verdict: Verdict) => void>();
  const { queue, calls } = harness(steer, {
    classify: (r) => new Promise<Verdict>((resolve) => releases.set(r.id, resolve)),
  });
  queue.queued(row({ id: "q_first", createdAt: 1 }));
  queue.queued(row({ id: "q_second", createdAt: 2 }));
  await settle();
  releases.get("q_second")!(steer);
  await settle();
  assert.deepEqual(calls.steered, [], "the later steer waits for the earlier decision");
  releases.get("q_first")!(steer);
  await settle();
  assert.deepEqual(calls.steered, ["q_first", "q_second"]);
});

test("an earlier follow-up does not block a later steer", async () => {
  const releases = new Map<string, (verdict: Verdict) => void>();
  const { queue, calls } = harness(steer, {
    classify: (r) => new Promise<Verdict>((resolve) => releases.set(r.id, resolve)),
  });
  queue.queued(row({ id: "q_first", createdAt: 1 }));
  queue.queued(row({ id: "q_second", createdAt: 2 }));
  await settle();
  releases.get("q_first")!(followup);
  releases.get("q_second")!(steer);
  await settle();
  assert.deepEqual(calls.steered, ["q_second"]);
});

test("editing a waiting steer invalidates its old decision", async () => {
  const releases = new Map<string, (verdict: Verdict) => void>();
  const { queue, calls, advance } = harness(steer, {
    classify: (r) => new Promise<Verdict>((resolve) => releases.set(r.id, resolve)),
  });
  const first = row({ id: "q_first", createdAt: 1 });
  const second = row({ id: "q_second", createdAt: 2 });
  queue.queued(first);
  queue.queued(second);
  await settle();
  releases.get(second.id)!(steer);
  await settle();
  advance(10);
  const edited = { ...second, content: [{ type: "text" as const, text: "A separate follow-up task", mentions: [] }] };
  queue.sync([first, edited], 1_005);
  await settle();
  releases.get(first.id)!(followup);
  await settle();
  assert.deepEqual(calls.steered, [], "the old decision cannot send the edited message");
  releases.get(second.id)!(followup);
  await settle();
  assert.deepEqual(calls.steered, []);
});

test("a timed-out earlier classifier releases a later steer even if it ignores abort", async () => {
  const { queue, calls, advance } = harness(steer, {
    classify: (r) => r.id === "q_first" ? new Promise<Verdict>(() => {}) : Promise.resolve(steer),
  });
  const first = row({ id: "q_first", createdAt: 1 });
  queue.queued(first);
  queue.queued(row({ id: "q_second", createdAt: 2 }));
  await settle();
  assert.deepEqual(calls.steered, []);
  advance(maxDecideMs);
  await queue.dispatch(context({ queuedMessages: [first] }));
  await settle();
  assert.deepEqual(calls.steered, ["q_second"]);
});

test("the watcher picks up rows the app queued directly and forgets rows that left", async () => {
  const { queue, calls, advance } = harness(steer);
  const appRow = row({ id: "q_app", waitingOn: { kind: "thread-busy" } });
  queue.sync([appRow], 1_000);
  await settle();
  assert.deepEqual(calls.routed, ["q_app"]);
  advance(10);
  queue.sync([], 1_005);
  assert.equal(queue.routed.has("q_app"), false, "a row gone from the snapshot is forgotten");
});

test("a snapshot older than a row never prunes it", async () => {
  const { queue } = harness(new Promise<Verdict>(() => {}));
  queue.queued(row({ id: "q_new" }));
  queue.sync([], 999);
  assert.equal(queue.entries.has("q_new"), true);
});

test("rows in threads Smart Queue skips are read once", async () => {
  let reads = 0;
  const { queue, calls } = harness(steer, {
    thread: async () => {
      reads++;
      return thread({ originPluginId: "bot-teams" });
    },
  });
  const botRow = row({ id: "q_bot", waitingOn: { kind: "thread-busy" } });
  queue.sync([botRow], 1_000);
  await settle();
  queue.sync([botRow], 1_000);
  await settle();
  assert.equal(reads, 1);
  assert.equal(calls.classified, 0);
});

/** Three follow-ups held on a thread that has just gone idle. */
async function idleWithFollowups(overrides: Partial<SmartQueueDeps> = {}, rows = [1, 2, 3].map((n) => row({ id: `q_${n}`, createdAt: n }))) {
  let status: ThreadInfo["status"] = "active";
  const h = harness(followup, { thread: async () => thread({ status }), list: async () => rows, ...overrides });
  for (const r of rows) h.queue.queued(r);
  await settle();
  status = "idle";
  const release = () => h.queue.dispatch(context({ attempt: "start-turn", thread: thread({ status }), queuedMessages: [rows[0]!] }));
  return { ...h, rows, release };
}

test("related follow-ups are grouped into one turn, wherever they were queued", async () => {
  const { calls, release } = await idleWithFollowups({
    batch: async (_head, candidates) => candidates.filter((r) => r.id === "q_3").map((r) => r.id),
    group: async (_threadId, ids) => {
      calls.grouped.push(ids);
    },
  });
  const rechecks = calls.rechecks;
  const held = await release();
  assert.equal(held.action === "wait" && held.reason, batchingReason);
  await settle();
  assert.deepEqual(calls.grouped, [["q_1", "q_3"]]);
  assert.equal(calls.rechecks, rechecks + 1, "the grouped turn is released");
  assert.deepEqual(await release(), { action: "proceed" });
});

test("the next turn's follow-ups are weighed again once the thread was busy", async () => {
  const { queue, calls, release } = await idleWithFollowups();
  await release();
  await settle();
  assert.deepEqual(calls.asked, [["q_2", "q_3"]]);
  assert.deepEqual(calls.grouped, [], "nothing related, so nothing grouped");
  assert.deepEqual(await release(), { action: "proceed" });
  await queue.dispatch(context({ queuedMessages: [row({ id: "q_2" })] }));
  assert.equal((await release()).action, "wait", "a busy spell clears the plan");
});

test("a single follow-up is released without asking", async () => {
  const { calls, release } = await idleWithFollowups({}, [row()]);
  assert.deepEqual(await release(), { action: "proceed" });
  assert.deepEqual(calls.asked, []);
});

test("rows the owner grouped by hand, or that run differently, are not regrouped", async () => {
  const handGrouped = await idleWithFollowups({}, [row({ id: "q_1", groupWithNext: true }), row({ id: "q_2" })]);
  await handGrouped.release();
  await settle();
  assert.deepEqual(handGrouped.calls.asked, []);

  const mixed = await idleWithFollowups({}, [row({ id: "q_1" }), row({ id: "q_2", model: "other" }), row({ id: "q_3" })]);
  await mixed.release();
  await settle();
  assert.deepEqual(mixed.calls.asked, [["q_3"]]);
});

test("a failed grouping still releases the follow-ups one turn each", async () => {
  const warnings: string[] = [];
  const { calls, release } = await idleWithFollowups({
    batch: async () => {
      throw new Error("Jev is down");
    },
    warn: (message) => warnings.push(message),
  });
  await release();
  await settle();
  assert.match(warnings.join("\n"), /Jev is down/);
  assert.deepEqual(calls.grouped, []);
  assert.deepEqual(await release(), { action: "proceed" });
});

test("core rows the owner grouped by hand stay with core", async () => {
  const { queue, calls } = harness();
  queue.queued(row({ waitingOn: { kind: "thread-busy" }, groupWithNext: true }));
  await settle();
  assert.deepEqual(calls.routed, []);
});

test("visible bot profile threads use Smart Queue for owner sends", async()=>{
 const {queue}=harness();
 const decision=await queue.dispatch(context({thread:thread({originPluginId:"bot-teams"})}));
 assert.equal(decision.action,"wait");
});

test("a snapshot taken before a row was sent does not decide it again", async () => {
  const { queue, calls, advance } = harness(followup);
  queue.queued(row());
  await settle();
  assert.equal(calls.classified, 1);
  // The watcher lists the queue, then the row is sent before the list returns.
  const listedAt = 1_000;
  advance(10);
  queue.gone(row());
  queue.sync([row()], listedAt);
  await settle();
  assert.equal(calls.classified, 1, "the sent row is not classified twice");
  assert.equal(calls.records.length, 1);
  assert.equal(queue.entries.size, 0);
});

test("a row restored after a failed take-over is left with core, not taken over again", async () => {
  let attempts = 0;
  const { queue, advance } = harness(steer, {
    route: async () => {
      attempts++;
      throw new RouteFailed("Another plugin rejected the message.", "q_restored");
    },
  });
  queue.sync([row({ id: "q_core", waitingOn: { kind: "thread-busy" } })], 1_000);
  await settle();
  assert.equal(attempts, 1);
  advance(10);
  queue.sync([row({ id: "q_restored", waitingOn: { kind: "thread-busy" } })], 1_005);
  await settle();
  assert.equal(attempts, 1, "the restored row is not deleted and re-sent in a loop");
});


test("Studio-owned visible work remains eligible after queue ownership moves to Studio", async () => {
  const { queue } = harness(followup, { pluginId: "studio" });
  assert.equal(queue.eligibleThread(thread({ originPluginId: "studio" })), true);
  assert.equal(queue.eligibleThread(thread({ originPluginId: "studio", visibility: "hidden" })), false);
  queue.dispose();
});

const sleepMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a message the composer steered steers when Jev misses the decision budget", async () => {
  const { queue, calls } = harness(new Promise<Verdict>(() => {}), { decideBudgetMs: 20 });
  queue.queued(row());
  await sleepMs(40);
  await settle();
  assert.deepEqual(calls.steered, ["q_1"]);
  const [record] = calls.records as { verdict: Verdict; ms: number }[];
  assert.equal(record.verdict.source, "default");
  assert.equal(record.verdict.action, "steer");
});

test("a message the owner queued stays a follow-up when Jev misses the budget", async () => {
  let routed: QueuedRow | null = null;
  const { queue, calls } = harness(new Promise<Verdict>(() => {}), {
    decideBudgetMs: 20,
    route: async (r) => {
      routed = r;
    },
  });
  queue.queued(row({ id: "q_core", waitingOn: { kind: "thread-busy" } }));
  await settle();
  assert.ok(routed);
  // The re-sent copy comes back held by Smart Queue under a new id.
  queue.queued(row({ id: "q_held" }));
  await sleepMs(40);
  await settle();
  assert.deepEqual(calls.steered, []);
  const [record] = calls.records as { verdict: Verdict }[];
  assert.equal(record.verdict.action, "followup");
});

test("no classifier answering sends the message the way BB would", async () => {
  const { queue, calls } = harness({ action: "followup", source: "default", confidence: null, note: "Jev: down" });
  queue.queued(row());
  await settle();
  assert.deepEqual(calls.steered, ["q_1"]);
});

test("a turn kept open only by background work is not busy: the message steers without asking Jev", async () => {
  const { queue, calls } = harness(followup, { mainRunIdle: async () => true });
  queue.queued(row());
  await settle();
  assert.equal(calls.classified, 0);
  assert.deepEqual(calls.steered, ["q_1"]);
});

test("held follow-ups are sent once the agent's run ends, oldest first", async () => {
  let idle = false;
  const { queue, calls } = harness(followup, { mainRunIdle: async () => idle });
  queue.queued(row({ id: "q_b", createdAt: 2 }));
  queue.queued(row({ id: "q_a", createdAt: 1 }));
  await settle();
  await queue.releaseFinished();
  assert.deepEqual(calls.steered, [], "still running: they wait");
  idle = true;
  await queue.releaseFinished();
  assert.deepEqual(calls.steered, ["q_a", "q_b"]);
  await queue.releaseFinished();
  assert.deepEqual(calls.steered, ["q_a", "q_b"], "sent once");
});

test("on a background-only turn, a new message waits for older held follow-ups: A then B", async () => {
  let idle = false;
  const verdicts = new Map<string, Verdict>([["q_a", followup]]);
  const { queue, calls } = harness(followup, {
    mainRunIdle: async () => idle,
    classify: async (r) => verdicts.get(r.id) ?? steer,
  });
  queue.queued(row({ id: "q_a", createdAt: 1 }));
  await settle();
  assert.deepEqual(calls.steered, [], "A is held as a follow-up");
  idle = true;
  queue.queued(row({ id: "q_b", createdAt: 2, content: [{ type: "text", text: "and this", mentions: [] }] }));
  await settle();
  assert.deepEqual(calls.steered, ["q_a", "q_b"]);
  await queue.releaseFinished();
  assert.deepEqual(calls.steered, ["q_a", "q_b"], "nothing is sent twice");
});

test("a Jev answer that arrives after the budget is dropped: one steer, one record", async () => {
  const late = new Promise<Verdict>((resolve) => setTimeout(() => resolve(steer), 40));
  const { queue, calls } = harness(late, { decideBudgetMs: 20 });
  queue.queued(row());
  await sleepMs(70);
  await settle();
  assert.deepEqual(calls.steered, ["q_1"]);
  assert.equal(calls.records.length, 1);
  assert.equal((calls.records[0] as { verdict: Verdict }).verdict.source, "default");
});

test("a turn still running (a tool, a pending approval) asks Jev and holds a follow-up", async () => {
  const { queue, calls } = harness(followup, { mainRunIdle: async () => false });
  queue.queued(row());
  await settle();
  assert.equal(calls.classified, 1);
  assert.deepEqual(calls.steered, []);
});

test("a release that fails partway keeps the order and retries the rest once", async () => {
  let idle = false;
  let failB = true;
  const steered: string[] = [];
  const warnings: string[] = [];
  const { queue } = harness(followup, {
    mainRunIdle: async () => idle,
    steer: async (r) => {
      if (r.id === "q_b" && failB) {
        failB = false;
        throw new Error("bridge busy");
      }
      steered.push(r.id);
    },
    warn: (message) => warnings.push(message),
  });
  queue.queued(row({ id: "q_a", createdAt: 1 }));
  queue.queued(row({ id: "q_b", createdAt: 2 }));
  queue.queued(row({ id: "q_c", createdAt: 3 }));
  await settle();
  idle = true;
  await queue.releaseFinished();
  assert.deepEqual(steered, ["q_a"], "B failed, so C waits behind it");
  const b = queue.entries.get("q_b");
  assert.equal(b?.state === "decided" ? b.verdict.action : null, "followup");
  await queue.releaseFinished();
  assert.deepEqual(steered, ["q_a", "q_b", "q_c"]);
  assert.equal(warnings.length, 1);
});

test("a release error never puts back a row that was sent or cancelled meanwhile, and warns once", async () => {
  const warnings: string[] = [];
  let queueRef: SmartQueue | null = null;
  const { queue } = harness(followup, {
    mainRunIdle: async () => idleNow,
    steer: async (r) => {
      queueRef!.gone({ id: r.id });
      throw new Error("bridge busy");
    },
    warn: (message) => warnings.push(message),
  });
  let idleNow = false;
  queueRef = queue;
  queue.queued(row());
  await settle();
  idleNow = true;
  await queue.releaseFinished();
  assert.equal(queue.entries.has("q_1"), false);
  await queue.releaseFinished();
  assert.equal(warnings.filter((w) => w.includes("could not release")).length, 1);
});

test("a re-send that never comes back held does not make a later steer a follow-up", async () => {
  let at = 0;
  const { queue, calls } = harness(new Promise<Verdict>(() => {}), {
    decideBudgetMs: 20,
    now: () => at,
    route: async () => {},
  });
  queue.queued(row({ id: "q_core", waitingOn: { kind: "thread-busy" } }));
  await settle();
  at += 10_000; // The copy was never held.
  queue.queued(row({ id: "q_steer" }));
  await sleepMs(40);
  await settle();
  assert.deepEqual(calls.steered, ["q_steer"]);
});

test("the decision budget starts when the hook held the message", async () => {
  let at = 1_000;
  const { queue, calls } = harness(new Promise<Verdict>(() => {}), { decideBudgetMs: 1_500, now: () => at });
  await queue.dispatch(context({ input: { blocks: [], text: "Actually use SQLite" } } as never));
  at += 1_490; // message.queued arrived late.
  queue.queued(row());
  await sleepMs(40);
  await settle();
  assert.deepEqual(calls.steered, ["q_1"], "only ~10 ms of budget was left");
});

test("gone() bounds departed map, forget() clears releaseWarnedAt, and dispose() clears all tracking maps", async () => {
  let at = 1_000;
  const { queue } = harness(new Promise<Verdict>(() => {}), { now: () => at });
  const internal = queue as unknown as {
    departed: Map<string, number>;
    releaseWarnedAt: Map<string, number>;
    heldAt: Map<string, number>;
  };

  // Bound departed map to maxDeparted even when sync() is never called.
  for (let i = 0; i < 550; i += 1) {
    queue.routed.add(`r_${i}`);
    queue.gone({ id: `r_${i}` });
  }
  assert.equal(internal.departed.size, 500);

  // Evict expired departed entries by TTL.
  at += 6 * 60_000;
  queue.routed.add("r_fresh");
  queue.gone({ id: "r_fresh" });
  assert.equal(internal.departed.size, 1);

  // forget() clears releaseWarnedAt for forgotten thread rows.
  queue.queued(row({ id: "q_warn", threadId: "thr_1" }));
  internal.releaseWarnedAt.set("q_warn", at);
  queue.forget("thr_1");
  assert.equal(internal.releaseWarnedAt.has("q_warn"), false);

  // dispose() clears departed, releaseWarnedAt, heldAt, and routed.
  queue.routed.add("r_keep");
  internal.heldAt.set("thr_1\0hi", at);
  internal.releaseWarnedAt.set("q_other", at);
  queue.dispose();
  assert.equal(internal.departed.size, 0);
  assert.equal(internal.releaseWarnedAt.size, 0);
  assert.equal(internal.heldAt.size, 0);
  assert.equal(queue.routed.size, 0);
});

test("releaseWarnedAt is cleared on 404 and not written when a row disappeared mid-release", async () => {
  let at = 1_000;
  let steerCall = 0;
  const warnings: string[] = [];
  const { queue } = harness(
    { action: "followup", source: "jev", confidence: 0.9, note: null },
    {
      now: () => at,
      warn: (msg) => warnings.push(msg),
      steer: async ({ id }) => {
        steerCall += 1;
        if (steerCall === 1) throw new Error("temporary network error");
        if (steerCall === 2) throw new Error("HTTP 404: not found");
        // 3rd call: row vanishes via gone() while steer is failing
        queue.gone({ id });
        throw new Error("temporary network error");
      },
    },
  );
  const internal = queue as unknown as { releaseWarnedAt: Map<string, number> };

  // Row 1: first release fails (sets releaseWarnedAt), second hits 404 (must delete releaseWarnedAt).
  queue.queued(row({ id: "q_404", threadId: "thr_1", createdAt: 1 }));
  await settle();
  await (queue as unknown as { releaseThread(t: string, before: QueuedRow): Promise<void> }).releaseThread("thr_1", row({ id: "q_after", createdAt: 2 }));
  assert.equal(internal.releaseWarnedAt.has("q_404"), true);

  await (queue as unknown as { releaseThread(t: string, before: QueuedRow): Promise<void> }).releaseThread("thr_1", row({ id: "q_after", createdAt: 2 }));
  assert.equal(queue.entries.has("q_404"), false);
  assert.equal(internal.releaseWarnedAt.has("q_404"), false);

  // Row 2: gone() runs while steer fails -> must not write releaseWarnedAt.
  queue.queued(row({ id: "q_vanished", threadId: "thr_1", createdAt: 3 }));
  await settle();
  await (queue as unknown as { releaseThread(t: string, before: QueuedRow): Promise<void> }).releaseThread("thr_1", row({ id: "q_after2", createdAt: 4 }));
  assert.equal(internal.releaseWarnedAt.has("q_vanished"), false);
  assert.equal(warnings.length, 2);
});

test("after departed TTL expires, a stale sync snapshot from before the row left hits 404 and is ignored without sending", async () => {
  let at = 1_000;
  const warnings: string[] = [];
  const steered: string[] = [];
  const { queue } = harness(
    { action: "steer", source: "jev", confidence: 0.9, note: null },
    {
      now: () => at,
      warn: (msg) => warnings.push(msg),
      steer: async ({ id }) => {
        if (id === "q_stale") throw new Error("HTTP 404: not found");
        steered.push(id);
      },
    },
  );

  // Row was tracked and then left the queue.
  const staleRow = row({ id: "q_stale", threadId: "thr_1", createdAt: 1 });
  const listedBeforeGone = at;
  queue.queued(staleRow);
  queue.gone(staleRow);

  // Advance past departedTtlMs and trigger eviction via another gone() row.
  at += 6 * 60_000;
  queue.routed.add("q_other");
  queue.gone({ id: "q_other" });

  // Stale snapshot taken before q_stale left arrives after departed TTL expired.
  queue.sync([staleRow], listedBeforeGone);
  await settle();

  // The stale row hits 404 on steer, is dropped cleanly, never sent, and produces no warning.
  assert.deepEqual(steered, []);
  assert.equal(queue.entries.has("q_stale"), false);
  assert.deepEqual(warnings, []);
});
