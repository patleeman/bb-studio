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

test("an older generic channel failure recovers its own provider detail", async () => {
  const x = setup();
  try {
    const message = x.runtime.send(x.room, "@atlas Review", randomUUID());
    await x.runtime.drive(x.a);
    const job = x.store.requestJobs(message.id)[0]!;
    x.runtime.complete(job.threadId!, null, "Agent turn failed.");
    const failed = x.store.job(job.id)!;
    x.harness.inspection.sdk.stub("threads.events.list", async () => [
      {
        id: "later-failure",
        scope: { kind: "thread" },
        threadId: job.threadId!,
        seq: 3,
        createdAt: failed.updatedAt + 2000,
        type: "provider/error",
        data: { providerThreadId: "provider", message: "Later failure" },
      },
      {
        id: "original-failure",
        scope: { kind: "thread" },
        threadId: job.threadId!,
        seq: 2,
        createdAt: failed.updatedAt,
        type: "provider/error",
        data: { providerThreadId: "provider", message: "Provider error", detail: "Session limit reached" },
      },
    ]);
    const visible = await x.runtime.roomJobsWithActivity(x.room.id);
    assert.equal(visible.find((entry) => entry.id === job.id)?.error, "Session limit reached");
    assert.equal(x.store.job(job.id)?.error, "Session limit reached");
    assert.equal(x.store.job(job.id)?.updatedAt, failed.updatedAt);
  } finally {
    await x.close();
  }
});

test("retry racing with deletion returns a clear unavailable error", async () => {
  const x = setup();
  try {
    x.runtime.send(x.room, "@atlas work", randomUUID());
    const job = x.store.work(x.a.id)[0]!;
    x.store.putJob({ ...job, status: "error", error: "Failed" });
    const entered = deferred<void>(),
      finish = deferred<void>();
    const deleting = x.runtime.locked(`room:${x.room.id}`, async () => {
      entered.resolve();
      await finish.promise;
      x.store.deleteRoom(x.room.id);
    });
    await entered.promise;
    const retry = x.runtime.retryJob(job.id);
    finish.resolve();
    await deleting;
    await assert.rejects(retry, /no longer available/);
  } finally {
    await x.close();
  }
});

test("a bot's channel answer to a direct message gets one private-message tombstone", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    x.store.putRoom({ ...x.room, memberIds: [x.a.id] });
    x.store.putConversation({
      id: "direct-conversation",
      botId: x.a.id,
      key: `group:${x.room.id}`,
      threadId: "thr_direct",
      title: x.room.name,
      kind: "group",
      createdAt: 1,
    });
    x.harness.inspection.sdk.stub("threads.events.list", async () => [
      { id: "accepted", threadId: "thr_direct", seq: 3, createdAt: 3,
        type: "turn/input/accepted", scope: { kind: "turn", turnId: "turn-1" },
        data: { clientRequestId: "dm-request" } },
      { id: "started", threadId: "thr_direct", seq: 2, createdAt: 2,
        type: "turn/started", scope: { kind: "turn", turnId: "turn-1" }, data: {} },
      { id: "request", threadId: "thr_direct", seq: 1, createdAt: 1,
        type: "client/turn/requested", scope: { kind: "thread" },
        data: { requestId: "dm-request", source: "tell", initiator: "user",
          senderThreadId: null, input: [{ type: "text", text: "A private question" }] } },
    ] as never);
    const input = { id: x.room.id, text: "The answer for the channel", requestId: randomUUID() };
    const send = () => x.harness.behavior.callAgentTool("bots_channel_send", input, { threadId: "thr_direct" });
    await send();
    await send();
    await assert.rejects(
      x.harness.behavior.callAgentTool(
        "bots_channel_send",
        { ...input, requestId: randomUUID() },
        { threadId: "thr_direct" },
      ),
      /already has a channel answer/,
    );
    const messages = x.store.messages(x.room.id);
    assert.equal(messages.length, 2);
    const tombstone = messages[0]!;
    assert.equal(tombstone.id, directMessageId("thr_direct", "dm-request"));
    assert.equal(tombstone.system, "bot_dm");
    assert.equal(tombstone.sourceThreadId, "thr_direct");
    assert.equal(messages[1]!.replyTo, tombstone.id);
    assert.equal(messages[1]!.text, input.text);
    assert.ok(messages.every((message) => !message.text.includes("A private question")));
  } finally {
    await x.close();
  }
});

