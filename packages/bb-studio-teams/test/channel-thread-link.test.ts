import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { Store } from "../store";
import { botSchema, roomSchema, type RoomMessage } from "../contract";
import { ChannelThreads } from "../channel-thread-link";
import {
  levelForPermission,
  permissionForLevel,
  channelDeliverPrefix,
  channelDeliverySchema,
  channelProviderId,
  channelStartPrefix,
  deliveryMarkdown,
} from "../channel-provider";

function setup() {
  const host = createFakePluginHost({ pluginId: "bot-teams" });
  const store = new Store(host.bb.storage.database());
  const bot = botSchema.parse({
    id: "bot_0123456789abcdef",
    name: "Editorial",
    handle: "editorial",
    avatar: "✍️",
    home: "/tmp/channel-thread-link",
    projectId: "p",
    hostId: "h",
    createdAt: 1,
    updatedAt: 1,
    lastWakeAt: 0,
    error: null,
  });
  const room = roomSchema.parse({
    id: randomUUID(),
    name: "Launch",
    memberIds: [bot.id],
    paused: false,
    createdAt: 1,
    updatedAt: 1,
  });
  store.put(bot);
  store.putRoom(room);
  const spawned: Record<string, unknown>[] = [];
  const sent: { threadId: string; text: string }[] = [];
  const titles: string[] = [];
  const selections: string[] = [];
  const deleted: string[] = [];
  const missing = new Set<string>();
  const bb = {
    ...host.bb,
    sdk: {
      ...host.bb.sdk,
      system: { config: async () => ({ primaryHostId: "h" }) },
      threads: {
        spawn: async (args: Record<string, unknown>) => {
          spawned.push(args);
          return { id: `thr_${spawned.length}` };
        },
        send: async (args: { threadId: string; input: { text: string }[] }) => {
          sent.push({ threadId: args.threadId, text: args.input[0]!.text });
          return { ok: true, delivery: "sent" };
        },
        get: async ({ threadId }: { threadId: string }) => {
          if (missing.has(threadId)) throw new Error("HTTP 404: thread not found");
          return { id: threadId, status: "idle" };
        },
        update: async (args: { title?: string; model?: string; reasoningLevel?: string }) => {
          if (args.title) titles.push(args.title);
          if (args.model) selections.push(`${args.model}:${args.reasoningLevel}`);
        },
        delete: async ({ threadId }: { threadId: string }) => {
          deleted.push(threadId);
        },
      },
    },
  } as unknown as BbPluginApi;
  const links = new ChannelThreads(bb, store, async () => "proj_personal");
  let n = 0;
  const post = (patch: Partial<RoomMessage>) => {
    const message: RoomMessage = {
      id: `m${++n}`,
      roomId: room.id,
      runId: "run",
      botId: null,
      speaker: "You",
      replyTo: null,
      attachments: [],
      text: `message ${n}`,
      createdAt: n,
      ...patch,
    };
    store.putMessage(message);
    return message;
  };
  const deliveries = () =>
    sent.map((s) => channelDeliverySchema.parse(JSON.parse(s.text.slice(channelDeliverPrefix.length))));
  return { store, bot, room, links, post, spawned, sent, titles, selections, deleted, missing, deliveries };
}

test("a new channel gets a hidden thread on the channel provider", async () => {
  const x = setup();
  const threadId = await x.links.ensure(x.room);
  assert.equal(threadId, "thr_1");
  assert.equal(await x.links.ensure(x.room), "thr_1");
  assert.equal(x.spawned.length, 1);
  const spawn = x.spawned[0] as {
    providerId: string;
    visibility: string;
    title: string;
    input: { text: string; visibility: string }[];
  };
  assert.equal(spawn.providerId, channelProviderId);
  assert.equal(spawn.visibility, "hidden");
  assert.equal(spawn.title, "Launch");
  assert.deepEqual(
    spawn.input.map((i) => [i.text, i.visibility]),
    [[channelStartPrefix, "agent-only"]],
  );
  assert.equal(x.links.roomForThread("thr_1")?.id, x.room.id);
});

test("an existing channel replays its recent messages one by one, then continues live", async () => {
  const x = setup();
  x.post({ text: "Draft the launch post" });
  x.post({ botId: x.bot.id, speaker: "Editorial", text: "Drafted." });
  await x.links.ensure(x.room);
  const first = (x.spawned[0] as { input: { text: string }[] }).input[0]!.text;
  assert.equal(first, channelStartPrefix);
  assert.deepEqual(
    x.deliveries().map((d) => [d.kind, d.speaker, d.text]),
    [
      ["owner", "You", "Draft the launch post"],
      ["bot", "Editorial", "Drafted."],
    ],
  );
  assert.equal(deliveryMarkdown(x.deliveries()[0]!), "**You**\n\nDraft the launch post");
  // Replayed messages are not delivered again; new ones follow.
  await x.links.sync(x.room.id);
  assert.equal(x.sent.length, 2);
  x.post({ botId: x.bot.id, speaker: "Editorial", text: "Published." });
  await x.links.sync(x.room.id);
  assert.deepEqual(x.deliveries().at(-1)?.text, "Published.");
});

