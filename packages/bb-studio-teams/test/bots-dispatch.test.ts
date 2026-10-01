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

test("default hourly limits count dispatches that never became active", async () => {
  const x = setup();
  try {
    for (let i = 0; i < 100; i++) {
      const id = `dispatch-${i}`;
      x.runtime.enqueue(x.a, {
        id,
        text: "completed dispatch",
        conversationKey: "mission",
      });
      const job = x.store.job(id)!;
      job.status = "done";
      job.dispatchStartedAt = Date.now();
      x.store.putJob(job);
    }
    x.runtime.enqueue(x.a, {
      id: "over-limit",
      text: "work",
      conversationKey: "mission",
    });
    await assert.rejects(
      x.runtime.drive(x.a),
      /Bot limit reached \(100 turns per hour\)/,
    );
    assert.equal(x.store.job("over-limit")!.status, "queued");
  } finally {
    await x.close();
  }
});

test("owner requests in channel work threads are rejected and directed to the channel", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    const hook = x.harness.inspection.registrations.hooks["message.dispatch"]!;
    x.store.putConversation({
      id: "group",
      botId: x.a.id,
      key: `group:${x.room.id}`,
      threadId: "thr_group",
      title: "Research",
      kind: "group",
      createdAt: 1,
    });
    x.store.put({ ...x.a, retired: true });
    x.store.putRoom({ ...x.room, memberIds: [x.b.id], archived: true });
    x.runtime.busy.set(x.a.id, { threadId: "another-thread", at: Date.now() });
    for (const origin of ["app", "cli", "sdk"] as const) {
      assert.deepEqual(
        await hook(
          makeMessageDispatchHookContext({
            thread: { id: "thr_group" },
            input: { text: "A direct follow-up" },
            origin,
            originPluginId: null,
          }),
        ),
        {
          action: "reject",
          message: `Send this request in the channel: /plugins/bot-teams/channels/${x.room.id}`,
        },
      );
    }
  } finally {
    await x.close();
  }
});

test("a managed channel dispatch proceeds even when core marks its initiator as user", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    x.store.putConversation({
      id: "group-dispatch",
      botId: x.a.id,
      key: `group:${x.room.id}`,
      threadId: "thr_group_dispatch",
      title: "Research",
      kind: "group",
      createdAt: 1,
    });
    x.runtime.enqueue(x.a, {
      id: "managed-dispatch",
      text: "Check the release",
      conversationKey: `group:${x.room.id}`,
      roomId: x.room.id,
    });
    const job = x.store.job("managed-dispatch")!;
    x.store.putJob({ ...job, threadId: "thr_group_dispatch", status: "dispatching" });
    const hook = x.harness.inspection.registrations.hooks["message.dispatch"]!;
    const result = await hook(makeMessageDispatchHookContext({
      thread: { id: "thr_group_dispatch" },
      input: { text: jobPrompt(x.store.job("managed-dispatch")!) },
      origin: "sdk",
      originPluginId: null,
    }));
    assert.equal(result.action, "proceed");
  } finally {
    await x.close();
  }
});

test("managed bot chats dispatch directly and removed members cannot dispatch", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    const hook = x.harness.inspection.registrations.hooks["message.dispatch"]!;
    x.store.putConversation({
      id: "admin",
      botId: x.a.id,
      key: "admin",
      threadId: "thr_admin",
      title: "Bot chat",
      kind: "admin",
      createdAt: 1,
    });
    const context = makeMessageDispatchHookContext({
      thread: { id: "thr_admin" },
      origin: "plugin",
      originPluginId: "bot-teams",
    });
    assert.equal((await hook(context)).action, "proceed");
    x.store.putConversation({
      id: "removed",
      botId: x.a.id,
      key: "group:removed",
      threadId: "thr_removed",
      title: "Removed",
      kind: "group",
      createdAt: 1,
    });
    x.store.putRoom({ ...x.room, memberIds: [x.b.id] });
    x.runtime.enqueue(x.a, {
      id: "removed",
      text: "old request",
      conversationKey: "group:removed",
      roomId: x.room.id,
      threadId: "thr_removed",
      status: "running",
    });
    const job = x.store.job("removed")!;
    assert.equal(
      (
        await hook(
          makeMessageDispatchHookContext({
            thread: { id: "thr_removed" },
            input: { text: jobPrompt(job) },
            origin: "plugin",
            originPluginId: "bot-teams",
          }),
        )
      ).action,
      "reject",
    );
  } finally {
    await x.close();
  }
});