test("a channel job links its published reply to a direct-message tombstone", async () => {
  const x = setup();
  try {
    const request = x.runtime.send(x.room, "@atlas Work on this", randomUUID());
    const job = x.store.requestJobs(request.id)[0]!;
    x.store.putJob({
      ...job,
      threadId: "thr_joined_direct",
      status: "done",
      reply: "Final channel answer",
      directMessageRequestIds: ["dm-during-work"],
    });
    await x.runtime.driveRoom(x.room);
    const tombstone = x.store.message(directMessageId("thr_joined_direct", "dm-during-work"))!;
    assert.equal(tombstone.system, "bot_dm");
    assert.equal(tombstone.text, "You sent a DM to Atlas.");
    assert.equal(x.store.message(job.id)?.replyTo, tombstone.id);
  } finally {
    await x.close();
  }
});

test("idle recovery keeps a channel answer joined by an owner direct message", async () => {
  const x = setup();
  try {
    const trigger = x.runtime.send(x.room, "@atlas Work on this", randomUUID());
    await x.runtime.drive(x.a);
    const job = x.store.requestJobs(trigger.id)[0]!;
    const threadId = job.threadId!;
    x.harness.inspection.sdk.stub("threads.timeline", async () => ({
      rows: [{ kind: "conversation", role: "user", text: "Private follow-up" }],
    } as never));
    x.harness.inspection.sdk.stub("threads.output", async () => ({
      output: "Final channel answer",
    }));
    let eventReads = 0;
    x.harness.inspection.sdk.stub("threads.events.list", async () => {
      if (++eventReads === 1) throw new Error("Event history temporarily unavailable");
      return [
      { type: "turn/completed", scope: { kind: "turn", turnId: "joined" }, createdAt: 4, data: {} },
      { type: "turn/input/accepted", scope: { kind: "turn", turnId: "joined" }, createdAt: 3, data: { clientRequestId: "owner-dm" } },
      { type: "client/turn/requested", scope: { kind: "thread" }, createdAt: 3, data: {
        requestId: "owner-dm", source: "tell", initiator: "user", senderThreadId: null,
        input: [{ type: "text", text: "Private follow-up" }],
      } },
      { type: "turn/input/accepted", scope: { kind: "turn", turnId: "joined" }, createdAt: 2, data: { clientRequestId: "managed" } },
      { type: "client/turn/requested", scope: { kind: "thread" }, createdAt: 1, data: {
        requestId: "managed", source: "tell", initiator: "user", senderThreadId: null,
        input: [{ type: "text", text: jobPrompt(job) }],
      } },
      ] as never;
    });
    await x.runtime.drive(x.a);
    assert.equal(x.store.job(job.id)?.status, "running");
    await x.runtime.drive(x.a);
    assert.equal(x.store.job(job.id)?.status, "done");
    assert.deepEqual(x.store.job(job.id)?.directMessageRequestIds, ["owner-dm"]);
    await x.runtime.driveRoom(x.room);
    const tombstone = x.store.message(directMessageId(threadId, "owner-dm"))!;
    assert.equal(tombstone.system, "bot_dm");
    assert.equal(x.store.message(job.id)?.replyTo, tombstone.id);
    assert.equal(x.store.message(job.id)?.text, "Final channel answer");
  } finally {
    await x.close();
  }
});

test("channel lookup keeps a bot thread nested under its channel", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    x.store.putConversation({
      id: "channel-thread",
      botId: x.a.id,
      key: `group:${x.room.id}`,
      threadId: "thr_channel",
      title: x.room.name,
      kind: "group",
      createdAt: 1,
    });
    assert.equal(
      await x.harness.behavior.callRpc("channelForThread", { threadId: "thr_channel" }),
      x.room.id,
    );
    assert.equal(
      await x.harness.behavior.callRpc("channelForThread", { threadId: "other-thread" }),
      null,
    );
  } finally {
    await x.close();
  }
});

test("agent tools create channels idempotently and attribute sends to the actual caller", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    const call = async (
      name: string,
      input: unknown,
      threadId = "thr_orchestrator",
    ) => {
      const result = await x.harness.behavior.callAgentTool(name, input, {
        threadId,
      });
      assert.equal(typeof result, "string");
      return JSON.parse(result as string);
    };
    const requestId = randomUUID();
    const input = {
      name: "Consultation",
      memberIds: [x.a.id, x.b.id],
      requestId,
    };
    const room = await call("bots_channel_create", input);
    assert.equal((await call("bots_channel_create", input)).id, room.id);
    assert.equal(x.store.rooms().length, 2);
    await assert.rejects(
      call("bots_channel_create", { ...input, name: "Different" }),
      /different content/,
    );
    const send = {
      id: room.id,
      text: "@all Review this choice",
      requestId: randomUUID(),
      botId: x.a.id,
      speaker: "You",
    };
    const message = await call("bots_channel_send", send);
    assert.equal(message.botId, null);
    assert.equal(message.speaker, "BB agent");
    assert.equal(message.sourceThreadId, "thr_orchestrator");
    assert.equal((await call("bots_channel_send", send)).id, message.id);
    await assert.rejects(
      call("bots_channel_send", send, "thr_other"),
      /different content/,
    );
    const state = await call("bots_channel_request", {
      channelId: room.id,
      requestId: message.id,
    });
    assert.equal(state.total, 2);
    assert.equal(state.complete, false);
    assert.equal(
      (await call("bots_channel_read", { id: room.id })).messages.find(
        (entry: { speaker?: string }) => entry.speaker === "BB agent",
      )?.speaker,
      "BB agent",
    );
  } finally {
    await x.close();
  }
});

