import { expect, it } from "vitest";
import { hitDocument } from "./launcher/documents";
import { newTabRecents } from "./newtab";
import { isReplyTitle, shownThreadTitle } from "./reply-title";

it("names a reply thread after the conversation it replies in", () => {
  expect(shownThreadTitle("Main · thread")).toBe("Reply in Main");
  expect(shownThreadTitle("  Lisbon trip planning · thread ")).toBe("Reply in Lisbon trip planning");
  expect(shownThreadTitle("Lisbon trip planning")).toBe("Lisbon trip planning");
  expect(shownThreadTitle(" · thread")).toBe("· thread");
  expect(isReplyTitle("Main · thread")).toBe(true);
  expect(isReplyTitle("Main · fork")).toBe(false);
});

it("shows replies as Reply in <conversation> in Recent, and leaves other kinds' titles alone", async () => {
  const entries = await newTabRecents({
    items: () => [{ id: "pg_plan", title: "Notes · thread", updatedAt: 300 }],
    botThreads: async () => [
      { threadId: "thr_reply", kind: "conversation" as const, title: "Main · thread", updatedAt: 200 },
      { threadId: "thr_main", kind: "conversation" as const, title: "Main", updatedAt: 100 },
    ],
    boards: async () => [],
    bots: () => [],
  }, { threadId: null, limit: 10 });
  expect(entries.map((entry) => [entry.title, entry.kind])).toEqual([
    ["Notes · thread", "Page"],
    ["Reply in Main", "Conversation"],
    ["Main", "Conversation"],
  ]);
});

it("shows a reply found by Quick Open's search as Reply in <conversation>", () => {
  const hit = (kind: string, title: string) => hitDocument({ ref: { pluginId: "bb", id: "thr_reply" }, kind, title, href: "/threads/thr_reply", updatedAt: 1 }, true);
  expect(hit("thread", "Main · thread")?.title).toBe("Reply in Main");
  expect(hit("thread", "Main")?.title).toBe("Main");
});
