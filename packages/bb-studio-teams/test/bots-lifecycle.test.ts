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

import { bot, setup } from "./bots-fixture";

test("cancel RPC reloads a registered job before stopping its thread", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    x.runtime.enqueue(x.a, {
      id: "cancel-race",
      text: "work",
      conversationKey: "mission",
      status: "running",
      threadId: "thr_registered",
    });
    await x.harness.behavior.callRpc("cancelJob", {
      id: "cancel-race",
    });
    assert.equal(x.store.job("cancel-race")!.status, "cancelled");
    assert.equal(x.store.job("cancel-race")!.threadId, "thr_registered");
    assert.deepEqual(
      x.harness.inspection.sdk.callsTo("threads.stop").at(-1)?.[0],
      { threadId: "thr_registered" },
    );
  } finally {
    await x.close();
  }
});

test("archiving between completion and collection preserves the finished reply", async () => {
  const x = setup();
  try {
    await plugin(x.bb);
    x.runtime.send(x.room, "@atlas first", randomUUID());
    const job = x.store.work(x.a.id)[0]!;
    job.status = "done";
    job.reply = "Finished before archival";
    x.store.putJob(job);
    await x.harness.behavior.callRpc("channelState", {
      id: x.room.id,
      archived: true,
    });
    await x.harness.behavior.callRpc("channelState", {
      id: x.room.id,
      archived: false,
    });
    assert.equal(
      x.store.messages(x.room.id).at(-1)?.text,
      "Finished before archival",
    );
  } finally {
    await x.close();
  }
});

test("failed cancellation remains retryable and the scheduler finishes host cleanup", async () => {
  const x = setup();
  try {
    x.runtime.enqueue(x.a, {
      id: "cleanup",
      text: "work",
      conversationKey: "mission",
      threadId: "thr_cleanup",
      status: "running",
    });
    let attempts = 0;
    x.harness.inspection.sdk.stub("threads.stop", async () => {
      if (++attempts === 1) throw new Error("Temporary stop failure");
      return { ok: true };
    });
    await assert.rejects(
      x.runtime.cancel(x.store.job("cleanup")!, "Owner stopped"),
      /Temporary/,
    );
    assert.equal(x.store.work(x.a.id)[0]!.cancellationPending, true);
    await x.runtime.tick();
    assert.equal(attempts, 2);
    assert.equal(x.store.job("cleanup")!.cancellationPending, false);
    assert.equal(x.store.work(x.a.id).length, 0);
  } finally {
    await x.close();
  }
});

test("member removal and archive remain retryable when host stopping fails", async () => {
  for (const operation of ["member", "channelState"] as const) {
    const x = setup();
    await plugin(x.bb);
    try {
      x.runtime.send(x.room, "@atlas work", randomUUID());
      const job = x.store.work(x.a.id)[0]!;
      x.store.putJob({ ...job, status: "running", threadId: "thr_cleanup" });
      let fail = true;
      x.harness.inspection.sdk.stub("threads.stop", async () => {
        if (fail) throw new Error("Temporary stop failure");
        return { ok: true };
      });
      const input =
        operation === "member"
          ? { id: x.room.id, botId: x.a.id, present: false }
          : { id: x.room.id, archived: true };
      await assert.rejects(
        x.harness.behavior.callRpc(operation, input),
        /Temporary/,
      );
      assert.ok(x.store.room(x.room.id).memberIds.includes(x.a.id));
      assert.ok(!x.store.room(x.room.id).archived);
      assert.equal(x.store.job(job.id)!.cancellationPending, true);
      fail = false;
      await x.harness.behavior.callRpc(operation, input);
      assert.equal(x.store.job(job.id)!.cancellationPending, false);
      if (operation === "member")
        assert.ok(!x.store.room(x.room.id).memberIds.includes(x.a.id));
      else assert.equal(x.store.room(x.room.id).archived, true);
    } finally {
      await x.close();
    }
  }
});