test("consultation status includes errors, PASS, cancellation, and only settles after publication", async () => {
  const x = setup();
  try {
    const m = x.runtime.send(x.room, "Review", randomUUID());
    const [a, b] = x.store.requestJobs(m.id);
    x.store.putJob({ ...a!, status: "done", reply: "[PASS]" });
    x.store.putJob({ ...b!, status: "error", error: "Provider unavailable" });
    assert.equal(requestStatus(x.store, x.room.id, m.id).complete, false);
    await x.runtime.driveRoom(x.room);
    let state = requestStatus(x.store, x.room.id, m.id, 1);
    assert.equal(state.complete, true);
    assert.equal(state.failed, 1);
    assert.equal(state.nextOffset, 1);
    assert.equal(state.responses[0]!.reply, "[PASS]");
    assert.equal(x.store.messages(x.room.id).length, 1);
    x.store.putJob({ ...b!, status: "cancelled", cancellationPending: true });
    state = requestStatus(x.store, x.room.id, m.id);
    assert.equal(state.complete, false);
    assert.equal(state.cancelled, 1);
    await assert.rejects(async () =>
      requestStatus(x.store, randomUUID(), m.id),
    );
  } finally {
    await x.close();
  }
});

test("bot consultation identity, self-response prevention, and handoff limits survive cross-channel sends", async () => {
  const x = setup();
  try {
    x.runtime.send(x.room, "@atlas review", randomUUID());
    await x.runtime.drive(x.a);
    const j = x.store.work(x.a.id)[0]!;
    assert.ok(j.threadId);
    // Fake host does not deliver active events, so mark the accepted turn running.
    x.store.putJob({ ...j, status: "running" });
    assert.throws(
      () => agentAuthor(x.store, j.threadId!, x.room.id),
      /final answer/,
    );
    const room = { ...x.room, id: randomUUID(), name: "Other" };
    x.store.putRoom(room);
    const author = agentAuthor(x.store, j.threadId!, room.id);
    assert.equal(author.botId, x.a.id);
    assert.equal(author.depth, 1);
    for (let i = 0; i < 3; i++) {
      const message = x.runtime.send(
        room,
        "Review",
        randomUUID(),
        [],
        null,
        author,
      );
      assert.deepEqual(
        x.store.requestJobs(message.id).map((j) => j.botId),
        [x.b.id],
      );
    }
    assert.throws(
      () => x.runtime.send(room, "More", randomUUID(), [], null, author),
      /three consultation/,
    );
    x.store.putJob({ ...j, status: "running", depth: 2 });
    const deep = agentAuthor(x.store, j.threadId!, room.id);
    assert.equal(deep.depth, 3);
    assert.throws(
      () =>
        x.runtime.send(room, "More", randomUUID(), [], null, {
          ...deep,
          sourceThreadId: "another",
        }),
      /handoff limit/,
    );
    x.store.putJob({ ...j, status: "cancelled" });
    assert.throws(
      () => agentAuthor(x.store, j.threadId!, room.id),
      /no longer active/,
    );
  } finally {
    await x.close();
  }
});

test("a consultation caps mention fan-out at 32 responses", async () => {
  const x = setup();
  try {
    const members = [
      x.a,
      x.b,
      ...Array.from({ length: 14 }, (_, i) =>
        bot(
          `/tmp/m${i}`,
          `bot_${(i + 500).toString(16).padStart(16, "0")}`,
          `Peer${i}`,
        ),
      ),
    ];
    members.forEach((b) => x.store.put(b));
    const room = { ...x.room, memberIds: members.map((b) => b.id) };
    x.store.putRoom(room);
    const m = x.runtime.send(room, "Discuss", randomUUID());
    for (const job of x.store.requestJobs(m.id))
      x.store.putJob({
        ...job,
        status: "done",
        reply: members.map((b) => `@${b.handle}`).join(" "),
      });
    await x.runtime.driveRoom(room);
    assert.equal(x.store.requestJobs(m.id).length, 32);
    assert.match(
      requestStatus(x.store, room.id, m.id).error!,
      /32-response limit/,
    );
  } finally {
    await x.close();
  }
});

