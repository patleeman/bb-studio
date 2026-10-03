import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { rpcContract } from "../modules/feed/src/contract";
import { FeedService, view } from "../modules/feed/src/service";
import { FeedStore, MIGRATIONS } from "../modules/feed/src/store";
import { ModuleServices } from "../modules/services";
import { Inbox } from "./inbox";
import { moduleInboxSources } from "./module-sources";

it("projects real Feed story revisions through the validated module service into Inbox", async () => {
  const feedDb = new Database(":memory:"), officeDb = new Database(":memory:");
  vi.useFakeTimers(); vi.setSystemTime(1000);
  try {
    for (const sql of MIGRATIONS) feedDb.exec(sql);
    const store = new FeedStore(feedDb);
    const service = new FeedService({ store, publish: () => {}, notify: async () => {}, notifyMode: () => "off", log: { warn: () => {} } });
    const modules = new ModuleServices();
    modules.register("feed", { list: rpcContract.list }, { list: input => {
      const page = store.list(input);
      return { posts: page.rows.map(row => view(row)), nextCursor: page.nextCursor, lastSeenAt: 0 };
    } });
    const inbox = new Inbox(officeDb, moduleInboxSources(modules), p => p === "work" ? "space-work" : "personal");
    const post = (title: string) => service.create({ title, body: "Result", topic: null, story: "standing-duty", priority: "urgent", origin: {
      author: "Bot", botId: "bot_1", threadId: "thr_1", projectId: "work", channelId: null, channelName: null,
    } });
    await post("First report");
    expect(await inbox.counts(["space-work"])).toEqual({ bySpace: { "space-work": { requests: 0, unreadReports: 1 } } });
    const key = "feed:story:standing-duty";
    inbox.mark([key], "read"); inbox.mark([key], "done");
    expect((await inbox.list({ spaceId: "all" })).events).toEqual([]);
    vi.setSystemTime(2000);
    const latest = await post("Updated report");
    expect((await inbox.list({ spaceId: "space-work" })).events).toMatchObject([{ key, title: "Updated report", urgent: true, readAt: null, doneAt: null, botId: "bot_1" }]);
    service.edit(latest.id, { resolved: true }, "you");
    expect((await inbox.list({ spaceId: "all" })).events).toEqual([]);
  } finally { vi.useRealTimers(); feedDb.close(); officeDb.close(); }
});