test("dispatch recovery finds accepted work beyond the first thread page", async () => {
  const x = setup();
  try {
    x.runtime.enqueue(x.a, {
      id: "page-two",
      text: "work",
      conversationKey: "mission",
      status: "dispatching",
    });
    x.harness.inspection.sdk.stub("threads.list", async ({ offset }) =>
      offset
        ? [makeThreadResponse({ id: "thr_found" })]
        : Array.from({ length: 100 }, (_, i) =>
            makeThreadResponse({ id: `thr_other_${i}` }),
          ),
    );
    x.harness.inspection.sdk.stub(
      "threads.getPluginMetadata",
      async ({ threadId }) =>
        threadId === "thr_found"
          ? { botId: x.a.id, conversationKey: "mission:page-two" }
          : {},
    );
    await x.runtime.drive(x.a);
    assert.equal(x.store.job("page-two")!.threadId, "thr_found");
    assert.equal(x.harness.inspection.sdk.callsTo("threads.list").length, 2);
  } finally {
    await x.close();
  }
});

test("a deleted admin conversation does not block future bot work", async () => {
  const x = setup();
  try {
    x.store.putConversation({
      id: "old",
      botId: x.a.id,
      key: "admin",
      threadId: "thr_deleted",
      title: "Old",
      kind: "admin",
      createdAt: 1,
    });
    x.harness.inspection.sdk.stub("threads.get", async ({ threadId }) => {
      if (threadId === "thr_deleted") throw new Error("Thread not found");
      return makeThreadResponse({ status: "idle" });
    });
    x.runtime.enqueue(x.a, {
      id: "next",
      text: "work",
      conversationKey: "mission",
    });
    await x.runtime.tick();
    assert.equal(x.store.job("next")!.status, "running");
    assert.equal(x.store.byThread("thr_deleted"), null);
  } finally {
    await x.close();
  }
});

test("a bot keeps one current direct thread and earlier threads remain usable", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    const first = await x.harness.behavior.callRpc("conversation", { id: x.a.id }) as Conversation;
    const repeated = await x.harness.behavior.callRpc("conversation", { id: x.a.id }) as Conversation;
    assert.equal(repeated.threadId, first.threadId);

    const second = await x.harness.behavior.callRpc("newConversation", { id: x.a.id }) as Conversation;
    assert.notEqual(second.threadId, first.threadId);
    const directSpawns = x.harness.inspection.sdk.callsTo("threads.spawn")
      .map(([args]) => args as { input: unknown[]; sendAt?: number; title?: string; pluginMetadata?: { botId: string } })
      .filter((args) => args.pluginMetadata?.botId === x.a.id);
    assert.equal(directSpawns.length, 2);
    for (const spawn of directSpawns) {
      assert.deepEqual(spawn.input, [{ type: "text", text: "", mentions: [] }]);
      assert.ok(spawn.sendAt! > Date.now());
      assert.equal(spawn.title, undefined);
    }
    assert.equal(x.harness.inspection.sdk.callsTo("threads.queuedMessages.delete").length, 2);
    // The deleted start message held BB's resolved model, so the thread must keep it.
    assert.deepEqual(
      x.harness.inspection.sdk.callsTo("threads.update").map(([args]) => args),
      [first.threadId, second.threadId].map((threadId) => ({
        threadId,
        model: "default-model",
        reasoningLevel: "medium",
      })),
    );
    const history = await x.harness.behavior.callRpc("get", { id: x.a.id }) as { conversations: Conversation[] };
    assert.equal(history.conversations.filter((c: { key: string }) => c.key === "admin").length, 1);
    assert.equal(history.conversations.find((c: { threadId: string }) => c.threadId === first.threadId)?.originalKey, "admin");
    assert.ok(history.conversations.find((c: { threadId: string }) => c.threadId === first.threadId)?.archivedAt);
    assert.equal(createTestStore(x.store.db).conversations(x.a.id).length, 2);
    const roster = await x.harness.behavior.callRpc("list", null) as {
      directConversations: Record<string, Conversation[]>;
      directThreadInfo: Record<string, { title: string; archivedAt: number | null }>;
    };
    assert.equal(roster.directConversations[x.a.id]?.length, 2);
    assert.ok(roster.directThreadInfo[first.threadId]);
    assert.ok(roster.directThreadInfo[second.threadId]);

    const hook = x.harness.inspection.registrations.hooks["message.dispatch"]!;
    const archived = await hook(makeMessageDispatchHookContext({
      thread: { id: first.threadId },
      origin: "plugin",
      originPluginId: "bot-teams",
    }));
    assert.equal(archived.action, "proceed");
  } finally {
    await x.close();
  }
});

