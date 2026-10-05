import { test } from "vitest";
import assert from "node:assert/strict";
import { matchingBroadcastMentions, broadcastMentionText, matchingSpaceThreads, spaceThreadMentionId } from "../mentions";

test("broadcast completion offers all, and resolves the everyone alias", () => {
  assert.deepEqual(matchingBroadcastMentions(""), [{ handle: "all" }]);
  assert.deepEqual(matchingBroadcastMentions("AL"), [{ handle: "all" }]);
  assert.deepEqual(matchingBroadcastMentions("every"), [{ handle: "everyone" }]);
  assert.deepEqual(matchingBroadcastMentions("atlas"), []);
});

test("picked broadcast mentions keep their @ when converted to sent text", () => {
  assert.equal(broadcastMentionText("broadcasts:all"), "@all");
  assert.equal(broadcastMentionText("broadcasts:everyone"), "@everyone");
  assert.equal(broadcastMentionText("broadcasts:channel"), null);
  assert.equal(broadcastMentionText("bots:all"), null);
  assert.equal(broadcastMentionText("broadcasts:all-guide"), null);
});

test("Space threads answer a bare @ lead first, and filter by title or bot", () => {
  const threads = [
    { id: "lead", title: "Plan the launch", botId: null, parentThreadId: null, status: "idle" },
    { id: "fix", title: "Review the space sidebar", botId: null, parentThreadId: null, status: "active" },
    { id: "atlas", title: "Inbox sweep", botId: "b1", parentThreadId: null, status: "idle" },
    { id: "fork", title: "Review the space sidebar (fork)", botId: null, parentThreadId: "fix", status: "idle" },
  ];
  const name = (botId: string) => botId === "b1" ? "Atlas" : null;
  assert.deepEqual(matchingSpaceThreads(threads, "lead", name, "").map(t => [t.id, t.subtitle, t.icon]), [
    ["lead", "Lead", "MessageSquare"], ["fix", "Working", "MessageSquare"], ["atlas", "Atlas", "Bot"],
  ]);
  assert.deepEqual(matchingSpaceThreads(threads, "lead", name, "REVIEW").map(t => t.id), ["fix"]);
  assert.deepEqual(matchingSpaceThreads(threads, "lead", name, "atl").map(t => t.id), ["atlas"]);
});

test("picked Space threads carry their thread ID", () => {
  assert.equal(spaceThreadMentionId("space-threads:thr_1"), "thr_1");
  assert.equal(spaceThreadMentionId("space-threads:"), null);
  assert.equal(spaceThreadMentionId("bots:thr_1"), null);
});
