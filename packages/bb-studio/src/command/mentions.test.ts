import { test } from "vitest";
import assert from "node:assert/strict";
import { matchingBroadcastMentions, broadcastMentionText, matchingSpaceThreads, spaceThreadMentionId } from "./mentions";

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

test("Space threads answer a bare @ lead first, and filter by title", () => {
  const threads = [
    { id: "lead", title: "Plan the launch", parentThreadId: null, status: "idle" },
    { id: "fix", title: "Review the space sidebar", parentThreadId: null, status: "active" },
    { id: "atlas", title: "Inbox sweep", parentThreadId: null, status: "idle" },
    { id: "fork", title: "Review the space sidebar (fork)", parentThreadId: "fix", status: "idle" },
  ];
  assert.deepEqual(matchingSpaceThreads(threads, "lead", "").map(t => [t.id, t.subtitle, t.icon]), [
    ["lead", "Lead", "MessageSquare"], ["fix", "Working", "MessageSquare"], ["atlas", "Thread", "MessageSquare"],
  ]);
  assert.deepEqual(matchingSpaceThreads(threads, "lead", "REVIEW").map(t => t.id), ["fix"]);
  assert.deepEqual(matchingSpaceThreads(threads, "lead", "Inbox").map(t => t.id), ["atlas"]);
});

test("picked Space threads carry their thread ID", () => {
  assert.equal(spaceThreadMentionId("space-threads:thr_1"), "thr_1");
  assert.equal(spaceThreadMentionId("space-threads:"), null);
  assert.equal(spaceThreadMentionId("bots:thr_1"), null);
});

test("aliases are single letters that stick to their threads, and new threads take the first unused one", async () => {
  const { assignAliases, typedAliases } = await import("./mentions");
  const first = assignAliases({ aliases: {}, released: [] }, ["lead", "fix", "inbox"]);
  assert.deepEqual(first, { aliases: { lead: "a", fix: "b", inbox: "c" }, released: [] });
  // fix leaves; inbox keeps c, and a new thread takes d, not fix's b.
  const second = assignAliases(first, ["lead", "inbox", "new"]);
  assert.deepEqual(second, { aliases: { lead: "a", inbox: "c", new: "d" }, released: ["b"] });
  const many = assignAliases({ aliases: {}, released: [] }, Array.from({ length: 28 }, (_, i) => `t${i}`));
  assert.equal(many.aliases.t25, "z");
  assert.equal(many.aliases.t26, "a2");
  assert.deepEqual(typedAliases("@b fix this, and @C too. Not me@d or @all or @bb"), ["b", "c"]);
});

test("a released letter comes back only once every other letter is in use, oldest first", async () => {
  const { assignAliases } = await import("./mentions");
  const ids = Array.from({ length: 26 }, (_, i) => `t${i}`);
  const full = assignAliases({ aliases: {}, released: [] }, ids);
  // t1 (b) leaves, then t0 (a).
  const gone = assignAliases(assignAliases(full, ids.filter(id => id !== "t1")), ids.slice(2));
  assert.deepEqual(gone.released, ["b", "a"]);
  const next = assignAliases(gone, [...ids.slice(2), "n1", "n2", "n3"]);
  assert.deepEqual([next.aliases.n1, next.aliases.n2, next.aliases.n3], ["b", "a", "a2"]);
  assert.deepEqual(next.released, []);
});

test("archived members keep their letter without taking a new one, and old stored aliases still read", async () => {
  const { assignAliases, aliasState } = await import("./mentions");
  const state = aliasState({ lead: "a", fix: "b" });
  assert.deepEqual(state, { aliases: { lead: "a", fix: "b" }, released: [] });
  assert.deepEqual(assignAliases(state, ["lead"], ["fix", "never"]), { aliases: { lead: "a", fix: "b" }, released: [] });
});

test("a typed alias finds its thread first in the mention menu", () => {
  const threads = [
    { id: "lead", title: "Plan the launch", parentThreadId: null, status: "idle", alias: "a" },
    { id: "fix", title: "Fix a bug", parentThreadId: null, status: "active", alias: "b" },
  ];
  assert.deepEqual(matchingSpaceThreads(threads, "lead", "b").map(t => [t.id, t.subtitle]), [["fix", "@b · Working"]]);
  // "a" is lead's alias and also in "Plan the launch" and "Fix a bug": the alias wins.
  assert.deepEqual(matchingSpaceThreads(threads, "lead", "a").map(t => t.id), ["lead", "fix"]);
});
