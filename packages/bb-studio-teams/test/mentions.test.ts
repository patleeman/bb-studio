import { test } from "vitest";
import assert from "node:assert/strict";
import { matchingBroadcastMentions, broadcastMentionText } from "../mentions";

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