test("changing a model or provider starts new bot sessions and retains their history", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    const direct = await x.harness.behavior.callRpc("conversation", { id: x.a.id }) as Conversation;
    // Channel work always starts with its task as the prompt.
    const group = await x.runtime.conversation(x.a, `group:${x.room.id}`, "group", x.room.name, "Review the plan");
    const updated = await x.harness.behavior.callRpc("update", {
      id: x.a.id,
      providerId: "pi",
      model: "other-model",
      expectedUpdatedAt: x.a.updatedAt,
    }) as Bot;
    assert.equal(updated.providerId, "pi");
    const after = x.store.conversations(x.a.id);
    const current = after.find((c) => c.key === "admin")!;
    assert.notEqual(current.threadId, direct.threadId);
    assert.equal(current.providerId, "pi");
    assert.equal(current.model, "other-model");
    assert.equal(after.find((c) => c.threadId === direct.threadId)?.originalKey, "admin");
    assert.equal(after.find((c) => c.threadId === group.threadId)?.originalKey, `group:${x.room.id}`);
    assert.equal(after.some((c) => c.key === `group:${x.room.id}`), false);
    assert.equal(
      await x.harness.behavior.callRpc("channelForThread", { threadId: group.threadId }),
      x.room.id,
    );
    const nextGroup = await x.runtime.conversation(updated, `group:${x.room.id}`, "group", x.room.name);
    assert.notEqual(nextGroup.threadId, group.threadId);
    assert.equal(nextGroup.providerId, "pi");
  } finally {
    await x.close();
  }
});

test("swapping models exchanges both selections and starts fresh sessions", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    await x.harness.behavior.callRpc("update", {
      id: x.a.id,
      fallbackProviderId: "pi",
      fallbackModel: "backup-model",
      fallbackReasoningLevel: "low",
    });
    const direct = await x.harness.behavior.callRpc("conversation", { id: x.a.id }) as Conversation;
    const swapped = await x.harness.behavior.callRpc("swapModel", { id: x.a.id }) as Bot;
    assert.equal(swapped.providerId, "pi");
    assert.equal(swapped.model, "backup-model");
    assert.equal(swapped.reasoningLevel, "low");
    assert.equal(swapped.fallbackProviderId, "codex");
    assert.equal(swapped.fallbackModel, "");
    assert.equal(swapped.fallbackReasoningLevel, "medium");
    assert.notEqual(x.store.currentDirectConversation(x.a.id)?.threadId, direct.threadId);
    assert.equal(x.store.byThread(direct.threadId)?.originalKey, "admin");
    await x.harness.behavior.callRpc("swapModel", { id: x.a.id });
    assert.equal(x.store.get(x.a.id).providerId, "codex");
  } finally {
    await x.close();
  }
});

test("a provider failure retries one managed response on the fallback model", async () => {
  const x = setup();
  try {
    x.store.put({ ...x.a, fallbackProviderId: "pi", fallbackModel: "backup-model",
      fallbackReasoningLevel: "low" });
    const message = x.runtime.send(x.room, "@atlas Review", randomUUID());
    await x.runtime.drive(x.store.get(x.a.id));
    const first = x.store.requestJobs(message.id)[0]!;
    const firstThreadId = first.threadId!;
    x.harness.inspection.sdk.stub("threads.get", async ({ threadId }) =>
      makeThreadResponse({ id: threadId, status: "error" }));
    x.harness.inspection.sdk.stub("threads.timeline", async () => ({
      rows: [{ kind: "conversation", role: "user", text: jobPrompt(first) }],
    }));
    x.harness.inspection.sdk.stub("threads.events.list", async () => [{
      id: "provider-failure", scope: { kind: "thread" }, threadId: firstThreadId,
      seq: 1, createdAt: Date.now(), type: "provider/error",
      data: { message: "Provider unavailable" },
    }]);
    await x.runtime.settleFromEvent(firstThreadId, null, "Provider unavailable");
    const queued = x.store.job(first.id)!;
    assert.equal(queued.status, "queued");
    assert.equal(queued.fallbackAttempted, true);
    assert.equal(queued.threadId, null);
    assert.equal(x.store.byThread(firstThreadId)?.originalKey, `group:${x.room.id}`);
    await x.runtime.drive(x.store.get(x.a.id));
    const retried = x.store.job(first.id)!;
    assert.notEqual(retried.threadId, firstThreadId);
    const spawn = x.harness.inspection.sdk.callsTo("threads.spawn").at(-1)?.[0] as {
      providerId: string; model: string; reasoningLevel: string;
    };
    assert.equal(spawn.providerId, "pi");
    assert.equal(spawn.model, "backup-model");
    assert.equal(spawn.reasoningLevel, "low");
    x.runtime.complete(retried.threadId!, null, "Fallback also unavailable", true);
    assert.equal(x.store.job(first.id)?.status, "error");
    assert.equal(x.store.conversations(x.a.id).some((c) => c.key === `group:${x.room.id}`), false);
    assert.equal(x.store.get(x.a.id).providerId, "codex");
  } finally {
    await x.close();
  }
});

