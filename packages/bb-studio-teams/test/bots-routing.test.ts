import { createTestStore } from "./test-store";
import { test } from "vitest";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  createFakePluginHost,
  makeThreadResponse,
  makePluginAgentConfigurationContext,
  makeMessageDispatchHookContext,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { agentAuthor, requestStatus } from "../agent-channels";
import { channelWork } from "../channel-work";
import { Store, document, saveDocument } from "../store";
import { Runtime, jobPrompt, mentioned, recipients } from "../runtime";
import { profileInput, roomSchema, type Bot, type Conversation, type Room } from "../contract";
import { channelHandoffText } from "../handoff-draft";
import { directMessageId } from "../direct-messages";

import { bot, setup, deferred } from "./bots-fixture";

test("queued bot responses use current room context when they start", async () => {
  const x = setup();
  try {
    x.runtime.send(x.room, "@atlas first", randomUUID());
    x.runtime.send(x.room, "Latest context from the owner", randomUUID());
    await x.runtime.drive(x.a);
    assert.match(
      x.store.work(x.a.id)[0]!.text,
      /Latest context from the owner/,
    );
  } finally {
    await x.close();
  }
});

test("mention follow-ups are bounded and PASS remains silent", async () => {
  const x = setup();
  try {
    x.runtime.returnDecision = async () => true;
    const root = randomUUID();
    x.runtime.send(x.room, "@atlas begin", root);
    let count = 0;
    for (let i = 0; i < 10; i++) {
      const run = x.store.runs(x.room.id)[0]!;
      if (run.status === "done") break;
      const job = x.store.job(run.pendingJobIds[0]!)!;
      job.status = "done";
      job.reply =
        job.botId === x.a.id ? "@scribe please review" : "@atlas follow up";
      x.store.putJob(job);
      count++;
      await x.runtime.driveRoom(x.room);
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(count, 3);
    assert.equal(x.store.runs(x.room.id)[0]!.status, "done");
    x.runtime.send(x.room, "@atlas silent test", randomUUID());
    const job = x.store.work(x.a.id)[0]!;
    job.status = "done";
    job.reply = "[PASS]";
    x.store.putJob(job);
    await x.runtime.driveRoom(x.room);
    assert.equal(
      x.store.messages(x.room.id).some((m) => m.text === "[PASS]"),
      false,
    );
  } finally {
    await x.close();
  }
});

test("stopping a group cancels current work and queued human continuations", async () => {
  const x = setup();
  try {
    x.runtime.send(x.room, "First", randomUUID());
    x.runtime.send(x.room, "Second", randomUUID());
    await x.runtime.driveRoom(x.room);
    await x.runtime.drive(x.a);
    await x.runtime.stopRoom(x.room);
    assert.equal(x.store.room(x.room.id).paused, false);
    assert.ok(x.store.runs(x.room.id).every((r) => r.status === "stopped"));
    assert.equal(x.store.work(x.a.id).length, 0);
    assert.equal(x.harness.inspection.sdk.callsTo("threads.stop").length, 1);
    x.runtime.complete("thr_bot_1", "Late reply must not appear");
    await x.runtime.driveRoom(x.store.room(x.room.id));
    assert.equal(x.store.messages(x.room.id).length, 2);
  } finally {
    await x.close();
  }
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
    assert.ok(result.tools.some((t) => t.name === "bots_channel_send"));
    assert.ok(!result.tools.some((t) => t.name === "bots_react"));
    assert.equal(result.instructions, null);
    assert.deepEqual(await host.harness.behavior.callRpc("list", null), {
      bots: [],
      rooms: [],
      activeRoomIds: [],
      directThreads: {},
      directConversations: {},
      directThreadInfo: {},
      roomThreads: {},
      roomWork: {},
      attentionCounts: {},
      approvalCounts: {},
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
      threadId: "thr_group", title: "Group", kind: "group", createdAt: 3,
    });
    x.store.putConversation({
      id: "group-fork", botId: x.b.id, key: `group:${x.room.id}:fork:message`,
      threadId: "thr_fork", title: "Group fork", kind: "group", createdAt: 3,
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
    assert.deepEqual(listed.roomThreads[x.room.id], [
      { threadId: "thr_group", status: "idle", indicator: "background-agent" },
      { threadId: "thr_fork", status: "idle", indicator: "queued-waiting" },
    ]);
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
        kind: "group",
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

test("removed members cannot publish completed but uncollected answers", async () => {
  const x = setup();
  try {
    x.runtime.send(x.room, "@atlas go", randomUUID());
    await x.runtime.driveRoom(x.room);
    const run = x.store.runs(x.room.id)[0]!;
    const job = x.store.job(run.pendingJobIds[0]!)!;
    job.status = "done";
    job.reply = "@scribe secret late response";
    x.store.putJob(job);
    const c = bot("/tmp/c", "bot_2123456789abcdef", "Reviewer");
    x.store.put(c);
    const changed = { ...x.room, memberIds: [x.b.id, c.id] };
    x.store.putRoom(changed);
    await x.runtime.driveRoom(changed);
    assert.equal(x.store.messages(x.room.id).length, 1);
    assert.equal(x.store.runs(x.room.id)[0]!.status, "done");
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

test("a request ID cannot overwrite another room or different message", async () => {
  const x = setup();
  try {
    const id = randomUUID();
    x.runtime.send(x.room, "Original", id);
    assert.throws(
      () => x.runtime.send(x.room, "Different", id),
      /already used/,
    );
    assert.equal(x.store.messages(x.room.id)[0]!.text, "Original");
  } finally {
    await x.close();
  }
});


test("channel deletion clears all history and uploads, preserves other rooms and bots, and rejects late replies", async () => {
  const x = setup();
  try {
    const other = { ...x.room, id: randomUUID(), name: "Keep" };
    x.store.putRoom(other);
    x.runtime.send(other, "Keep this message", randomUUID());
    // More than the UI's 100-job and 200-message windows.
    for (let i = 0; i < 205; i++)
      x.runtime.send(x.room, `Message ${i}`, randomUUID());
    const draftId = randomUUID();
    x.store.stageAttachment(
      {
        id: draftId,
        roomId: x.room.id,
        projectId: "proj_test",
        name: "draft.txt",
        path: "",
        type: "localFile",
        sizeBytes: 5,
      },
      Buffer.from("draft"),
    );
    // Start room work, leaving the other channel's pending jobs untouched.
    const job = x.store
      .roomJobs(x.room.id, -1)
      .find((j) => j.botId === x.a.id)!;
    job.threadId = "thr_deleted";
    job.status = "running";
    x.store.putJob(job);
    x.store.putConversation({
      id: randomUUID(),
      botId: x.a.id,
      key: `group:${x.room.id}:${job.id}`,
      threadId: job.threadId,
      title: x.room.name,
      kind: "group",
      createdAt: 1,
    });
    assert.equal(await x.runtime.deleteRoom(x.room.id), true);
    assert.equal(await x.runtime.deleteRoom(x.room.id), false);
    assert.equal(x.store.findRoom(x.room.id), null);
    assert.equal(x.store.messages(x.room.id).length, 0);
    assert.equal(x.store.roomJobs(x.room.id, -1).length, 0);
    assert.equal(x.store.runs(x.room.id).length, 0);
    assert.equal(x.store.stagedAttachment(draftId), null);
    assert.throws(() => x.store.attachment(draftId), /not found/);
    assert.equal(x.store.byThread(job.threadId), null);
    x.runtime.complete(job.threadId, "Late reply");
    assert.equal(x.store.findRoom(x.room.id), null);
    assert.equal(x.store.all().length, 2);
    assert.equal(x.store.messages(other.id).length, 1);
    assert.equal(x.store.roomJobs(other.id).length, 2);
    assert.equal(x.harness.inspection.sdk.callsTo("threads.stop").length, 1);
  } finally {
    await x.close();
  }
});

test("deleting a channel waits for slow dispatch, then cancels the returned thread", async () => {
  const x = setup();
  try {
    x.runtime.send(x.room, "@atlas start", randomUUID());
    const entered = deferred<void>(),
      finish = deferred<void>();
    x.harness.inspection.sdk.stub("threads.spawn", async () => {
      entered.resolve();
      await finish.promise;
      return makeThreadResponse({ id: "thr_slow_delete" });
    });
    const drive = x.runtime.locked(x.a.id, () => x.runtime.drive(x.a));
    await entered.promise;
    const deletion = x.runtime.deleteRoom(x.room.id);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(x.store.findRoom(x.room.id));
    finish.resolve();
    await Promise.all([drive, deletion]);
    assert.equal(x.store.findRoom(x.room.id), null);
    assert.equal(x.store.conversations(x.a.id).length, 0);
    assert.equal(x.harness.inspection.sdk.callsTo("threads.stop").length, 1);
    await x.runtime.tick();
  } finally {
    await x.close();
  }
});

test("failed channel deletion keeps its history and retries cancellation", async () => {
  const x = setup();
  try {
    x.runtime.send(x.room, "@atlas start", randomUUID());
    await x.runtime.drive(x.a);
    x.harness.inspection.sdk.stub("threads.stop", async () => {
      throw new Error("Host offline");
    });
    await assert.rejects(x.runtime.deleteRoom(x.room.id), /Host offline/);
    assert.equal(x.store.messages(x.room.id).length, 1);
    assert.ok(x.store.findRoom(x.room.id));
    x.harness.inspection.sdk.stub("threads.stop", async () => ({ ok: true }));
    assert.equal(await x.runtime.deleteRoom(x.room.id), true);
    assert.equal(x.harness.inspection.sdk.callsTo("threads.stop").length, 2);
  } finally {
    await x.close();
  }
});

test("a scheduler snapshot tolerates channel deletion while waiting for its lock", async () => {
  const x = setup();
  try {
    const entered = deferred<void>(),
      finish = deferred<void>();
    const removal = x.runtime.locked(`room:${x.room.id}`, async () => {
      entered.resolve();
      await finish.promise;
      x.store.deleteRoom(x.room.id);
    });
    await entered.promise;
    const tick = x.runtime.tick();
    finish.resolve();
    await Promise.all([removal, tick]);
    assert.equal(x.store.findRoom(x.room.id), null);
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

