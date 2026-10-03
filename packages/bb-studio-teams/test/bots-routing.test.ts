
import { test } from "vitest";
import assert from "node:assert/strict";





import { createFakePluginHost, makeThreadResponse, makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";



import { jobPrompt } from "../mission-runtime";




import { setup, deferred } from "./bots-fixture";

test("successful empty missions finish quietly instead of failing or synthesizing a reply", async () => {
  const x = setup();
  try {
    for (const [index, text] of [null, "", " \n\t", "[PASS]", "**[pass]**"].entries()) {
      const id = `quiet-${index}`;
      x.runtime.enqueue(x.a, { id, text: "Check for changes", conversationKey: id });
      await x.runtime.drive(x.a);
      const job = x.store.job(id)!;
      x.runtime.complete(job.threadId!, text);
      assert.equal(x.store.job(id)?.status, "done");
      assert.equal(x.store.job(id)?.reply, null);
      assert.equal(x.store.job(id)?.error, null);
    }
  } finally { await x.close(); }
});

test("uncertain dispatch is visible after restart and is never replayed", async () => {
  const x = setup();
  try {
    x.runtime.enqueue(x.a, {
      id: "uncertain",
      text: "Make a change",
      conversationKey: "mission",
      status: "dispatching",
    });
    await x.runtime.drive(x.a);
    assert.equal(x.store.job("uncertain")?.status, "error");
    assert.equal(x.harness.inspection.sdk.callsTo("threads.send").length, 0);
  } finally {
    await x.close();
  }
});

test("unrelated threads cannot claim a bot identity using metadata", async () => {
  const host = createFakePluginHost({
    pluginId: "bot-teams",
    agentSkillIds: ["bots"],
  });
  await plugin(host.bb);
  try {
    const result = await host.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({
        pluginMetadata: { botId: "bot_0123456789abcdef" },
      }),
    );
    assert.ok(result.tools.some((t) => t.name === "bots_view_read"));
    assert.ok(!result.tools.some((t) => t.name === "bots_react"));
    assert.equal(result.instructions, null);
    assert.deepEqual(await host.harness.behavior.callRpc("list", null), {
      bots: [],
      views: [],
      directThreads: {},
      directConversations: {},
      directThreadInfo: {},
      botCreateRequests: [],
    });
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

test("roster identifies current direct threads independently of bot jobs", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    x.store.putConversation({
      id: "archived-direct", botId: x.a.id, key: "history:old",
      threadId: "thr_old", title: "Old", kind: "admin", createdAt: 1,
      archivedAt: 2,
    });
    x.store.putConversation({
      id: "current-direct", botId: x.a.id, key: "admin",
      threadId: "thr_current", title: "Current", kind: "admin", createdAt: 3,
    });
    x.store.putConversation({
      id: "group-primary", botId: x.a.id, key: `group:${x.room.id}`,
      threadId: "thr_group", title: "Group", kind: "mission", createdAt: 3,
    });
    x.store.putConversation({
      id: "group-fork", botId: x.b.id, key: `group:${x.room.id}:fork:message`,
      threadId: "thr_fork", title: "Group fork", kind: "mission", createdAt: 3,
    });
    const currentThread = makeThreadResponse({ id: "thr_current", status: "active" });
    const directEntry = {
      ...currentThread,
      runtime: { ...currentThread.runtime, displayStatus: "active" as const },
      activity: {
        activeBackgroundAgentCount: 0,
        activeBackgroundCommandCount: 0,
        activeGoalCount: 0,
        activePlanModeCount: 0,
        activeWorkflowCount: 0,
      },
      hasPendingInteraction: false,
      queuedWork: "none" as const,
      pinSortKey: null,
      environmentBranchName: null,
      environmentHostId: null,
      environmentIsWorktree: null,
      environmentName: null,
      environmentPath: null,
      environmentProviderId: null,
      environmentWorkspaceDisplayKind: "other" as const,
    };
    x.harness.inspection.sdk.stub("threads.list", async () => [
      directEntry,
      { ...directEntry, id: "thr_group", status: "idle" as const,
        runtime: { ...directEntry.runtime, displayStatus: "idle" as const },
        activity: { ...directEntry.activity, activeBackgroundAgentCount: 1 } },
      { ...directEntry, id: "thr_fork", status: "idle" as const,
        runtime: { ...directEntry.runtime, displayStatus: "idle" as const },
        queuedWork: "waiting" as const },
    ]);
    const listed = await x.harness.behavior.callRpc("list", null) as {
      directThreads: Record<string, { threadId: string; indicator: string; status: string }>;
      roomThreads: Record<string, { threadId: string; indicator: string; status: string }[]>;
      bots: { id: string; working: boolean }[];
    };
    assert.deepEqual(listed.directThreads, {
      [x.a.id]: { threadId: "thr_current", status: "active", indicator: "runtime" },
    });
    assert.equal(listed.bots.find((entry) => entry.id === x.a.id)?.working, false);
  } finally {
    await x.close();
  }
});

test("recovery collects accepted output without a recorded active event", async () => {
  const x = setup();
  try {
    for (const status of ["dispatching", "running"] as const) {
      const id = `recover-${status}`,
        threadId = `thread-${status}`;
      x.store.putConversation({
        id,
        botId: x.a.id,
        key: id,
        threadId,
        title: "Recovery",
        kind: "mission",
        createdAt: 1,
      });
      x.runtime.enqueue(x.a, {
        id,
        text: "hello",
        conversationKey: id,
        threadId,
        status,
      });
      x.harness.inspection.sdk.stub("threads.output", async () => ({
        output: `Answer for ${status}`,
      }));
      await x.runtime.drive(x.a);
      assert.equal(x.store.job(id)?.status, "done");
      assert.equal(x.store.job(id)?.reply, `Answer for ${status}`);
    }
    assert.equal(x.harness.inspection.sdk.callsTo("threads.send").length, 0);
  } finally {
    await x.close();
  }
});

test("persistent sessions reject a delayed answer from an earlier request", async () => {
  const x = setup();
  try {
    x.runtime.enqueue(x.a, {
      id: "one",
      text: "one",
      conversationKey: "mission",
    });
    await x.runtime.drive(x.a);
    const first = x.store.job("one")!;
    x.runtime.complete(first.threadId!, "first answer");
    x.runtime.enqueue(x.a, {
      id: "two",
      text: "two",
      conversationKey: "mission",
    });
    await x.runtime.drive(x.a);
    const second = x.store.job("two")!;
    assert.equal(second.threadId, first.threadId);
    x.harness.inspection.sdk.stub("threads.timeline", async () => ({
      rows: [{ kind: "conversation", role: "user", text: jobPrompt(first) }],
    }));
    await x.runtime.settleFromEvent(first.threadId!, "duplicate old answer");
    assert.equal(x.store.job("two")!.status, "running");
    assert.equal(x.store.job("two")!.reply, null);
  } finally {
    await x.close();
  }
});

test("cancellation wins while recovery waits for core queue state", async () => {
  const x = setup();
  try {
    x.runtime.enqueue(x.a, {
      id: "race",
      text: "work",
      conversationKey: "mission",
    });
    await x.runtime.drive(x.a);
    const entered = deferred<void>(),
      finish = deferred<void>();
    x.harness.inspection.sdk.stub("threads.get", async () =>
      makeThreadResponse({ status: "active" }),
    );
    x.harness.inspection.sdk.stub("threads.queuedMessages.list", async () => {
      entered.resolve();
      await finish.promise;
      return [];
    });
    const drive = x.runtime.drive(x.a);
    await entered.promise;
    const cancel = x.runtime.cancel(x.store.job("race")!, "Owner stopped");
    finish.resolve();
    await Promise.all([drive, cancel]);
    assert.equal(x.store.job("race")!.status, "cancelled");
  } finally {
    await x.close();
  }
});

test("cancelled spawn recovery preserves cancellation and removes delayed input", async () => {
  const x = setup();
  try {
    x.runtime.enqueue(x.a, {
      id: "lost",
      text: "work",
      conversationKey: "mission",
      status: "dispatching",
    });
    const entered = deferred<void>(),
      finish = deferred<void>();
    x.harness.inspection.sdk.stub("threads.list", async () => {
      entered.resolve();
      await finish.promise;
      return [makeThreadResponse({ id: "thr_lost" })];
    });
    x.harness.inspection.sdk.stub("threads.getPluginMetadata", async () => ({
      botId: x.a.id,
      conversationKey: "mission:lost",
    }));
    const drive = x.runtime.drive(x.a);
    await entered.promise;
    await x.runtime.cancel(x.store.job("lost")!, "Owner stopped");
    finish.resolve();
    await drive;
    assert.equal(x.store.job("lost")!.status, "cancelled");
    assert.equal(x.store.job("lost")!.threadId, "thr_lost");
    assert.equal(x.harness.inspection.sdk.callsTo("threads.stop").length, 1);
  } finally {
    await x.close();
  }
});

test("cancellation during a slow spawn cleans up the newly returned thread", async () => {
  const x = setup();
  try {
    x.runtime.enqueue(x.a, {
      id: "slow",
      text: "work",
      conversationKey: "mission",
    });
    const entered = deferred<void>(),
      finish = deferred<void>();
    x.harness.inspection.sdk.stub("threads.spawn", async () => {
      entered.resolve();
      await finish.promise;
      return makeThreadResponse({ id: "thr_slow" });
    });
    const drive = x.runtime.drive(x.a);
    await entered.promise;
    await x.runtime.cancel(x.store.job("slow")!, "Owner stopped");
    finish.resolve();
    await drive;
    assert.equal(x.store.job("slow")!.status, "cancelled");
    assert.equal(x.harness.inspection.sdk.callsTo("threads.stop").length, 1);
  } finally {
    await x.close();
  }
});

test("queue age is excluded from the execution timeout", async () => {
  const x = setup();
  try {
    x.runtime.enqueue(x.a, {
      id: "old",
      text: "work",
      conversationKey: "mission",
      createdAt: Date.now() - 3600000,
    });
    await x.runtime.drive(x.a);
    const j = x.store.job("old")!;
    x.harness.inspection.sdk.stub("threads.queuedMessages.list", async () => [
      { id: "queued", content: [{ type: "text", text: jobPrompt(j) }] },
    ]);
    await x.runtime.drive(x.a);
    assert.equal(x.store.job("old")!.status, "running");
    assert.ok(x.store.job("old")!.dispatchStartedAt! > Date.now() - 5000);
    // The computer slept for half an hour: the gap doesn't count against the turn.
    x.store.setTurnClock("old", { turnMs: 60000, clockAt: Date.now() - 30 * 60000 });
    await x.runtime.drive(x.a);
    assert.equal(x.store.job("old")!.status, "running");
    assert.equal(x.store.job("old")!.wrapUpRequestedAt, undefined);
    assert.ok(x.store.job("old")!.turnMs! < 2 * 60000);
    // Twenty minutes the runtime watched pass time it out.
    x.store.setTurnClock("old", { turnMs: 21 * 60000, clockAt: Date.now() });
    await x.runtime.drive(x.a);
    assert.equal(x.store.job("old")!.status, "cancelled");
  } finally {
    await x.close();
  }
});

/** A running mission job whose thread shows `rows` since it started. */
async function runningJob(x: ReturnType<typeof setup>, rows: unknown[]) {
  x.runtime.enqueue(x.a, { id: "slow", text: "work", conversationKey: "mission" });
  await x.runtime.drive(x.a);
  x.harness.inspection.sdk.stub("threads.queuedMessages.list", async () => [
    { id: "queued", content: [{ type: "text", text: jobPrompt(x.store.job("slow")!) }] },
  ]);
  // Each row happened just now, during the turn.
  x.harness.inspection.sdk.stub("threads.timeline", async () => ({ rows: rows.map((row) => ({ ...(row as object), createdAt: Date.now() })) }));
  await x.runtime.drive(x.a);
  assert.equal(x.store.job("slow")!.status, "running");
}

test("a turn that made no progress is sent again once, not told to wrap up", async () => {
  const x = setup();
  try {
    await runningJob(x, [{ id: "retry", kind: "system", systemKind: "operation", title: "API retry 2/10" }]);
    x.store.setTurnClock("slow", { turnMs: 16 * 60000, clockAt: Date.now() });
    await x.runtime.drive(x.a);
    const retried = x.store.job("slow")!;
    assert.equal(retried.status, "queued");
    assert.equal(retried.wrapUpRequestedAt, undefined);
    assert.ok(retried.stallRetriedAt);
    assert.equal(retried.turnMs, undefined);
    assert.equal(x.harness.inspection.sdk.callsTo("threads.stop").length, 1);
    assert.match(jobPrompt(retried), /^Retry: the previous attempt/m);
    // It goes out again; stalling again, it isn't retried twice or told to wrap up.
    x.harness.inspection.sdk.stub("threads.queuedMessages.list", async () => [
      { id: "queued", content: [{ type: "text", text: jobPrompt(x.store.job("slow")!) }] },
    ]);
    await x.runtime.drive(x.a);
    await x.runtime.drive(x.a);
    assert.equal(x.store.job("slow")!.status, "running");
    x.store.setTurnClock("slow", { turnMs: 16 * 60000, clockAt: Date.now() });
    await x.runtime.drive(x.a);
    assert.equal(x.store.job("slow")!.status, "running");
    assert.equal(x.store.job("slow")!.wrapUpRequestedAt, undefined);
    x.store.setTurnClock("slow", { turnMs: 21 * 60000, clockAt: Date.now() });
    await x.runtime.drive(x.a);
    assert.equal(x.store.job("slow")!.status, "cancelled");
    assert.match(x.store.job("slow")!.error!, /no progress .* even after a retry/);
  } finally {
    await x.close();
  }
});

test("a turn that is working gets the wrap-up request", async () => {
  const x = setup();
  try {
    await runningJob(x, [{ id: "cmd", kind: "work", workKind: "command", command: "ls" }]);
    x.store.setTurnClock("slow", { turnMs: 16 * 60000, clockAt: Date.now() });
    await x.runtime.drive(x.a);
    assert.ok(x.store.job("slow")!.wrapUpRequestedAt);
    assert.equal(x.store.job("slow")!.stallRetriedAt, undefined);
  } finally {
    await x.close();
  }
});

test("lost spawn responses recover the exact accepted thread without resubmitting", async () => {
  const x = setup();
  try {
    x.runtime.enqueue(x.a, {
      id: "accepted",
      text: "work",
      conversationKey: "mission",
      status: "dispatching",
    });
    x.harness.inspection.sdk.stub("threads.list", async () => [
      makeThreadResponse({ id: "thr_accepted" }),
    ]);
    x.harness.inspection.sdk.stub("threads.getPluginMetadata", async () => ({
      botId: x.a.id,
      conversationKey: "mission:accepted",
    }));
    await x.runtime.drive(x.a);
    assert.equal(x.store.job("accepted")!.threadId, "thr_accepted");
    assert.ok(x.store.byThread("thr_accepted"));
    x.harness.inspection.sdk.stub("threads.output", async () => ({
      output: "Completed once",
    }));
    await x.runtime.drive(x.a);
    assert.equal(x.store.job("accepted")!.reply, "Completed once");
    assert.equal(x.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  } finally {
    await x.close();
  }
});

test("idle recovery settles a running no-output job as an error", async () => {
  const x = setup();
  try {
    x.runtime.enqueue(x.a, {
      id: "idle-no-output",
      text: "work",
      conversationKey: "mission",
    });
    await x.runtime.drive(x.a);
    assert.equal(x.store.job("idle-no-output")!.status, "running");
    x.harness.inspection.sdk.stub("threads.output", async () => ({
      output: "",
    }));
    await x.runtime.drive(x.a);
    const job = x.store.job("idle-no-output")!;
    assert.equal(job.status, "error");
    assert.match(job.error ?? "", /Dispatch outcome is unknown/);
  } finally {
    await x.close();
  }
});
