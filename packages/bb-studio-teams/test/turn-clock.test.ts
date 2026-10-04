import { test } from "vitest";
import assert from "node:assert/strict";
import { advanceTurnClock, CLOCK_GAP_MS } from "../turn-clock";

test("the turn clock counts from the start, then only the gaps it watched", () => {
  const start = { startedAt: 1_000, dispatchStartedAt: 500, updatedAt: 0 };
  assert.deepEqual(advanceTurnClock(start, 4_000), { turnMs: 3_000, clockAt: 4_000 });
  const ticking = { ...start, turnMs: 3_000, clockAt: 4_000 };
  assert.deepEqual(advanceTurnClock(ticking, 5_500), { turnMs: 4_500, clockAt: 5_500 });
  // Asleep, or the host was gone: the gap is skipped.
  assert.deepEqual(advanceTurnClock(ticking, 4_000 + CLOCK_GAP_MS + 1), { turnMs: 3_000, clockAt: 4_000 + CLOCK_GAP_MS + 1 });
  // A clock that went backwards doesn't take time away.
  assert.deepEqual(advanceTurnClock(ticking, 3_000), { turnMs: 3_000, clockAt: 3_000 });
});