test("bot tools require target membership and auto-join channels they create", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    x.runtime.send(x.room, "@atlas Check", randomUUID());
    await x.runtime.drive(x.a);
    const job = x.store.work(x.a.id)[0]!;
    x.store.putJob({ ...job, status: "running" });
    const threadId = job.threadId!;
    const call = (name: string, input: unknown) =>
      x.harness.behavior.callAgentTool(name, input, { threadId });
    const privateRoom = {
      ...x.room,
      id: randomUUID(),
      name: "Private",
      memberIds: [x.b.id],
    };
    x.store.putRoom(privateRoom);
    const request = x.runtime.send(
      privateRoom,
      "Private context",
      randomUUID(),
    );
    for (const [name, input] of [
      ["bots_channel_read", { id: privateRoom.id }],
      [
        "bots_channel_request",
        { channelId: privateRoom.id, requestId: request.id },
      ],
      [
        "bots_channel_send",
        { id: privateRoom.id, text: "Hello", requestId: randomUUID() },
      ],
      ["bots_channel_invite", { channelId: privateRoom.id, botId: x.a.id }],
    ] as const)
      await assert.rejects(call(name, input), /invited|Join/);
    const catalog = JSON.parse((await call("bots_channels", {})) as string);
    assert.ok(!catalog.channels.some((r: Room) => r.id === privateRoom.id));
    const own = JSON.parse(
      (await call("bots_channel_create", {
        name: "My consultation",
        memberIds: [x.b.id],
        requestId: randomUUID(),
      })) as string,
    );
    assert.ok(own.memberIds.includes(x.a.id));
    const m = JSON.parse(
      (await call("bots_channel_send", {
        id: own.id,
        text: "Review",
        requestId: randomUUID(),
      })) as string,
    );
    assert.equal(m.botId, x.a.id);
    assert.equal(m.speaker, x.a.name);
  } finally {
    await x.close();
  }
});

test("resolved retries no longer count as failed consultation responses", async () => {
  const x = setup();
  try {
    const message = x.runtime.send(x.room, "@atlas Review", randomUUID());
    const job = x.store.requestJobs(message.id)[0]!;
    x.store.putJob({ ...job, status: "error", error: "Temporary" });
    await x.runtime.driveRoom(x.room);
    const retry = await x.runtime.retryJob(job.id);
    x.store.putJob({ ...retry, status: "done", reply: "Ready" });
    await x.runtime.driveRoom(x.room);
    const state = requestStatus(x.store, x.room.id, message.id);
    assert.equal(state.complete, true);
    assert.equal(state.failed, 0);
    assert.equal(state.error, null);
    assert.equal(state.responses[0]?.supersededBy, retry.id);
  } finally {
    await x.close();
  }
});

test("Directed routes reply targets and mentions", async () => {
  const x = setup();
  try {
    const room = { ...x.room, responseBehavior: "directed" as const };
    x.store.putRoom(room);
    const quiet = x.runtime.send(room, "Thanks!", randomUUID());
    assert.equal(x.store.requestJobs(quiet.id).length, 0);
    const target = x.runtime.send(room, "@atlas Check this", randomUUID());
    assert.deepEqual(
      x.store.requestJobs(target.id).map((j) => j.botId),
      [x.a.id],
    );
    x.store.putMessage({
      ...target,
      id: "atlas-reply",
      botId: x.a.id,
      speaker: x.a.name,
      text: "Ready",
    });
    const reply = x.runtime.send(
      room,
      "One more question",
      randomUUID(),
      [],
      "atlas-reply",
    );
    assert.deepEqual(
      x.store.requestJobs(reply.id).map((j) => j.botId),
      [x.a.id],
    );
    const both = x.runtime.send(
      room,
      "@scribe Compare",
      randomUUID(),
      [],
      "atlas-reply",
    );
    assert.equal(x.store.requestJobs(both.id).length, 2);
    const everyone = x.runtime.send(room, "@all Review", randomUUID());
    assert.equal(x.store.requestJobs(everyone.id).length, 2);
  } finally {
    await x.close();
  }
});

test("broadcast mentions override every mode and address only channel members", async () => {
  for (const responseBehavior of ["directed", "smart", "everyone"] as const) {
    const x = setup();
    try {
      const room = { ...x.room, responseBehavior };
      x.store.putRoom(room);
      // Older installations may have a bot whose handle is now reserved.
      const outsider = bot("/tmp/channel", "bot_2123456789abcdef", "Channel");
      x.store.put(outsider);
      x.runtime.route = async () => {
        throw new Error("Broadcast must bypass selection");
      };
      for (const alias of ["all", "channel", "everyone"]) {
        const message = x.runtime.send(
          room,
          `@atlas @${alias} Review`,
          randomUUID(),
        );
        assert.deepEqual(
          x.store.requestJobs(message.id).map((j) => j.botId).sort(),
          [x.a.id, x.b.id].sort(),
        );
        assert.deepEqual(x.store.room(room.id).memberIds, room.memberIds);
      }
      x.store.put({ ...outsider, retired: true });
      const message = x.runtime.send(room, "@CHANNEL Review", randomUUID());
      assert.equal(x.store.requestJobs(message.id).length, 2);
      const empty = { ...room, id: randomUUID(), memberIds: [] };
      x.store.putRoom(empty);
      const emptyMessage = x.runtime.send(empty, "@channel Review", randomUUID());
      assert.equal(x.store.requestJobs(emptyMessage.id).length, 0);
      assert.deepEqual(x.store.room(empty.id).memberIds, []);
    } finally {
      await x.close();
    }
  }
});

