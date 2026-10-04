
import { test } from "vitest";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";




import { makeThreadResponse, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";



import { jobPrompt } from "../mission-runtime";
import { type Bot, type Conversation } from "../contract";



import { setup } from "./bots-fixture";

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

test("Message starts a visible thread with the bot's profile, and earlier ones stay attached", async () => {
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
      assert.equal((spawn as { visibility?: string }).visibility, "visible");
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
    assert.deepEqual(
      history.conversations.map((c) => [c.kind, c.key.startsWith("thread:"), c.archivedAt]),
      [["admin", true, undefined], ["admin", true, undefined]],
    );
    // The latest attached thread is the bot's current one.
    const latest = await x.harness.behavior.callRpc("conversation", { id: x.a.id }) as Conversation;
    assert.equal(latest.threadId, second.threadId);
    const roster = await x.harness.behavior.callRpc("list", null) as {
      directConversations: Record<string, Conversation[]>;
      directThreadInfo: Record<string, { title: string; archivedAt: number | null }>;
    };
    assert.equal(roster.directConversations[x.a.id]?.length, 2);
    assert.ok(roster.directThreadInfo[first.threadId]);
    assert.ok(roster.directThreadInfo[second.threadId]);

    const hook = x.harness.inspection.registrations.hooks["message.dispatch"]!;
    const earlier = await hook(makeMessageDispatchHookContext({
      thread: { id: first.threadId },
      origin: "plugin",
      originPluginId: "bot-teams",
    }));
    assert.equal(earlier.action, "proceed");
  } finally {
    await x.close();
  }
});

test("changing a model or provider starts new bot sessions, retains their history, and leaves attached threads alone", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    const direct = await x.harness.behavior.callRpc("conversation", { id: x.a.id }) as Conversation;
    // Channel work always starts with its task as the prompt.
    const group = await x.runtime.conversation(x.a, "mission", "mission", "Mission", "Review the plan");
    const updated = await x.harness.behavior.callRpc("update", {
      id: x.a.id,
      providerId: "pi",
      model: "other-model",
      expectedUpdatedAt: x.a.updatedAt,
    }) as Bot;
    assert.equal(updated.providerId, "pi");
    const after = x.store.conversations(x.a.id);
    // A thread with the profile keeps its own model, picked in its composer.
    assert.equal(x.store.currentDirectConversation(x.a.id)?.threadId, direct.threadId);
    assert.equal(after.find((c) => c.threadId === direct.threadId)?.archivedAt, undefined);
    assert.equal(after.find((c) => c.threadId === group.threadId)?.originalKey, "mission");
    assert.equal(after.some((c) => c.key === "mission"), false);
    const nextGroup = await x.runtime.conversation(updated, "mission", "mission", "Mission");
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
    assert.equal(x.store.currentDirectConversation(x.a.id)?.threadId, direct.threadId);
    assert.equal(x.store.byThread(direct.threadId)?.archivedAt, undefined);
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
    const message = { id: randomUUID() };
    x.runtime.enqueue(x.a, { id: message.id, text: "Review", conversationKey: "mission" });
    await x.runtime.drive(x.store.get(x.a.id));
    const first = x.store.job(message.id)!;
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
    assert.equal(x.store.byThread(firstThreadId)?.originalKey, "mission");
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
    assert.equal(x.store.conversations(x.a.id).some((c) => c.key === "mission"), false);
    assert.equal(x.store.get(x.a.id).providerId, "codex");
  } finally {
    await x.close();
  }
});

test("model changes wait for the bot's active sessions, but not for threads with its profile", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    await x.harness.behavior.callRpc("conversation", { id: x.a.id });
    x.harness.inspection.sdk.stub("threads.get", async () =>
      makeThreadResponse({ status: "active" }));
    await x.harness.behavior.callRpc("update", { id: x.a.id, model: "new-model" });
    assert.equal(x.store.get(x.a.id).model, "new-model");
    await x.runtime.conversation(x.store.get(x.a.id), "mission", "mission", "Mission", "Review");
    await assert.rejects(
      x.harness.behavior.callRpc("update", { id: x.a.id, model: "newer-model" }),
      /current response|bot.s work/,
    );
    assert.equal(x.store.get(x.a.id).model, "new-model");
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

test("retirement preserves roster and active profile if cleanup is unresolved", async () => {
  const x = setup();
  try {
    x.runtime.enqueue(x.a,{id:randomUUID(),text:"Work",conversationKey:"mission"});
    const j = x.store.work(x.a.id)[0]!;
    x.store.putJob({ ...j, status: "dispatching" });
    await assert.rejects(x.runtime.retire(x.a.id, true), /Still locating/);
    assert.ok(!x.store.get(x.a.id).retired);
  } finally {
    await x.close();
  }
});

