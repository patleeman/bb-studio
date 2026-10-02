import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { FeedService, type Notification, type NotifyMode, type Origin } from "./service";
import type { Priority, RealtimeEvent } from "./shared";
import { FeedStore, MIGRATIONS } from "./store";

const ORIGINS: Record<string, Origin> = {
  bot: { author: "Commute Bot", botId: "bot_1", threadId: "thr_bot", projectId: "proj_1", channelId: "room_1", channelName: "command-center" },
  plain: { author: "Morning research", botId: null, threadId: "thr_plain", projectId: "proj_1", channelId: null, channelName: null },
};

function setup(options: { mode?: NotifyMode } = {}) {
  let at = 1_000_000;
  const advance = (ms: number) => (at += ms);
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  const store = new FeedStore(db);
  const events: RealtimeEvent[] = [];
  const notifications: Notification[] = [];
  const service = new FeedService({
    store,
    publish: (event) => events.push(event),
    notify: async (notification) => {
      notifications.push(notification);
    },
    notifyMode: () => options.mode ?? "urgent",
    log: { warn: () => {} },
    now: () => at,
  });
  const post = (title: string, extra: { body?: string; topic?: string; story?: string; priority?: Priority; from?: keyof typeof ORIGINS } = {}) =>
    service.create({
      title,
      body: extra.body ?? "",
      topic: extra.topic ?? null,
      story: extra.story ?? null,
      priority: extra.priority ?? "normal",
      origin: ORIGINS[extra.from ?? "plain"]!,
    });
  return { service, store, events, notifications, advance, post };
}

const CLEARED = { body: "Delays cleared at 8:10.", topic: "Commute", story: "harlem-line" };

describe("FeedService", () => {
  it("publishes a post and says so", async () => {
    const { store, events, post } = setup();
    const row = await post("Harlem Line delays cleared", CLEARED);
    expect(row).toMatchObject({ title: "Harlem Line delays cleared", body: "Delays cleared at 8:10.", author: "Morning research", story: "harlem-line" });
    expect(store.list().rows).toHaveLength(1);
    expect(events).toEqual([{ type: "post", postId: row.id, story: "harlem-line" }]);
  });

  it("lists a story once, by its newest post, with its count", async () => {
    const { store, advance, post } = setup();
    await post("Harlem Line delays cleared", CLEARED);
    advance(1000);
    await post("Harlem Line delays are back", { story: "harlem-line" });
    advance(1000);
    await post("Rain this afternoon");
    expect(store.list().rows.map((row) => [row.title, row.story_posts])).toEqual([
      ["Rain this afternoon", 1],
      ["Harlem Line delays are back", 2],
    ]);
    expect(store.story("harlem-line").map((row) => row.title)).toEqual(["Harlem Line delays cleared", "Harlem Line delays are back"]);
  });

  it("notifies urgent posts by default, and story updates with all", async () => {
    const urgent = setup();
    await urgent.post("Harlem Line delays cleared", CLEARED);
    await urgent.post("Building alarm", { body: "Fire alarm.", priority: "urgent", from: "bot" });
    expect(urgent.notifications.map((item) => item.title)).toEqual(["Building alarm"]);
    expect(urgent.notifications[0]).toMatchObject({ projectId: "proj_1", threadId: "thr_bot", body: "Commute Bot in #command-center · Fire alarm." });

    const all = setup({ mode: "all" });
    await all.post("Harlem Line delays cleared", CLEARED);
    await all.post("Delays are back", { body: "Back.", story: "harlem-line" });
    expect(all.notifications.map((item) => item.body)).toEqual(["Morning research · Delays cleared at 8:10.", "Update · Morning research · Back."]);
    expect(all.notifications[1]?.coalesceKey).toBe("feed:harlem-line");

    const off = setup({ mode: "off" });
    await off.post("Alarm", { priority: "urgent" });
    expect(off.notifications).toHaveLength(0);
  });

  it("edits, resolves and removes posts", async () => {
    const { service, store, events, post } = setup();
    const row = await post("Harlem Line delays cleared", CLEARED);
    const edited = service.edit(row.id, { title: "Delays cleared", resolved: true }, "thr_editor");
    expect(edited).toMatchObject({ title: "Delays cleared", edited_by: "thr_editor" });
    expect(edited?.resolved_at).not.toBeNull();
    expect(service.edit(row.id, { resolved: false }, "you")?.resolved_at).toBeNull();
    expect(service.remove(row.id)).toBe(true);
    expect(store.get(row.id)).toBeNull();
    expect(events.at(-1)).toEqual({ type: "removed", postId: row.id });
  });

  it("counts unread stories since the read mark", async () => {
    const { service, store, advance, post } = setup();
    await post("Harlem Line delays cleared", CLEARED);
    advance(10);
    service.seen();
    advance(10);
    await post("Update", { story: "harlem-line" });
    await post("Other");
    expect(store.countSince(store.lastSeenAt())).toBe(2);
  });

  it("reads a story at once, and marks everything read", async () => {
    const { service, store, events, post } = setup();
    const first = await post("Harlem Line delays cleared", CLEARED);
    const update = await post("Update", { story: "harlem-line" });
    await post("Other");
    expect(store.unreadCount()).toBe(2);
    expect(service.markRead(update.id, true)?.read_at).not.toBeNull();
    expect(store.get(first.id)?.read_at).not.toBeNull();
    expect(events.at(-1)).toEqual({ type: "seen" });
    expect(store.unreadCount()).toBe(1);
    expect(store.list({ unread: true }).rows.map((row) => row.title)).toEqual(["Other"]);
    service.markRead(first.id, false);
    expect(store.unreadCount()).toBe(2);
    service.seen();
    expect(store.unreadCount()).toBe(0);
  });

  it("filters by topic and words", async () => {
    const { store, post } = setup();
    await post("Harlem Line delays cleared", CLEARED);
    await post("Rain", { body: "Rain at 3.", topic: "Weather" });
    expect(store.list({ topic: "commute" }).rows.map((row) => row.title)).toEqual(["Harlem Line delays cleared"]);
    expect(store.list({ query: "rain" }).rows.map((row) => row.title)).toEqual(["Rain"]);
    expect(store.topics()).toEqual([
      { topic: "Commute", posts: 1 },
      { topic: "Weather", posts: 1 },
    ]);
  });
});