test("Smart persists sends immediately, chooses a subset once, and permits silence", async () => {
  const x = setup();
  try {
    const room = { ...x.room, responseBehavior: "smart" as const };
    x.store.putRoom(room);
    let finish!: (ids: string[]) => void;
    let calls = 0;
    x.runtime.route = async () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const id = randomUUID();
    const m = x.runtime.send(room, "Verify this claim", id);
    assert.equal(x.store.requestJobs(id).length, 0);
    assert.equal(requestStatus(x.store, room.id, id).complete, false);
    assert.equal(x.runtime.send(room, "Verify this claim", id).id, m.id);
    await x.runtime.driveRoom(room);
    await x.runtime.driveRoom(room);
    assert.equal(calls, 1);
    finish([x.a.id]);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(
      x.store.requestJobs(id).map((j) => j.botId),
      [x.a.id],
    );
    x.runtime.route = async () => [];
    const silent = x.runtime.send(room, "Thanks", randomUUID());
    await x.runtime.driveRoom(room);
    await new Promise((r) => setImmediate(r));
    assert.equal(requestStatus(x.store, room.id, silent.id).complete, true);
    assert.equal(x.store.requestJobs(silent.id).length, 0);
    assert.equal(
      x.store.messages(room.id).some((m) => m.text === "[PASS]"),
      false,
    );
  } finally {
    await x.close();
  }
});

test("failed Smart routing preserves the message, never fans out, and can retry", async () => {
  const x = setup();
  try {
    const room = { ...x.room, responseBehavior: "smart" as const };
    x.store.putRoom(room);
    x.runtime.route = async () => {
      throw new Error("Router unavailable");
    };
    const m = x.runtime.send(room, "Review this", randomUUID());
    await x.runtime.driveRoom(room);
    await new Promise((r) => setImmediate(r));
    assert.equal(x.store.requestJobs(m.id).length, 0);
    assert.match(
      requestStatus(x.store, room.id, m.id).error!,
      /Router unavailable/,
    );
    x.runtime.route = async () => [x.b.id];
    x.runtime.retryRouting(room.id, m.id);
    await x.runtime.driveRoom(room);
    await new Promise((r) => setImmediate(r));
    assert.equal(x.store.requestJobs(m.id)[0]?.botId, x.b.id);
    assert.equal(x.store.messages(room.id).length, 1);
  } finally {
    await x.close();
  }
});

test("archiving during routing aborts it and cannot wake a removed bot", async () => {
  const x = setup();
  try {
    const room = { ...x.room, responseBehavior: "smart" as const };
    x.store.putRoom(room);
    let finish!: (ids: string[]) => void, signal!: AbortSignal;
    x.runtime.route = async (_m, _r, _b, s) => {
      signal = s;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const m = x.runtime.send(room, "Review this", randomUUID());
    await x.runtime.driveRoom(room);
    await x.runtime.stopRoom(room);
    assert.equal(signal.aborted, true);
    finish([x.a.id]);
    await new Promise((r) => setImmediate(r));
    assert.equal(x.store.requestJobs(m.id).length, 0);
  } finally {
    await x.close();
  }
});

test("bot images join the current response once, including image-only replies", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=",
      "base64",
    );
    x.harness.inspection.sdk.stub("files.read", async () => ({
      content: bytes.toString("base64"),
      contentEncoding: "base64",
      sizeBytes: bytes.length,
      mimeType: "image/png",
      path: "/tmp/a/pixel.png",
    }));
    x.harness.inspection.sdk.stub("projects.attachments.read", async () => ({
      bytes,
      mimeType: "image/png",
    }));
    const m = x.runtime.send(x.room, "@atlas Share an image", randomUUID());
    await x.runtime.drive(x.a);
    const job = x.store.requestJobs(m.id)[0]!;
    const call = () =>
      x.harness.behavior.callAgentTool(
        "bots_publish_image",
        { path: "/tmp/a/pixel.png", alt: "QA pixel" },
        { threadId: job.threadId! },
      );
    await call();
    await call();
    assert.equal(x.store.job(job.id)!.outputAttachments.length, 1);
    assert.equal(
      x.store.messages(x.room.id).length,
      1,
      "publishing does not create a duplicate message",
    );
    x.runtime.complete(job.threadId!, "[PASS]");
    await x.runtime.driveRoom(x.room);
    const reply = x.store.message(job.id)!;
    assert.equal(reply.text, "");
    assert.equal(reply.attachments[0]!.type, "localImage");
    assert.equal(reply.attachments[0]!.alt, "QA pixel");
    const http = await x.harness.behavior.fetchHttp(
      "GET",
      `/attachment?id=${reply.attachments[0]!.id}&inline=1`,
    );
    assert.equal(http.headers.get("Content-Type"), "image/png");
    assert.match(http.headers.get("Content-Disposition")!, /^inline;/);
    await assert.rejects(call(), /active channel response/);
  } finally {
    await x.close();
  }
});

