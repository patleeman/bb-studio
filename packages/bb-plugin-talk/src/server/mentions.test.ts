import { describe, expect, it } from "vitest";
import type { Recording } from "../shared/contract";
import { MENTION_TRANSCRIPT_CHARS, mentionContext, mentionSubtitle } from "./mentions";

const recording: Recording = {
  id: "rec_dddddddddddddddd",
  title: "Design review",
  titleSource: "auto",
  kind: "recording",
  status: "done",
  projectId: null,
  threadId: null,
  createdAt: Date.UTC(2026, 8, 28, 15, 0),
  updatedAt: 0,
  endedAt: null,
  durationMs: 3_725_000,
  segmentCount: 100,
  pendingCount: 0,
  failedCount: 0,
  wordCount: 9000,
  preview: "",
  archived: false,
};

describe("mentions", () => {
  it("summarizes a recording for the menu", () => {
    expect(mentionSubtitle(recording)).toBe("Sep 28 · 1 hr 2 min");
    expect(mentionSubtitle({ ...recording, status: "recording" })).toMatch(/recording now$/);
  });

  it("gives agents the link and transcript, pointing at the CLI past the budget", () => {
    const short = mentionContext(recording, "We agreed to ship.");
    expect(short).toContain("/plugins/talk/recordings/rec_dddddddddddddddd");
    expect(short).toMatch(/Transcript:\nWe agreed to ship\.$/);
    const long = mentionContext({ ...recording, pendingCount: 2 }, "a".repeat(MENTION_TRANSCRIPT_CHARS + 10));
    expect(long).toContain("2 segment(s) still transcribing");
    expect(long).toContain(`bb talk transcript rec_dddddddddddddddd --offset ${MENTION_TRANSCRIPT_CHARS}`);
  });
});
