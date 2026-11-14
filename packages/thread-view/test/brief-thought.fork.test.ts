import { describe, expect, it } from "vitest";
import {
  createTimelineEventFactory,
  renderTimelineFixture,
} from "./timeline-test-harness.js";
import { isBriefThought } from "../src/brief-thought.fork.js";
import type { EventProjectionOperationMessage } from "../src/event-projection-message.js";

function render(thoughtMs: number) {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  return renderTimelineFixture({
    events: [
      event.turnStarted({ createdAt: 0 }),
      event.reasoningStarted({ createdAt: 1_000, itemId: "reasoning-1" }),
      event.reasoningDelta({
        createdAt: 1_000,
        delta: "Thinking about the reply.",
        itemId: "reasoning-1",
      }),
      event.reasoningCompleted({
        createdAt: 1_000 + thoughtMs,
        itemId: "reasoning-1",
        text: "Thought about the reply.",
      }),
      event.turnCompleted({ createdAt: 20_000 }),
    ],
    projectionOptions: {
      threadStatus: "idle",
      turnMessageDetail: "full",
    },
  });
}

describe("a brief Thought row", () => {
  it("is left out when the model thought for less than two seconds", () => {
    expect(render(0).text).not.toContain("Thought");
    expect(render(1_500).text).not.toContain("Thought");
  });

  it("stays when the model thought for two seconds or more", () => {
    expect(render(3_000).text).toContain("Thought");
  });

  it("is never hidden while the model is still thinking, or when Stop cut it short", () => {
    const thinking = {
      kind: "operation",
      opType: "reasoning",
      status: "pending",
      startedAt: 1_000,
      completedAt: null,
    } as unknown as EventProjectionOperationMessage;
    expect(isBriefThought(thinking)).toBe(false);
    expect(
      isBriefThought({ ...thinking, status: "completed", completedAt: 1_200 }),
    ).toBe(true);
    expect(
      isBriefThought({ ...thinking, status: "interrupted", completedAt: 1_200 }),
    ).toBe(false);
  });
});