test("image classification inspects bytes and keeps SVG downloads non-executable", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    x.harness.inspection.sdk.stub("system.config", async () => ({
      primaryHostId: "host_test",
    }));
    const a = (await x.harness.behavior.callRpc("upload", {
      id: x.room.id,
      name: "pretend.png",
      mimeType: "image/png",
      data: Buffer.from('<svg onload="alert(1)"></svg>').toString("base64"),
    })) as { id: string; type: string };
    assert.equal(a.type, "localFile");
    const http = await x.harness.behavior.fetchHttp(
      "GET",
      `/attachment?id=${a.id}&inline=1`,
    );
    assert.match(http.headers.get("Content-Disposition")!, /^attachment;/);
    assert.equal(http.headers.get("Content-Type"), "application/octet-stream");
  } finally {
    await x.close();
  }
});

test("deleting during routing cancels classification and keeps the channel deleted", async () => {
  const x = setup();
  try {
    const room = { ...x.room, responseBehavior: "smart" as const };
    x.store.putRoom(room);
    let finish!: (ids: string[]) => void, signal!: AbortSignal;
    x.runtime.route = async (_m, _r, _b, s) => {
      signal = s;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const m = x.runtime.send(room, "Review", randomUUID());
    await x.runtime.driveRoom(room);
    await x.runtime.deleteRoom(room.id);
    assert.equal(signal.aborted, true);
    finish([x.a.id]);
    await new Promise((r) => setImmediate(r));
    assert.equal(x.store.findRoom(room.id), null);
    assert.equal(x.store.message(m.id), null);
    assert.equal(x.store.requestJobs(m.id).length, 0);
  } finally {
    await x.close();
  }
});

test("bot publication rejects host paths outside its workspace before reading", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    const m = x.runtime.send(x.room, "@atlas Image", randomUUID());
    await x.runtime.drive(x.a);
    const job = x.store.requestJobs(m.id)[0]!;
    for (const path of [
      "/tmp/b/private.png",
      "/tmp/a/../b/private.png",
      "/tmp/ab/image.png",
      "relative.png",
    ])
      await assert.rejects(
        x.harness.behavior.callAgentTool(
          "bots_publish_image",
          { path },
          { threadId: job.threadId! },
        ),
        /workspace|absolute/,
      );
    assert.equal(x.harness.inspection.sdk.callsTo("files.read").length, 0);
    assert.deepEqual(x.store.job(job.id)!.outputAttachments, []);
  } finally {
    await x.close();
  }
});

test("router validates model output and asks Studio Decisions' model with the bot's host and provider", async () => {
  const { selectBots, parseRouting } = await import("../smart-router");
  const x = setup();
  try {
    assert.deepEqual(parseRouting('{"botIds":[]}', [x.a]), []);
    assert.throws(
      () => parseRouting('{"botIds":["unknown"]}', [x.a]),
      /unknown bot/,
    );
    assert.throws(() => parseRouting("sure, wake Atlas", [x.a]));
    const requests: { hostId: string; providerId: string | null }[] = [];
    const m = x.runtime.send(x.room, "Question", randomUUID());
    assert.deepEqual(
      await selectBots(
        {
          ask: async () => {
            throw new Error("The Jev engine must not run.");
          },
          model: async (request) => {
            requests.push(request);
            return JSON.stringify({ botIds: [x.a.id] });
          },
        },
        x.a.hostId,
        x.a.providerId,
        m,
        [],
        [x.a],
        x.runtime.abort.signal,
        [],
        [x.a.id],
        true,
      ),
      [x.a.id],
    );
    assert.deepEqual(
      requests.map((r) => [r.hostId, r.providerId]),
      [[x.a.hostId, x.a.providerId]],
    );
    assert.equal(x.harness.inspection.sdk.callsTo("threads.spawn").length, 0, "Studio Decisions owns the session");
  } finally {
    await x.close();
  }
});