test("a long history replays its last 50 messages after a note about the rest", async () => {
  const x = setup();
  for (let i = 1; i <= 55; i++) x.post({ botId: x.bot.id, speaker: "Editorial", text: `Update ${i}` });
  await x.links.ensure(x.room);
  const replayed = x.deliveries();
  assert.equal(replayed.length, 51);
  assert.match(replayed[0]!.text, /Showing the last 50 messages\. Use Search channel/);
  assert.equal(replayed[1]!.text, "Update 6");
  assert.equal(replayed.at(-1)!.text, "Update 55");
});

test("new messages are delivered in order; thread posts and internal results are not", async () => {
  const x = setup();
  await x.links.ensure(x.room);
  const own = x.post({ text: "typed in the thread" });
  x.links.markOrigin(own.id);
  x.post({ botId: x.bot.id, speaker: "Editorial", text: "internal", internalResult: true });
  x.post({ botId: x.bot.id, speaker: "Editorial", text: "Here is the draft." });
  x.post({ text: "sent from the CLI" });
  x.post({ text: "Automation prompt", automationId: "auto_1", speaker: "Automation: Digest" });
  x.post({ botId: x.bot.id, speaker: "Editorial", text: "" });
  await x.links.sync(x.room.id);
  assert.deepEqual(
    x.deliveries().map((d) => [d.kind, d.speaker, d.avatar, d.text]),
    [
      ["bot", "Editorial", "✍️", "Here is the draft."],
      ["you", "You", null, "sent from the CLI"],
    ],
  );
  assert.ok(x.sent.every((s) => s.threadId === "thr_1"));
  await x.links.sync(x.room.id);
  assert.equal(x.sent.length, 2);
});

test("renaming a channel renames its thread", async () => {
  const x = setup();
  await x.links.ensure(x.room);
  x.store.putRoom({ ...x.room, name: "Launch week" });
  await x.links.sync(x.room.id);
  await x.links.sync(x.room.id);
  assert.deepEqual(x.titles, ["Launch week"]);
});

test("a deleted thread is recreated, and deleting the channel deletes its thread", async () => {
  const x = setup();
  await x.links.ensure(x.room);
  x.missing.add("thr_1");
  assert.equal(await x.links.ensure(x.room), "thr_2");
  await x.links.forget(x.room.id);
  assert.deepEqual(x.deleted, ["thr_2"]);
  assert.equal(x.links.threadId(x.room.id), null);
});

test("a bot reply leads with the bot's name, since assistant messages have no author", () => {
  assert.equal(
    deliveryMarkdown({
      messageId: "m",
      kind: "bot",
      speaker: "Editorial",
      avatar: "✍️",
      workThreadId: "thr_work",
      text: "Drafted.",
      attachments: [
        { name: "chart.png", url: "/api/v1/plugins/bot-teams/http/attachment?id=a", image: true },
        { name: "draft.md", url: "/api/v1/plugins/bot-teams/http/attachment?id=b", image: false },
      ],
    }),
    "**[✍️ Editorial](/threads/thr_work)**\n\nDrafted.\n\n" +
      "![chart.png](</api/v1/plugins/bot-teams/http/attachment?id=a&inline=1>)\n\n" +
      "- [draft.md](</api/v1/plugins/bot-teams/http/attachment?id=b>)",
  );
});

test("the composer's picker carries the chat mode and bot permissions", async () => {
  for (const permission of [null, "accept-edits", "auto", "full"] as const)
    assert.equal(permissionForLevel(levelForPermission(permission)), permission);
  const x = setup();
  x.store.putRoom({ ...x.room, responseBehavior: "directed", permissionMode: "auto" });
  await x.links.ensure(x.store.room(x.room.id));
  const spawn = x.spawned[0] as { model: string; reasoningLevel: string };
  assert.deepEqual([spawn.model, spawn.reasoningLevel], ["directed", "medium"]);
  // A change made outside the thread (the CLI, agent tools) reaches the picker once.
  x.store.putRoom({ ...x.store.room(x.room.id), responseBehavior: "smart", permissionMode: null });
  await x.links.sync(x.room.id);
  await x.links.sync(x.room.id);
  assert.deepEqual(x.selections.slice(-1), ["smart:none"]);
  // A selection the thread just applied is not pushed back to it.
  x.store.putRoom({ ...x.store.room(x.room.id), responseBehavior: "everyone" });
  x.links.noteSelection(x.store.room(x.room.id));
  const before = x.selections.length;
  await x.links.sync(x.room.id);
  assert.equal(x.selections.length, before);
});
