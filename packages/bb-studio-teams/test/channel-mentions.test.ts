import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { Store } from "../store";
import { botSchema, roomSchema } from "../contract";
import { ChannelThreads } from "../channel-thread-link";
import { registerChannelMentions } from "../channel-mentions";
import { pillText } from "../channel-bridge";

type Provider = {
  id: string;
  search(ctx: { trigger: "@"; query: string; projectId: string | null; threadId: string | null }): unknown;
  resolve(id: string): unknown;
};

function setup() {
  const host = createFakePluginHost({ pluginId: "bot-teams" });
  const store = new Store(host.bb.storage.database());
  const bot = (id: string, name: string, handle: string) =>
    botSchema.parse({
      id, name, handle, description: `${name} does things`, avatar: "🧭",
      home: "/tmp/mentions", projectId: "p", hostId: "h",
      createdAt: 1, updatedAt: 1, lastWakeAt: 0, error: null,
    });
  const atlas = bot("bot_0123456789abcdef", "Atlas", "atlas");
  const scribe = bot("bot_1123456789abcdef", "Scribe", "scribe");
  store.put(atlas);
  store.put(scribe);
  const room = (name: string, memberIds: string[], updatedAt: number) =>
    roomSchema.parse({ id: randomUUID(), name, memberIds, paused: false, createdAt: 1, updatedAt });
  const launch = room("Launch room", [atlas.id], 2);
  const design = room("Design review", [scribe.id], 3);
  store.putRoom(launch);
  store.putRoom(design);
  store.putConversation({
    id: "dm", botId: scribe.id, key: "admin", threadId: "thr_dm", title: "Direct message", kind: "admin", createdAt: 1,
  });
  store.putMessage({
    id: "m1", roomId: launch.id, runId: "r", botId: atlas.id, speaker: "Atlas",
    text: "Release check passed.", createdAt: 1, attachments: [], replyTo: null,
  });
  const providers = new Map<string, Provider>();
  const bb = {
    ...host.bb,
    ui: { registerMentionProvider: (p: Provider) => providers.set(p.id, p) },
    sdk: {
      ...host.bb.sdk,
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, title: "Release notes", titleFallback: null, updatedAt: 5 }),
        output: async () => ({ output: "Here are the notes." }),
      },
    },
  } as unknown as BbPluginApi;
  const links = new ChannelThreads(bb, store, async () => "p");
  // Link the launch room to a thread, as opening the channel would.
  store.db.prepare("INSERT INTO channel_threads VALUES (?,?,?,?)").run(launch.id, "thr_launch", launch.name, 0);
  registerChannelMentions(bb, store, links);
  const search = (id: string, query: string, threadId: string | null = null) =>
    providers.get(id)!.search({ trigger: "@", query, projectId: null, threadId }) as Promise<{ id: string; title: string; subtitle?: string }[]>;
  return { providers, search, launch, design };
}

test("bots rank channel members first and offer @all only in a channel", async () => {
  const x = setup();
  const inChannel = await x.search("bots", "", "thr_launch");
  assert.deepEqual(inChannel.map((item) => item.id), ["all", "atlas", "scribe"]);
  assert.match(inChannel[2]!.subtitle!, /not in this channel yet/);
  const elsewhere = await x.search("bots", "", "thr_other");
  assert.deepEqual(elsewhere.map((item) => item.id), ["atlas", "scribe"]);
});

test("channels are offered everywhere except inside themselves, newest first", async () => {
  const x = setup();
  // Launch room's bot reply made it the most recently active channel.
  assert.deepEqual((await x.search("channels", "")).map((item) => item.title), ["#Launch room", "#Design review"]);
  assert.deepEqual((await x.search("channels", "", "thr_launch")).map((item) => item.title), ["#Design review"]);
  const resolved = (await x.providers.get("channels")!.resolve(x.launch.id)) as { context: string };
  assert.match(resolved.context, /\[#Launch room\]\(\/plugins\/bot-teams\/channels\//);
  assert.match(resolved.context, /- Atlas: Release check passed\./);
});

test("direct messages resolve to the thread with its bot and latest reply", async () => {
  const x = setup();
  const found = await x.search("dms", "release");
  assert.deepEqual(found.map((item) => [item.id, item.title, item.subtitle]), [
    ["thr_dm", "Release notes", "Direct message with Scribe"],
  ]);
  assert.deepEqual(await x.search("dms", "", "thr_dm"), []);
  const resolved = (await x.providers.get("dms")!.resolve("thr_dm")) as { context: string };
  assert.match(resolved.context, /\[Release notes\]\(\/threads\/thr_dm\)/);
  assert.match(resolved.context, /Latest reply: Here are the notes\./);
});

test("channel-thread pills become @handles and links", () => {
  assert.equal(pillText("bots:atlas", "🧭 Atlas"), "@atlas");
  assert.equal(pillText("channels:abc", "#Launch [room]"), "[#Launch \\[room\\]](/plugins/bot-teams/channels/abc)");
  assert.equal(pillText("dms:thr_1", "Release notes"), "[Release notes](/threads/thr_1)");
  assert.equal(pillText("other:x", "X"), null);
});