test("new direct threads and model changes wait for active work", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    await x.harness.behavior.callRpc("conversation", { id: x.a.id });
    x.harness.inspection.sdk.stub("threads.get", async () =>
      makeThreadResponse({ status: "active" }));
    await assert.rejects(
      x.harness.behavior.callRpc("newConversation", { id: x.a.id }),
      /current response/,
    );
    await assert.rejects(
      x.harness.behavior.callRpc("update", { id: x.a.id, model: "new-model" }),
      /current response/,
    );
    assert.equal(x.store.conversations(x.a.id).filter((c) => c.key === "admin").length, 1);
    assert.equal(x.store.get(x.a.id).model, "");
  } finally {
    await x.close();
  }
});

test("stale profile saves cannot overwrite a newer edit", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    await x.harness.behavior.callRpc("update", {
      id: x.a.id,
      description: "New role",
      expectedUpdatedAt: 1,
    });
    await assert.rejects(
      x.harness.behavior.callRpc("update", {
        id: x.a.id,
        name: "Stale",
        expectedUpdatedAt: 1,
      }),
      /changed elsewhere/,
    );
    assert.equal(x.store.get(x.a.id).description, "New role");
    assert.equal(x.store.get(x.a.id).name, "Atlas");
  } finally {
    await x.close();
  }
});

test("cancelled dispatch cleanup survives temporarily invisible host threads", async () => {
  const x = setup();
  try {
    x.runtime.enqueue(x.a, {
      id: "late-visible",
      text: "work",
      conversationKey: "mission",
      status: "dispatching",
    });
    await x.runtime.cancel(x.store.job("late-visible")!, "Owner stopped");
    await x.runtime.tick();
    assert.equal(x.store.work(x.a.id)[0]!.cancellationPending, true);
    x.harness.inspection.sdk.stub("threads.list", async () => [
      makeThreadResponse({ id: "thr_late" }),
    ]);
    x.harness.inspection.sdk.stub("threads.getPluginMetadata", async () => ({
      botId: x.a.id,
      conversationKey: "mission:late-visible",
    }));
    await x.runtime.tick();
    assert.equal(x.store.job("late-visible")!.cancellationPending, false);
    assert.equal(x.harness.inspection.sdk.callsTo("threads.stop").length, 1);
  } finally {
    await x.close();
  }
});

test("membership and archive wait for unresolved dispatch cleanup", async () => {
  for (const operation of ["member", "updateRoom", "channelState"] as const) {
    const x = setup();
    await plugin(x.bb);
    try {
      x.runtime.send(x.room, "@atlas work", randomUUID());
      const job = x.store.work(x.a.id)[0]!;
      x.store.putJob({ ...job, status: "dispatching" });
      const input =
        operation === "member"
          ? { id: x.room.id, botId: x.a.id, present: false }
          : operation === "updateRoom"
            ? { id: x.room.id, name: x.room.name, memberIds: [x.b.id] }
            : { id: x.room.id, archived: true };
      await assert.rejects(
        x.harness.behavior.callRpc(operation, input),
        /Still locating/,
      );
      assert.ok(x.store.room(x.room.id).memberIds.includes(x.a.id));
      assert.ok(!x.store.room(x.room.id).archived);
      x.harness.inspection.sdk.stub("threads.list", async () => [
        makeThreadResponse({ id: "thr_late_cleanup" }),
      ]);
      x.harness.inspection.sdk.stub("threads.getPluginMetadata", async () => ({
        botId: x.a.id,
        conversationKey: `${job.conversationKey}:${job.id}`,
      }));
      await x.runtime.tick();
      await x.harness.behavior.callRpc(operation, input);
      assert.equal(x.store.job(job.id)!.cancellationPending, false);
    } finally {
      await x.close();
    }
  }
});

