// @vitest-environment jsdom

import { buildTimelineViewRows } from "@bb/thread-view";
import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import {
  commandRow,
  conversationRow,
  systemRow,
} from "@/test/fixtures/thread-timeline-rows";
import { buildTimelineRowsListItems } from "./ThreadTimelineRows";

const DIVIDER = "__divider__";

function sequence(rows: TimelineRow[], cutoffAt: number): string[] {
  return buildTimelineRowsListItems({
    rows: buildTimelineViewRows(rows),
    scopeActive: false,
    unreadDividerPlacement: { cutoffAt },
  }).map((item) => {
    if (item.kind !== "row") return DIVIDER;
    if (item.row.kind === "conversation") return item.row.role;
    if (item.row.kind === "system" && item.row.systemKind === "operation") {
      return item.row.operationKind ?? "operation";
    }
    return item.row.kind;
  });
}

function user(at: number, turnId = "turn-1"): TimelineRow {
  return conversationRow({
    id: `user-${at}`,
    seq: at,
    role: "user",
    text: "PROMPT",
    createdAt: at,
    startedAt: at,
    turnId,
  });
}

function assistant(at: number, turnId = "turn-1"): TimelineRow {
  return conversationRow({
    id: `assistant-${at}`,
    seq: at,
    role: "assistant",
    text: "ANSWER",
    createdAt: at,
    startedAt: at,
    turnId,
  });
}

function thought(at: number, turnId = "turn-1"): TimelineRow {
  return systemRow({
    id: `thought-${at}`,
    seq: at,
    createdAt: at,
    startedAt: at,
    completedAt: at + 50,
    operationKind: "reasoning",
    title: "Thought",
    detail: "Thinking about the answer",
    turnId,
  });
}

function command(at: number, turnId = "turn-1"): TimelineRow {
  return commandRow({
    id: `command-${at}`,
    seq: at,
    command: `echo ${at}`,
    createdAt: at,
    startedAt: at,
    turnId,
  });
}

describe("the NEW divider on opening a conversation", () => {
  it("sits above the Thought row, not between it and its reply", () => {
    expect(sequence([user(100), thought(200), assistant(300)], 100)).toEqual([
      "user",
      DIVIDER,
      "reasoning",
      "assistant",
    ]);
  });

  it("sits above the turn's tool rows too", () => {
    expect(
      sequence([user(100), thought(150), command(200), assistant(300)], 100),
    ).toEqual(["user", DIVIDER, "step-summary", "assistant"]);
  });

  it("keeps the rows the reader already saw above it", () => {
    expect(
      sequence([user(100), thought(150), command(200), assistant(300)], 160),
    ).toEqual(["user", "step-summary", DIVIDER, "assistant"]);
  });

  it("does not reach into an earlier turn", () => {
    expect(
      sequence(
        [
          user(100, "turn-1"),
          assistant(150, "turn-1"),
          user(200, "turn-2"),
          thought(250, "turn-2"),
          assistant(300, "turn-2"),
        ],
        120,
      ),
    ).toEqual(["user", DIVIDER, "assistant", "user", "reasoning", "assistant"]);
  });
});