test("dispatching responses can use channel tools while scheduled recursion remains blocked", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    x.runtime.send(x.room, "@atlas Check", randomUUID());
    await x.runtime.drive(x.a);
    const job = x.store.work(x.a.id)[0]!;
    x.store.putJob({ ...job, status: "dispatching" });
    assert.equal(agentAuthor(x.store, job.threadId!).botId, x.a.id);
    await x.harness.behavior.callAgentTool(
      "bots_channel_read",
      { id: x.room.id },
      { threadId: job.threadId! },
    );
    x.store.putJob({ ...x.store.job(job.id)!, automationId: "auto_test" });
    await assert.rejects(
      x.harness.behavior.callAgentTool(
        "bots_channel_automation_create",
        {
          name: "Recursive",
          prompt: "Run again",
          requestId: randomUUID(),
          trigger: { triggerType: "once", runAt: Date.now() + 60000 },
        },
        { threadId: job.threadId! },
      ),
      /Scheduled channel work cannot/,
    );
  } finally {
    await x.close();
  }
});

test("general file publication becomes visible only when its response posts", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    const bytes = Buffer.from("name,value\nverified,42\n");
    x.harness.inspection.sdk.stub("files.read", async () => ({
      path: "/tmp/a/report.csv",
      content: bytes.toString("base64"),
      contentEncoding: "base64",
      sizeBytes: bytes.length,
    }));
    const m = x.runtime.send(x.room, "@atlas Publish report", randomUUID());
    await x.runtime.drive(x.a);
    const job = x.store.requestJobs(m.id)[0]!;
    x.store.putJob({ ...job, status: "dispatching" });
    await x.harness.behavior.callAgentTool(
      "bots_publish_file",
      { path: "/tmp/a/report.csv" },
      { threadId: job.threadId! },
    );
    assert.equal(x.store.message(job.id)?.attachments.length ?? 0, 0);
    assert.equal(x.store.job(job.id)?.outputAttachments[0]?.type, "localFile");
    x.runtime.complete(job.threadId!, "Report ready");
    await x.runtime.driveRoom(x.room);
    assert.deepEqual(x.store.message(job.id)?.attachments.map((a) => a.name), ["report.csv"]);
  } finally {
    await x.close();
  }
});

test("saved usage limits survive reload and enforce channel turn capacity", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    const limits = {
      turnsPerHour: 1,
      turnsPerDay: 2,
      minutesPerTurn: 5,
      concurrentForks: 1,
    };
    await x.harness.behavior.callRpc("saveLimits", {
      kind: "channel",
      id: x.room.id,
      limits,
    });
    x.runtime.send(x.store.room(x.room.id), "@atlas First", randomUUID());
    await x.runtime.drive(x.a);
    const job = x.store.work(x.a.id)[0]!;
    x.store.putJob({ ...job, status: "done", startedAt: Date.now() });
    x.runtime.busy.clear();
    x.runtime.send(x.store.room(x.room.id), "@atlas Second", randomUUID());
    await assert.rejects(x.runtime.drive(x.a), /Channel limit reached/);
    assert.equal(createTestStore(x.store.db).room(x.room.id).limits?.turnsPerHour, 1);
    assert.equal(x.runtime.data.usage(x.room.id).turns, 1);
    assert.equal(x.runtime.data.usage(x.room.id).active, 1);
  } finally {
    await x.close();
  }
});

test("channel queries use indexes and bound run history before parsing", async () => {
  const x = setup();
  try {
    for (const sql of [
      "SELECT json FROM room_messages WHERE room_id=? ORDER BY rowid DESC LIMIT 200",
      "SELECT json FROM room_runs WHERE room_id=? ORDER BY rowid DESC LIMIT 50",
      "SELECT json FROM jobs WHERE json_extract(json,'$.roomId')=? ORDER BY created_at DESC LIMIT 100",
    ]) {
      const plan = x.store.db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(x.room.id) as { detail: string }[];
      assert.ok(
        plan.some((r) => r.detail.includes("USING INDEX")),
        JSON.stringify(plan),
      );
      assert.ok(
        !plan.some((r) => r.detail.startsWith("SCAN ")),
        JSON.stringify(plan),
      );
    }
    for (let i = 0; i < 80; i++)
      x.runtime.send(x.room, `@atlas fixture ${i}`, randomUUID());
    assert.equal(x.store.runs(x.room.id, 50).length, 50);
  } finally {
    await x.close();
  }
});