test("history pages use stable cursors while new messages arrive, with old reply parents", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    for (let i = 0; i < 225; i++)
      x.store.putMessage({
        id: `message-${i}`,
        roomId: x.room.id,
        runId: "fixture",
        botId: null,
        speaker: "You",
        text: i === 0 ? "needle 100%_literal" : `Message ${i}`,
        replyTo: i === 224 ? "message-0" : null,
        attachments: [],
        createdAt: 1,
      });
    const data = (await x.harness.behavior.callRpc("room", {
      id: x.room.id,
    })) as {
      messages: { id: string }[];
      parents: { id: string }[];
      hasOlder: boolean;
    };
    assert.equal(data.messages.length, 50);
    assert.equal(data.hasOlder, true);
    assert.equal(data.parents[0]?.id, "message-0");
    const first = x.store.history(x.room.id, undefined, "", 100);
    x.store.putMessage({
      ...x.store.message("message-224")!,
      id: "new-message",
    });
    const second = x.store.history(x.room.id, first.nextBefore!, "", 100);
    const third = x.store.history(x.room.id, second.nextBefore!, "", 100);
    assert.equal(
      new Set(
        [...first.messages, ...second.messages, ...third.messages].map(
          (m) => m.id,
        ),
      ).size,
      225,
    );
    assert.equal(third.nextBefore, null);
    const forward = await x.harness.behavior.callRpc("history", {
      id: x.room.id, after: "message-0", through: "message-3", limit: 2,
    }) as { messages: { id: string }[]; nextAfter: string | null };
    assert.deepEqual(forward.messages.map((message) => message.id), ["message-1", "message-2"]);
    assert.equal(forward.nextAfter, "message-2");
    const end = await x.harness.behavior.callRpc("history", {
      id: x.room.id, after: forward.nextAfter!, through: "message-3", limit: 2,
    }) as { messages: { id: string }[]; nextAfter: string | null };
    assert.deepEqual(end.messages.map((message) => message.id), ["message-3"]);
    assert.equal(end.nextAfter, null);
    assert.equal(
      x.store.history(x.room.id, undefined, "100%_literal").messages[0]?.id,
      "message-0",
    );
    const other = { ...x.room, id: randomUUID() };
    x.store.putRoom(other);
    assert.throws(
      () => x.store.history(other.id, "message-0"),
      /cursor not found/,
    );
  } finally {
    await x.close();
  }
});

test("retiring stops all work and leaves channels while preserving identity and history", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    x.runtime.send(x.room, "@atlas work", randomUUID());
    const before = x.store.messages(x.room.id).length;
    const j = x.store.work(x.a.id)[0]!;
    x.store.putJob({ ...j, status: "running", threadId: "thr_retiring" });
    await x.runtime.retire(x.a.id, true);
    assert.equal(x.store.get(x.a.id).retired, true);
    assert.equal(x.store.get(x.a.id).home, x.a.home);
    assert.equal(x.store.work(x.a.id).length, 0);
    assert.equal(x.store.messages(x.room.id).length, before);
    assert.ok(!x.store.room(x.room.id).memberIds.includes(x.a.id));
    assert.throws(() => x.runtime.wake(x.store.get(x.a.id)), /Restore/);
    await assert.rejects(
      x.harness.behavior.callRpc("member", {
        id: x.room.id,
        botId: x.a.id,
        present: true,
      }),
      /Restore/,
    );
    assert.throws(
      () =>
        x.runtime.send(x.store.room(x.room.id), "@atlas hello", randomUUID()),
      /archived/,
    );
    await x.runtime.retire(x.a.id, false);
    assert.equal(x.store.get(x.a.id).intervalMinutes, 0);
    assert.ok(!x.store.room(x.room.id).memberIds.includes(x.a.id));
    await x.harness.behavior.callRpc("member", {
      id: x.room.id,
      botId: x.a.id,
      present: true,
    });
  } finally {
    await x.close();
  }
});

