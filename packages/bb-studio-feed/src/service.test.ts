import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { FeedService, type Notification, type NotifyMode, type Origin } from "./service";
import type { RealtimeEvent } from "./shared";
import { DUPLICATE_WINDOW_MS, FeedStore, MIGRATIONS } from "./store";

const REPLY = 'Delays cleared at 8:10.\n\n::post{title="Harlem Line delays cleared" topic="Commute" story="harlem-line"}';

function setup(options: { mode?: NotifyMode; origins?: Record<string, Origin | null> } = {}) {
  let at = 1_000_000;
  const now = () => at;
  const advance = (ms: number) => (at += ms);
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  const store = new FeedStore(db);
  const events: RealtimeEvent[] = [];
  const notifications: Notification[] = [];
  const origins: Record<string, Origin | null> = {
    thr_bot: { author: "Commute Bot", botId: "bot_1", threadId: "thr_bot", projectId: "proj_1", channelId: "room_1", channelName: "command-center" },
    thr_channel: { author: "command-center", botId: null, threadId: "thr_channel", projectId: "proj_1", channelId: "room_1", channelName: "command-center" },
    thr_plain: { author: "Morning research", botId: null, threadId: "thr_plain", projectId: "proj_1", channelId: null, channelName: null },
    ...options.origins,
  };
  const service = new FeedService({
    store,
    origin: async (threadId) => (threadId in origins ? origins[threadId]! : null),
    publish: (event) => events.push(event),
    notify: async (notification) => {
      notifications.push(notification);
    },
    notifyMode: () => options.mode ?? "urgent",
    log: { warn: () => {} },
    now,
  });
  return { service, store, events, notifications, advance };
}

describe("FeedService", () => {
  it("publishes a reply that ends in a post line", async () => {
    const { service, store, events } = setup();
    const row = await service.ingest("thr_plain", REPLY);
    expect(row).toMatchObject({ title: "Harlem Line delays cleared", body: "Delays cleared at 8:10.", author: "Morning research", story: "harlem-line" });
    expect(store.list().rows).toHaveLength(1);
    expect(events).toEqual([{ type: "post", postId: row!.id, story: "harlem-line" }]);
  });

  it("ignores replies without one", async () => {
    const { service, store } = setup();
    expect(await service.ingest("thr_plain", "Nothing to report.")).toBeNull();
    expect(store.list().rows).toHaveLength(0);
  });

  it("publishes a bot's reply once when its channel goes idle with the same text", async () => {
    const { service, store } = setup();
    const [fromChannel, fromBot] = await Promise.all([service.ingest("thr_channel", REPLY), service.ingest("thr_bot", REPLY)]);
    expect(store.list().rows).toHaveLength(1);
    expect(fromBot?.id).toBe(fromChannel?.id);
    // The bot's copy names the bot.
    expect(store.get(fromChannel!.id)).toMatchObject({ author: "Commute Bot", bot_id: "bot_1", channel_name: "command-center" });
  });

  it("publishes the same text again after a day", async () => {
    const { service, store, advance } = setup();
    await service.ingest("thr_plain", REPLY);
    advance(DUPLICATE_WINDOW_MS + 1);
    await service.ingest("thr_plain", REPLY);
    expect(store.list({ stories: false }).rows).toHaveLength(2);
  });

  it("lists a story once, by its newest post, with its count", async () => {
    const { service, store, advance } = setup();
    await service.ingest("thr_plain", REPLY);
    advance(1000);
    await service.ingest("thr_plain", 'Delays again.\n::post{title="Harlem Line delays are back" story="harlem-line"}');
    advance(1000);
    await service.ingest("thr_plain", 'Rain at 3.\n::post{title="Rain this afternoon"}');
    const { rows } = store.list();
    expect(rows.map((row) => [row.title, row.story_posts])).toEqual([
      ["Rain this afternoon", 1],
      ["Harlem Line delays are back", 2],
    ]);
    expect(store.story("harlem-line").map((row) => row.title)).toEqual(["Harlem Line delays cleared", "Harlem Line delays are back"]);
  });

  it("finds a reply's post by its directive line", async () => {
    const { service, store } = setup();
    const row = await service.ingest("thr_plain", REPLY);
    expect(store.byDirective('::post{title="Harlem Line delays cleared" topic="Commute" story="harlem-line"}')?.id).toBe(row!.id);
  });

  it("notifies urgent posts by default, and story updates with all", async () => {
    const urgent = setup();
    await urgent.service.ingest("thr_plain", REPLY);
    await urgent.service.ingest("thr_bot", 'Fire alarm.\n::post{title="Building alarm" priority="urgent"}');
    expect(urgent.notifications.map((item) => item.title)).toEqual(["Building alarm"]);
    expect(urgent.notifications[0]).toMatchObject({ projectId: "proj_1", threadId: "thr_bot", body: "Commute Bot in #command-center · Fire alarm." });

    const all = setup({ mode: "all" });
    await all.service.ingest("thr_plain", REPLY);
    await all.service.ingest("thr_plain", 'Back.\n::post{title="Delays are back" story="harlem-line"}');
    expect(all.notifications.map((item) => item.body)).toEqual(["Morning research · Delays cleared at 8:10.", "Update · Morning research · Back."]);
    expect(all.notifications[1]?.coalesceKey).toBe("feed:harlem-line");

    const off = setup({ mode: "off" });
    await off.service.ingest("thr_plain", 'x\n::post{title="Alarm" priority="urgent"}');
    expect(off.notifications).toHaveLength(0);
  });

  it("edits, resolves and removes posts", async () => {
    const { service, store, events } = setup();
    const row = (await service.ingest("thr_plain", REPLY))!;
    const edited = service.edit(row.id, { title: "Delays cleared", resolved: true }, "thr_editor");
    expect(edited).toMatchObject({ title: "Delays cleared", edited_by: "thr_editor" });
    expect(edited?.resolved_at).not.toBeNull();
    expect(service.edit(row.id, { resolved: false }, "you")?.resolved_at).toBeNull();
    expect(service.remove(row.id)).toBe(true);
    expect(store.get(row.id)).toBeNull();
    expect(events.at(-1)).toEqual({ type: "removed", postId: row.id });
  });

  it("counts unread stories since the read mark", async () => {
    const { service, store, advance } = setup();
    await service.ingest("thr_plain", REPLY);
    advance(10);
    service.seen();
    advance(10);
    await service.ingest("thr_plain", 'b\n::post{title="Update" story="harlem-line"}');
    await service.ingest("thr_plain", 'c\n::post{title="Other"}');
    expect(store.countSince(store.lastSeenAt())).toBe(2);
  });

  it("filters by topic and words", async () => {
    const { service, store } = setup();
    await service.ingest("thr_plain", REPLY);
    await service.ingest("thr_plain", 'Rain at 3.\n::post{title="Rain" topic="Weather"}');
    expect(store.list({ topic: "commute" }).rows.map((row) => row.title)).toEqual(["Harlem Line delays cleared"]);
    expect(store.list({ query: "rain" }).rows.map((row) => row.title)).toEqual(["Rain"]);
    expect(store.topics()).toEqual([
      { topic: "Commute", posts: 1 },
      { topic: "Weather", posts: 1 },
    ]);
  });
});