test("attachments are delivered as native inputs and request deduplication includes files", async () => {
  const x = setup();
  try {
    const a = {
      id: randomUUID(),
      roomId: x.room.id,
      projectId: x.a.projectId,
      path: "/project/Attachments/brief.txt",
      name: "brief.txt",
      mimeType: "text/plain",
      type: "localFile" as const,
      sizeBytes: 42,
    };
    const id = randomUUID();
    x.runtime.send(x.room, "@atlas read this", id, [a]);
    assert.throws(
      () => x.runtime.send(x.room, "@atlas read this", id, []),
      /different content/,
    );
    await x.runtime.drive(x.a);
    const call = x.harness.inspection.sdk.callsTo("threads.spawn")[0]!;
    assert.ok(JSON.stringify(call).includes(a.path));
    assert.equal(x.store.work(x.a.id)[0]!.attachments[0]!.id, a.id);
  } finally {
    await x.close();
  }
});

test("unfinished sequential discussions migrate without losing or duplicating work", async () => {
  const x = setup();
  try {
    const id = randomUUID();
    x.runtime.send(x.room, "legacy", id);
    const run = x.store.runs(x.room.id)[0]!,
      first = run.pendingJobIds[0]!,
      second = run.pendingJobIds[1]!;
    x.store.db.prepare("DELETE FROM jobs WHERE id=?").run(second);
    const legacy = {
      ...run,
      mode: undefined,
      pendingJobIds: undefined,
      settledJobIds: undefined,
      remaining: [x.b.id],
      jobId: first,
    };
    x.store.db
      .prepare("UPDATE room_runs SET json=? WHERE id=?")
      .run(JSON.stringify(legacy), id);
    await x.runtime.driveRoom(x.room);
    await x.runtime.driveRoom(x.room);
    const migrated = x.store.runs(x.room.id)[0]!;
    assert.equal(migrated.mode, "concurrent");
    assert.equal(migrated.pendingJobIds.length, 2);
    assert.equal(x.store.work(x.b.id).length, 1);
    assert.ok(migrated.pendingJobIds.includes(first));
  } finally {
    await x.close();
  }
});

test("a group cannot send attachments from another group", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    const id = randomUUID();
    x.store.putAttachment({
      id,
      roomId: randomUUID(),
      projectId: x.a.projectId,
      path: "/private/file.txt",
      name: "file.txt",
      type: "localFile",
      sizeBytes: 2,
    });
    await assert.rejects(
      () =>
        x.harness.behavior.callRpc("send", {
          id: x.room.id,
          text: "read it",
          attachmentIds: [id],
          requestId: randomUUID(),
        }),
      /different group/,
    );
    assert.equal(x.store.messages(x.room.id).length, 0);
  } finally {
    await x.close();
  }
});

test("empty channels accept messages and invite mentioned bots atomically on send", async () => {
  const x = setup();
  try {
    const room = { ...x.room, memberIds: [] };
    x.store.putRoom(room);
    x.runtime.send(room, "Notes before anyone joins", randomUUID());
    assert.equal(x.store.work(x.a.id).length, 0);
    const requestId = randomUUID();
    x.runtime.send(room, "@atlas please help", requestId);
    assert.deepEqual(x.store.room(room.id).memberIds, [x.a.id]);
    assert.equal(x.store.work(x.a.id).length, 1);
    x.runtime.send(x.store.room(room.id), "@atlas please help", requestId);
    assert.equal(x.store.work(x.a.id).length, 1);
    assert.deepEqual(
      x.store.messages(room.id).map((message) => message.text),
      [
        "Notes before anyone joins",
        "@atlas please help",
        "Atlas joined the channel.",
      ],
    );
    assert.equal(
      x.store.messages(room.id).filter((message) => message.system).length,
      1,
    );
    assert.equal(x.store.work(x.b.id).length, 0);
  } finally {
    await x.close();
  }
});