test("current uploads survive a full set of earlier channel files", async () => {
  const x = setup();
  try {
    const file = (name: string) => ({
      id: randomUUID(),
      roomId: x.room.id,
      projectId: x.a.projectId,
      path: `/tmp/${name}`,
      name,
      type: "localFile" as const,
      sizeBytes: 1,
    });
    const earlier = Array.from({ length: 10 }, (_, i) => file(`old-${i}.txt`));
    const current = Array.from({ length: 10 }, (_, i) => file(`new-${i}.txt`));
    for (const a of [...earlier, ...current]) x.store.putAttachment(a);
    x.runtime.send({ ...x.room, memberIds: [] }, "Earlier files", randomUUID(), earlier);
    const m = x.runtime.send(x.room, "@atlas Read the uploads", randomUUID(), current);
    await x.runtime.drive(x.a);
    assert.deepEqual(
      new Set(x.store.requestJobs(m.id)[0]!.attachments.map((a) => a.id)),
      new Set(current.map((a) => a.id)),
    );
  } finally {
    await x.close();
  }
});

test("transcript pages bound messages, seek directly, and refresh historical windows", async () => {
  const x = setup();
  await plugin(x.bb);
  try {
    for (let i = 0; i < 1000; i++) {
      x.store.putMessage({
        id: `return:fixture:${i}`,
        roomId: x.room.id,
        runId: "fixture",
        botId: null,
        speaker: "You",
        text: `Message ${i}`,
        replyTo: i === 999 ? "return:fixture:0" : null,
        attachments: [],
        createdAt: 1,
      });
    }
    const latest = (await x.harness.behavior.callRpc("room", {
      id: x.room.id,
    })) as ReturnType<Store["transcript"]>;
    assert.equal(latest.messages.length, 50);
    assert.equal(latest.messages[0]!.id, "return:fixture:950");
    assert.equal(latest.parents[0]!.id, "return:fixture:0");
    assert.equal(latest.hasOlder, true);
    assert.equal(latest.hasNewer, false);
    const around = x.store.transcript(x.room.id, { around: "return:fixture:100" });
    assert.equal(around.messages.length, 50);
    assert(around.messages.some((m) => m.id === "return:fixture:100"));
    assert.equal(around.hasOlder, true);
    assert.equal(around.hasNewer, true);
    const older = x.store.transcript(x.room.id, {
      before: around.messages[0]!.id,
    });
    const newer = x.store.transcript(x.room.id, {
      after: older.messages.at(-1)!.id,
    });
    assert.deepEqual(newer.messages, around.messages);
    x.store.putMessage({
      ...latest.messages[0]!,
      id: "new-arrival",
      replyTo: null,
    });
    const refreshed = (await x.harness.behavior.callRpc("room", {
      id: x.room.id,
      start: around.messages[0]!.id,
      limit: 50,
    })) as ReturnType<Store["transcript"]>;
    assert.deepEqual(refreshed.messages, around.messages);
    assert.equal(refreshed.hasNewer, true);
    const other = { ...x.room, id: randomUUID() };
    x.store.putRoom(other);
    assert.throws(() => x.store.transcript(other.id, { around: "return:fixture:100" }), /not found/);
    assert.throws(() => x.store.transcript(x.room.id, { around: "missing" }), /not found/);
    await assert.rejects(
      x.harness.behavior.callRpc("room", { id: x.room.id, limit: 151 }),
    );
    const first = x.store.transcript(x.room.id, { around: "return:fixture:0" });
    assert.equal(first.hasOlder, false);
    assert.equal(first.messages.length, 50);
    const nearEnd = x.store.transcript(x.room.id, { around: "new-arrival" });
    assert.equal(nearEnd.messages.length, 50);
    assert.equal(nearEnd.messages.at(-1)!.id, "new-arrival");
    assert.equal(nearEnd.hasNewer, false);
    const hidden = {
      ...latest.messages[0]!,
      id: "hidden-trigger",
      automationId: "auto_fixture",
    };
    x.store.putMessage(hidden);
    assert.throws(
      () => x.store.transcript(x.room.id, { around: hidden.id }),
      /not found/,
    );
    assert(
      !x.store.transcript(x.room.id).messages.some((m) => m.id === hidden.id),
    );
    for (const sql of [
      "SELECT json FROM room_messages WHERE room_id=? ORDER BY rowid DESC LIMIT 50",
      "SELECT json FROM room_messages WHERE room_id=? AND rowid<? ORDER BY rowid DESC LIMIT 50",
      "SELECT json FROM room_messages WHERE room_id=? AND rowid>? ORDER BY rowid ASC LIMIT 50",
    ]) {
      const plan = x.store.db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(
          ...(sql.includes("rowid<") || sql.includes("rowid>")
            ? [x.room.id, 500]
            : [x.room.id]),
        ) as { detail: string }[];
      assert(
        plan.some((p) => p.detail.includes("messages_by_room")),
        JSON.stringify(plan),
      );
      assert(
        !plan.some((p) => p.detail.includes("SCAN room_messages")),
        JSON.stringify(plan),
      );
    }
  } finally {
    await x.close();
  }
});
