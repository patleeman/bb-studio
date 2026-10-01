import { test } from "vitest";
import assert from "node:assert/strict";
import { channelHandoffDraft } from "../handoff-draft";

const source = { threadId: "thr_a", projectId: "proj_personal", title: "Launch plan" };

test("a channel handoff draft links its source thread, then the carried and current text", () => {
  assert.equal(
    channelHandoffDraft({ source, draft: "" }, ""),
    "Continue from [Launch plan](/threads/thr_a) (@thread:thr_a)\n\n",
  );
  assert.equal(
    channelHandoffDraft({ source: null, draft: "Review the launch post " }, "@atlas"),
    "Review the launch post\n\n@atlas\n\n",
  );
});
