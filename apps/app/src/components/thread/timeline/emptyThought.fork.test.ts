// @vitest-environment jsdom

import { buildTimelineViewRows } from "@bb/thread-view";
import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import { conversationRow, systemRow } from "@/test/fixtures/thread-timeline-rows";
import { buildTimelineRowsListItems } from "./ThreadTimelineRows";

function thought(
  id: string,
  detail: string,
  extra: Record<string, unknown> = {},
): TimelineRow {
  return {
    ...systemRow({
      id,
      seq: 200,
      createdAt: 200,
      startedAt: 200,
      completedAt: 200,
      operationKind: "reasoning",
      title: "Thought",
      detail,
      turnId: "turn-1",
    }),
    ...extra,
  } as TimelineRow;
}

function shownIds(rows: TimelineRow[]): string[] {
  return buildTimelineRowsListItems({
    rows: buildTimelineViewRows(rows),
    scopeActive: false,
    unreadDividerPlacement: null,
  }).flatMap((item) => (item.kind === "row" ? [item.row.id] : []));
}

const user = conversationRow({
  id: "user",
  seq: 100,
  role: "user",
  text: "PROMPT",
  createdAt: 100,
  startedAt: 100,
  turnId: "turn-1",
});
const reply = conversationRow({
  id: "reply",
  seq: 300,
  role: "assistant",
  text: "ANSWER",
  createdAt: 300,
  startedAt: 300,
  turnId: "turn-1",
});

describe("Thought rows", () => {
  it("keeps a thought with text, even one that arrived in one batch with no duration", () => {
    expect(shownIds([user, thought("t", "Checking the dates."), reply])).toContain("t");
  });

  it("leaves out a settled thought with no text", () => {
    expect(shownIds([user, thought("empty", "  \n"), reply])).not.toContain("empty");
  });

  it("keeps a thought whose text loads later or that is still running", () => {
    expect(
      shownIds([user, thought("deferred", "", { contentDeferred: true }), reply]),
    ).toContain("deferred");
    expect(
      shownIds([user, thought("pending", "", { status: "pending", completedAt: null }), reply]),
    ).toContain("pending");
  });
});
