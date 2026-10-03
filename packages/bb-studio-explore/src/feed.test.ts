import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { digestPost, exploreFeed, replyFindings } from "./feed";
import { ExploreStore, MIGRATIONS } from "./store";

function setup(at: Date, digestHour?: () => number) {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  let now = at.getTime();
  const store = new ExploreStore(db, () => now);
  const calls: { method: string; input: Record<string, unknown> }[] = [];
  const pages = new Map<string, { pageId: string; href: string }>();
  const feed = exploreFeed({
    store,
    callRpc: async (_pluginId, method, input) => {
      calls.push({ method, input: input as Record<string, unknown> });
      return { post: { id: `post_${calls.length}` } } as never;
    },
    explainerPage: (finding) => pages.get(finding.key) ?? null,
    projectName: async (projectId) => (projectId === "proj_1" ? "bb-studio" : null),
    now: () => now,
    digestHour,
  });
  const finding = (label: string, emoji = "🏗️", projectId: string | null = "proj_1") =>
    store.addFinding({ threadId: "thr_1", messageId: "msg_1", turnId: null, emoji, label, projectId, threadTitle: "Fix the [queue]" });
  return { store, feed, calls, pages, finding, advance: (ms: number) => (now += ms) };
}

describe("Explore and the Feed", () => {
  it("uses the saved digest hour, including midnight, without reposting that day", async () => {
    let hour = 21;
    const { feed, finding, advance, calls } = setup(new Date(2026, 9, 1, 19), () => hour);
    finding("A late digest");
    expect(await feed.digest()).toBe(0);
    hour = 19;
    expect(await feed.digest()).toBe(1);
    hour = 0;
    expect(await feed.digest()).toBe(0);
    advance(5 * 3_600_000);
    finding("A midnight digest");
    expect(await feed.digest()).toBe(1);
    expect(calls).toHaveLength(2);
  });
  it("reads the findings line a reply ends with", () => {
    expect(replyFindings('Answer.\n\n::explore{items="🐛 Retry delay is off|🏗️ How the queue works"}')).toEqual([
      { emoji: "🐛", label: "Retry delay is off" },
      { emoji: "🏗️", label: "How the queue works" },
    ]);
    expect(replyFindings("No findings.")).toEqual([]);
  });

  it("saves a finding once, then links its explainer", async () => {
    const { feed, calls, pages, finding, store } = setup(new Date(2026, 9, 1, 12));
    const row = finding("How the queue works");
    expect(store.addFinding({ threadId: "thr_1", messageId: "msg_1", turnId: null, emoji: "🏗️", label: "how the  queue works", projectId: null, threadTitle: "" }).id).toBe(row.id);
    expect(await feed.save(row)).toBe("post_1");
    expect(calls[0]).toMatchObject({ method: "publish", input: { title: "How the queue works", topic: "Follow-ups", story: `explore-${row.id}`, threadId: "thr_1" } });
    expect(calls[0]!.input.body).toBe("🏗️ Noticed in [Fix the queue](/threads/thr_1).");

    pages.set(row.key, { pageId: "pg_1", href: "/plugins/pages/pages/pg_1" });
    await feed.explainerChanged(row.key);
    expect(calls[1]).toMatchObject({ method: "edit", input: { postId: "post_1" } });
    expect(calls[1]!.input.body).toContain("Explainer: [How the queue works](/plugins/pages/pages/pg_1)");
    await feed.explainerChanged(row.key);
    expect(calls).toHaveLength(2);
  });

  it("posts a digest per project once a day, in the evening, bugs first", async () => {
    const { feed, calls, finding, advance, store } = setup(new Date(2026, 9, 1, 12));
    finding("How the queue works");
    finding("Delay cap mixes units", "🐛");
    finding("Elsewhere", "🔗", null);
    const saved = finding("Saved already");
    store.setFindingPost(saved.id, "post_x", null);
    expect(await feed.digest()).toBe(0);
    advance(7 * 3_600_000);
    expect(await feed.digest()).toBe(2);
    expect(calls.map((call) => call.input.title)).toEqual(["Noticed along the way: 2 findings in bb-studio", "Noticed along the way: 1 finding"]);
    expect(String(calls[0]!.input.body).split("\n")[0]).toBe("- 🐛 Delay cap mixes units · [Fix the queue](/threads/thr_1)");
    expect(await feed.digest()).toBe(0);
    advance(86_400_000);
    expect(await feed.digest()).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it("counts what doesn't fit in a digest", () => {
    const rows = Array.from({ length: 14 }, (_, index) => ({ emoji: "🔗", label: `Finding ${index}`, thread_id: "thr_1", thread_title: "T" }));
    const { body } = digestPost(rows as never, null);
    expect(body).toContain("- …and 2 more");
  });
});
