import { getThread } from "@bb/db";
import { turnScope } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import {
  forkIdleFields,
  isQuietTurn,
} from "../../src/services/threads/quiet-turn.fork.js";
import { registerTurnClassifier } from "../../src/services/threads/turn-classifiers.fork.js";
import {
  seedEvent,
  seedThread,
  seedThreadFixture,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedFinishedTurn(harness: TestAppHarness, reply: string) {
  const { project, environment } = seedThreadFixture(harness);
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "active",
    title: "Heartbeat",
  });
  seedTurnStarted(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    turnId: "turn-1",
  });
  seedEvent(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: "provider-quiet",
    scope: turnScope("turn-1"),
    sequence: 2,
    type: "item/completed",
    data: { item: { type: "agentMessage", id: "msg-1", text: reply } },
  });
  return thread;
}

let dispose = () => {};

beforeEach(() => {
  dispose = registerTurnClassifier("test-plugin", ({ finalOutput }) => ({
    quiet: finalOutput === "[PASS]",
  }));
});

afterEach(() => dispose());

describe("quiet turns", () => {
  it("leaves the thread read when a plugin's classifier calls the turn quiet", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedFinishedTurn(harness, "[PASS]");
      const before = getThread(harness.db, thread.id)?.latestAttentionAt;
      expect(isQuietTurn(harness.db, { threadId: thread.id })).toBe(true);
      const outcome = applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.succeeded" },
        threadId: thread.id,
      });
      expect(outcome.applied).toBe(true);
      const after = getThread(harness.db, thread.id);
      expect(after?.status).toBe("idle");
      expect(after?.latestAttentionAt).toBe(before);
      expect(forkIdleFields(harness.db, thread.id)).toEqual({
        experimental_quiet: true,
      });
    });
  });

  it("raises attention as usual for a turn that said something", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedFinishedTurn(harness, "The backup finished.");
      const before = getThread(harness.db, thread.id)?.latestAttentionAt;
      expect(isQuietTurn(harness.db, { threadId: thread.id })).toBe(false);
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.succeeded" },
        threadId: thread.id,
      });
      expect(getThread(harness.db, thread.id)?.latestAttentionAt).not.toBe(
        before,
      );
    });
  });

  it("treats every turn as ordinary when no plugin classifies turns, and ignores a classifier that throws", async () => {
    dispose();
    await withTestHarness(async (harness) => {
      const thread = seedFinishedTurn(harness, "[PASS]");
      expect(isQuietTurn(harness.db, { threadId: thread.id })).toBe(false);
      dispose = registerTurnClassifier("test-plugin", () => {
        throw new Error("broken classifier");
      });
      expect(isQuietTurn(harness.db, { threadId: thread.id })).toBe(false);
    });
  });
});