test("failed invitations do not alter history or membership", async () => {
  const x = setup();
  try {
    const ids = [x.a.id, x.b.id];
    for (let i = 2; i < 17; i++) {
      const b = bot(
        `/tmp/${i}`,
        `bot_${i.toString(16).padStart(16, "0")}`,
        `Bot${i}`,
      );
      x.store.put(b);
      ids.push(b.id);
    }
    const room = { ...x.room, memberIds: ids.slice(0, 16) };
    x.store.putRoom(room);
    assert.throws(
      () => x.runtime.send(room, "@bot16 join", randomUUID()),
      /16 bots/,
    );
    assert.deepEqual(x.store.room(room.id).memberIds, room.memberIds);
    assert.equal(x.store.messages(room.id).length, 0);
  } finally {
    await x.close();
  }
});

test("incremental member updates preserve other invites and removal cancels work", async () => {
  const x = setup();
  try {
    await plugin(x.bb);
    x.store.putRoom({ ...x.room, memberIds: [] });
    await Promise.all(
      [x.a, x.b].map((b) =>
        x.harness.behavior.callRpc("member", {
          id: x.room.id,
          botId: b.id,
          present: true,
        }),
      ),
    );
    assert.deepEqual(x.store.room(x.room.id).memberIds, [x.a.id, x.b.id]);
    x.runtime.send(x.store.room(x.room.id), "Work", randomUUID());
    await x.harness.behavior.callRpc("member", {
      id: x.room.id,
      botId: x.a.id,
      present: false,
    });
    assert.deepEqual(x.store.room(x.room.id).memberIds, [x.b.id]);
    assert.equal(x.store.work(x.a.id).length, 0);
    assert.equal(x.store.work(x.b.id).length, 1);
    assert.deepEqual(
      x.store
        .messages(x.room.id)
        .filter((message) => message.system)
        .map((message) => message.text),
      ["Atlas joined the channel.", "Scribe joined the channel."],
    );
    assert.equal(x.store.messages(x.room.id).length, 3);
  } finally {
    await x.close();
  }
});

test("blank channels get distinct names even with concurrent creation and archived names", async () => {
  const x = setup();
  try {
    await plugin(x.bb);
    x.store.putRoom({ ...x.room, name: "NEW CHANNEL", archived: true });
    const rooms = await Promise.all(
      Array.from({ length: 3 }, () =>
        x.harness.behavior
          .callRpc("createRoom", { memberIds: [] })
          .then((r) => roomSchema.parse(r)),
      ),
    );
    assert.deepEqual(rooms.map((r) => r.name).sort(), [
      "New channel 2",
      "New channel 3",
      "New channel 4",
    ]);
    assert.equal(new Set(rooms.map((r) => r.id)).size, 3);
    assert.ok(rooms.every((r) => r.memberIds.length === 0));
    await assert.rejects(
      x.harness.behavior.callRpc("createRoom", {
        name: "new channel 2",
        memberIds: [],
      }),
      /already exists/,
    );
  } finally {
    await x.close();
  }
});

test("channel handoff resolves an existing source thread", async () => {
  const x = setup();
  try {
    await plugin(x.bb);
    x.harness.inspection.sdk.stub("threads.get", async ({ threadId }) => {
      if (threadId !== "thr_source") throw new Error("Thread not found");
      return makeThreadResponse({
        id: threadId,
        projectId: "proj_test",
        title: "Source work",
      });
    });
    assert.deepEqual(
      await x.harness.behavior.callRpc("handoffSource", {
        threadId: "thr_source",
      }),
      {
        threadId: "thr_source",
        projectId: "proj_test",
        title: "Source work",
      },
    );
    await assert.rejects(
      x.harness.behavior.callRpc("handoffSource", {
        threadId: "thr_missing",
      }),
      /Thread not found/,
    );
  } finally {
    await x.close();
  }
});

