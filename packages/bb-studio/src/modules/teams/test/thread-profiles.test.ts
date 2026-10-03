import { test } from "vitest";
import assert from "node:assert/strict";
import { makeMessageDispatchHookContext, makePluginAgentConfigurationContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { setup } from "./bots-fixture";

test("attaching a profile to a thread makes its agent work as the bot in that thread's project", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    x.harness.inspection.sdk.stub("threads.get", async ({ threadId }) =>
      makeThreadResponse({ id: threadId, status: "idle", providerId: x.a.providerId }));
    assert.deepEqual(await x.harness.behavior.callRpc("threadProfile", { threadId: "thr_work" }), { botId: null });
    await x.harness.behavior.callRpc("setThreadProfile", { threadId: "thr_work", botId: x.a.id });
    assert.deepEqual(await x.harness.behavior.callRpc("threadProfile", { threadId: "thr_work" }), { botId: x.a.id });
    // Same provider: the thread takes the bot's model. The session restarts to load the profile.
    assert.deepEqual(x.harness.inspection.sdk.callsTo("threads.update").at(-1)?.[0], {
      threadId: "thr_work",
      reasoningLevel: x.a.reasoningLevel,
    });
    assert.deepEqual(x.harness.inspection.sdk.callsTo("threads.stop").at(-1)?.[0], { threadId: "thr_work" });
    const config = await x.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({ thread: { id: "thr_work" } }),
    );
    assert.match(config.instructions ?? "", /works as the persistent bot "Atlas"/);
    assert.match(config.instructions ?? "", /initial working directory: it is the thread's project/);
    assert.match(config.instructions ?? "", /MEMORY\.md/);
    const listed = await x.harness.behavior.callRpc("profileThreads", { id: x.a.id }) as { threadId: string }[];
    assert.deepEqual(listed.map((t) => t.threadId), ["thr_work"]);
    assert.deepEqual(await x.harness.behavior.callRpc("threadBots", {}), [{ threadId: "thr_work", botId: x.a.id }]);

    await x.harness.behavior.callRpc("setThreadProfile", { threadId: "thr_work", botId: null });
    assert.equal(x.store.byThread("thr_work"), null);
    assert.deepEqual(await x.harness.behavior.callRpc("threadBots", {}), []);
  } finally {
    await x.close();
  }
});

test("a profile can't change mid-response or on threads the plugin runs", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    x.harness.inspection.sdk.stub("threads.get", async ({ threadId }) =>
      makeThreadResponse({ id: threadId, status: "active" }));
    await assert.rejects(
      x.harness.behavior.callRpc("setThreadProfile", { threadId: "thr_busy", botId: x.a.id }),
      /current response/,
    );
    const group = await x.runtime.conversation(x.a, `group:${x.room.id}`, "group", x.room.name, "Review");
    assert.equal(await x.harness.behavior.callRpc("threadProfile", { threadId: group.threadId }), null);
  } finally {
    await x.close();
  }
});

test("a profile picked in the new-thread composer attaches with the first message", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    await x.harness.behavior.callRpc("pendingThreadProfile", { projectId: "proj_app", botId: x.a.id });
    const hook = x.harness.inspection.registrations.hooks["message.dispatch"]!;
    const first = (threadId: string, projectId = "proj_app") => hook(makeMessageDispatchHookContext({
      thread: { id: threadId, status: "pending", originPluginId: null },
      project: { id: projectId },
      requestedExecution: { permissionMode: "accept-edits" },
      initiator: "user",
      senderThreadId: null,
      origin: "app",
      originPluginId: null,
    }));
    assert.equal((await first("thr_other", "proj_elsewhere")).action, "proceed");
    assert.equal(x.store.byThread("thr_other"), null);
    assert.equal((await first("thr_new")).action, "proceed");
    assert.equal(x.store.byThread("thr_new")?.botId, x.a.id);
    // The pick is used once.
    await first("thr_next");
    assert.equal(x.store.byThread("thr_next"), null);
  } finally {
    await x.close();
  }
});

test("an archived bot's threads keep working without its profile", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    await x.harness.behavior.callRpc("setThreadProfile", { threadId: "thr_work", botId: x.a.id });
    await x.harness.behavior.callRpc("retire", { id: x.a.id, retired: true });
    const hook = x.harness.inspection.registrations.hooks["message.dispatch"]!;
    const decision = await hook(makeMessageDispatchHookContext({
      thread: { id: "thr_work" },
      origin: "app",
      originPluginId: null,
    }));
    assert.equal(decision.action, "proceed");
    const config = await x.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({ thread: { id: "thr_work" } }),
    );
    assert.equal(config.instructions, null);
  } finally {
    await x.close();
  }
});

test("dispatch rejects permissions above an attached bot's trust", async () => {
  const x = setup(); await plugin(x.bb);
  try {
    await x.harness.behavior.callRpc("setThreadProfile", { threadId: "thr_work", botId: x.a.id });
    const hook = x.harness.inspection.registrations.hooks["message.dispatch"]!;
    const context = (permissionMode: "auto" | "accept-edits") => makeMessageDispatchHookContext({ thread: { id: "thr_work" }, requestedExecution: { permissionMode } });
    assert.equal((await hook(context("auto"))).action, "reject");
    assert.equal((await hook(context("accept-edits"))).action, "proceed");
  } finally { await x.close(); }
});