test("retirement preserves roster and active profile if cleanup is unresolved", async () => {
  const x = setup();
  try {
    x.runtime.send(x.room, "@atlas work", randomUUID());
    const j = x.store.work(x.a.id)[0]!;
    x.store.putJob({ ...j, status: "dispatching" });
    await assert.rejects(x.runtime.retire(x.a.id, true), /Still locating/);
    assert.ok(!x.store.get(x.a.id).retired);
    assert.ok(x.store.room(x.room.id).memberIds.includes(x.a.id));
  } finally {
    await x.close();
  }
});

test("retrying a failed response is idempotent and preserves the original message", async () => {
  const x = setup();
  try {
    x.runtime.send(x.room, "@atlas work", randomUUID());
    const original = x.store.work(x.a.id)[0]!;
    x.store.putJob({
      ...original,
      status: "error",
      error: "Provider unavailable",
    });
    await x.runtime.driveRoom(x.room);
    const [a, b] = await Promise.all([
      x.runtime.retryJob(original.id),
      x.runtime.retryJob(original.id),
    ]);
    assert.equal(a.id, b.id);
    assert.equal(a.retryOf, original.id);
    assert.equal(a.status, "queued");
    assert.equal(x.store.messages(x.room.id).length, 1);
    assert.equal(x.store.work(x.a.id).length, 1);
    assert.equal(a.triggerMessageId, original.triggerMessageId);
    const running = x.store.job(a.id)!;
    running.status = "error";
    running.error = "Another failure";
    x.store.putJob(running);
    assert.notEqual((await x.runtime.retryJob(a.id)).id, a.id);
    x.store.putRoom({ ...x.room, archived: true });
    await assert.rejects(x.runtime.retryJob(original.id), /Restore/);
  } finally {
    await x.close();
  }
});

test("one failed bot leaves another bot's answer visible and its own response retryable", async () => {
  const x = setup();
  try {
    const message = x.runtime.send(x.room, "Review this together", randomUUID());
    const [first, second] = x.store.requestJobs(message.id);
    assert.ok(first && second);
    await x.runtime.drive(x.a);
    await x.runtime.drive(x.b);
    x.runtime.complete(x.store.job(first.id)!.threadId!, null, "Provider unavailable");
    await x.runtime.driveRoom(x.room);
    assert.equal(x.store.runs(x.room.id).find((run) => run.id === message.id)?.status, "running");
    x.runtime.complete(x.store.job(second.id)!.threadId!, "Review complete");
    await x.runtime.driveRoom(x.room);
    assert.equal(x.store.runs(x.room.id).find((run) => run.id === message.id)?.status, "done");
    assert.deepEqual(
      x.store.messages(x.room.id).filter((entry) => entry.botId).map((entry) => entry.text),
      ["Review complete"],
    );
    const retry = await x.runtime.retryJob(first.id);
    assert.equal(retry.retryOf, first.id);
    assert.equal(x.store.messages(x.room.id).filter((entry) => entry.botId).length, 1);
  } finally {
    await x.close();
  }
});

test("a failed bot reports the provider's current error detail", async () => {
  const x = setup();
  try {
    const message = x.runtime.send(x.room, "@atlas Review", randomUUID());
    await x.runtime.drive(x.a);
    const job = x.store.requestJobs(message.id)[0]!;
    x.harness.inspection.sdk.stub("threads.get", async ({ threadId }) =>
      makeThreadResponse({ id: threadId, status: "error" }),
    );
    x.harness.inspection.sdk.stub("threads.timeline", async () => ({
      rows: [{ kind: "conversation", role: "user", text: jobPrompt(job) }],
    }));
    x.harness.inspection.sdk.stub("threads.events.list", async () => [
      {
        id: "current-failure",
        scope: { kind: "thread" },
        threadId: job.threadId!,
        seq: 2,
        createdAt: Date.now(),
        type: "provider/error",
        data: {
          providerThreadId: "provider",
          message: "Provider error",
          detail: "Session limit reached; resets at 1:30am.",
        },
      },
      {
        id: "old-failure",
        scope: { kind: "thread" },
        threadId: job.threadId!,
        seq: 1,
        createdAt: (job.dispatchStartedAt ?? job.createdAt) - 1,
        type: "provider/error",
        data: { providerThreadId: "provider", message: "Old error", detail: "Old detail" },
      },
    ]);
    await x.runtime.settleFromEvent(job.threadId!, null, null);
    assert.equal(x.store.job(job.id)?.error, "Session limit reached; resets at 1:30am.");
  } finally {
    await x.close();
  }
});