test("channel handoff draft links to standard and projectless source threads", () => {
  assert.equal(
    channelHandoffText({
      threadId: "thr_source",
      projectId: "proj_test",
      title: "Design [v2]",
    }),
    "Continue from [Design \\[v2\\]](/projects/proj_test/threads/thr_source) (@thread:thr_source)",
  );
  assert.equal(
    channelHandoffText({
      threadId: "thr_personal",
      projectId: "proj_personal",
      title: "Personal work",
    }),
    "Continue from [Personal work](/threads/thr_personal) (@thread:thr_personal)",
  );
});

test("archive stops channel work, preserves history and read state is monotonic", async () => {
  const x = setup();
  try {
    await plugin(x.bb);
    x.runtime.send(x.room, "Work", randomUUID());
    await x.harness.behavior.callRpc("channelState", {
      id: x.room.id,
      pinned: true,
      lastReadAt: 100,
    });
    await x.harness.behavior.callRpc("channelState", {
      id: x.room.id,
      lastReadAt: 50,
      archived: true,
    });
    const saved = x.store.room(x.room.id);
    assert.equal(saved.lastReadAt, 100);
    assert.equal(saved.pinned, true);
    assert.equal(saved.archived, true);
    assert.equal(x.store.work(x.a.id).length, 0);
    assert.throws(() => x.runtime.send(saved, "More", randomUUID()), /Restore/);
    await x.harness.behavior.callRpc("channelState", {
      id: x.room.id,
      archived: false,
    });
    assert.equal(x.store.messages(x.room.id).length, 1);
    assert.equal(x.store.room(x.room.id).paused, false);
  } finally {
    await x.close();
  }
});

test("a channel can be marked unread without changing normal read ordering", async () => {
  const x = setup();
  try {
    await plugin(x.bb);
    const updatedAt = x.store.room(x.room.id).updatedAt;
    await x.harness.behavior.callRpc("channelState", {
      id: x.room.id,
      lastReadAt: updatedAt,
    });
    assert.equal(x.store.room(x.room.id).lastReadAt, updatedAt);
    await x.harness.behavior.callRpc("channelState", {
      id: x.room.id,
      markUnread: true,
    });
    assert.ok(x.store.room(x.room.id).lastReadAt! < updatedAt);
    await x.harness.behavior.callRpc("channelState", {
      id: x.room.id,
      lastReadAt: updatedAt,
    });
    assert.equal(x.store.room(x.room.id).lastReadAt, updatedAt);
    await x.harness.behavior.callRpc("channelState", {
      id: x.room.id,
      lastReadAt: updatedAt - 2,
    });
    assert.equal(x.store.room(x.room.id).lastReadAt, updatedAt);
  } finally {
    await x.close();
  }
});

test("bot output advances channel activity after the owner's message was read", async () => {
  const x = setup();
  try {
    x.runtime.send(x.room, "@atlas review", randomUUID());
    const room = x.store.room(x.room.id);
    x.store.putRoom({ ...room, updatedAt: 10, lastReadAt: 10 });
    const job = x.store.work(x.a.id)[0]!;
    job.status = "done";
    job.reply = "Done";
    x.store.putJob(job);
    await x.runtime.driveRoom(x.store.room(room.id));
    assert.ok(
      x.store.room(room.id).updatedAt > x.store.room(room.id).lastReadAt!,
    );
  } finally {
    await x.close();
  }
});

test("channel requests run without starting a bot's unscheduled mission", async () => {
  const x = setup();
  try {
    await plugin(x.bb);
    x.store.put({ ...x.a, intervalMinutes: 0, lastWakeAt: 1 });
    x.store.putRoom({ ...x.room, paused: true }); // Legacy stopped rooms are open now.
    x.runtime.send(x.store.room(x.room.id), "@atlas help", randomUUID());
    await x.runtime.tick();
    assert.equal(x.store.work(x.a.id).length, 1);
    const job = x.store.work(x.a.id)[0]!;
    assert.equal(job.status, "running");
    assert.equal(job.roomId, x.room.id);
    const hook = x.harness.inspection.registrations.hooks["message.dispatch"]!;
    assert.equal(
      (
        await hook(
          makeMessageDispatchHookContext({
            thread: { id: job.threadId! },
            input: { text: jobPrompt(job) },
            originPluginId: "bot-teams",
          }),
        )
      ).action,
      "proceed",
    );
    await x.harness.behavior.callRpc("cancelJob", { id: job.id });
    assert.equal(x.store.work(x.a.id).length, 0);
    x.runtime.send(
      x.store.room(x.room.id),
      "@atlas a different question",
      randomUUID(),
    );
    assert.equal(
      x.store.work(x.a.id).length,
      1,
      "stopping one response leaves the conversation usable",
    );
  } finally {
    await x.close();
  }
});

test("late collection of an older answer still marks new channel activity", async () => {
  const x = setup();
  try {
    x.runtime.send(x.room, "@atlas review", randomUUID());
    const job = x.store.work(x.a.id)[0]!;
    job.status = "done";
    job.reply = "An earlier answer";
    x.store.putJob(job);
    const later = Date.now() + 10;
    x.store.putRoom({
      ...x.store.room(x.room.id),
      updatedAt: later,
      lastReadAt: later,
    });
    await x.runtime.driveRoom(x.store.room(x.room.id));
    assert.ok(x.store.room(x.room.id).updatedAt > later);
    await plugin(x.bb);
    await x.harness.behavior.callRpc("channelState", {
      id: x.room.id,
      lastReadAt: x.store.room(x.room.id).updatedAt,
    });
    assert.equal(
      x.store.room(x.room.id).lastReadAt,
      x.store.room(x.room.id).updatedAt,
    );
  } finally {
    await x.close();
  }
});

test("the working stub stops the running response rather than a newer queued request", async () => {
  const x = setup();
  try {
    await plugin(x.bb);
    x.runtime.send(x.room, "@atlas first", randomUUID());
    await x.runtime.drive(x.a);
    const current = x.store.work(x.a.id)[0]!;
    x.runtime.send(
      x.room,
      "@atlas next",
      randomUUID(),
      [],
      null,
      undefined,
      undefined,
      "followup",
    );
    const visible = channelWork(x.store.roomJobs(x.room.id));
    assert.equal(visible[0]?.id, current.id);
    await x.harness.behavior.callRpc("cancelJob", { id: visible[0]!.id });
    assert.equal(x.store.job(current.id)?.status, "cancelled");
    assert.equal(x.store.work(x.a.id).length, 1);
    assert.equal(x.store.work(x.a.id)[0]?.status, "queued");
  } finally {
    await x.close();
  }
});

test("an explicit steer changes the active thread and publishes under the new message", async () => {
  const x = setup();
  try {
    x.runtime.send(x.room, "@atlas first", randomUUID());
    await x.runtime.drive(x.a);
    const current = x.store.work(x.a.id)[0]!;
    const originalRun = x.store
      .runs(x.room.id)
      .find((run) => run.id === current.runId)!;
    x.runtime.busy.set(x.a.id, { threadId: current.threadId!, at: Date.now() });
    const followUp = x.runtime.send(
      x.room,
      "@atlas use the smaller scope",
      randomUUID(),
      [],
      null,
      undefined,
      undefined,
      "steer",
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const steered = x.store.job(current.id)!;
    assert.equal(steered.runId, followUp.runId);
    assert.equal(steered.triggerMessageId, followUp.id);
    assert.equal(
      x.store
        .runs(x.room.id)
        .find((run) => run.id === originalRun.id)
        ?.pendingJobIds.includes(current.id),
      false,
    );
    assert.equal(
      (
        x.harness.inspection.sdk.callsTo("threads.send").at(-1)?.[0] as {
          mode?: string;
        }
      )?.mode,
      "steer",
    );
    x.runtime.complete(current.threadId!, "Steered answer");
    await x.runtime.driveRoom(x.store.room(x.room.id));
    assert.equal(
      x.store.messages(x.room.id).find((message) => message.id === current.id)
        ?.replyTo,
      followUp.id,
    );
  } finally {
    await x.close();
  }
});

