import test from "node:test";
import assert from "node:assert/strict";
import { railLive, railRoutingCount } from "../channel-rail";
import { jobSchema, runSchema, type Job } from "../contract";

const botId = (n: number) => `bot_${String(n).repeat(16).slice(0, 16)}`;

const job = (overrides: Record<string, unknown> = {}): Job =>
  jobSchema.parse({
    id: "job",
    botId: botId(1),
    conversationKey: "group:room",
    threadId: "thr_1",
    text: "Do the thing",
    status: "running",
    reply: null,
    error: null,
    createdAt: 100,
    updatedAt: 100,
    startedAt: 1000,
    roomId: "room",
    runId: null,
    ...overrides,
  });

const run = (overrides: Record<string, unknown> = {}) =>
  runSchema.parse({
    id: "run",
    roomId: "room",
    status: "running",
    round: 0,
    remaining: [],
    next: [],
    jobId: null,
    createdAt: 0,
    error: null,
    ...overrides,
  });

test("live entries carry the activity, elapsed start, and the queue behind them", () => {
  const entries = railLive([
    job({ id: "head", activitySnippet: "Reading store.ts" }),
    job({ id: "behind", status: "queued", startedAt: null, createdAt: 200 }),
  ]);
  assert.equal(entries.length, 1);
  assert.deepEqual(
    {
      jobId: entries[0]!.jobId,
      running: entries[0]!.running,
      startedAt: entries[0]!.startedAt,
      queuedBehind: entries[0]!.queuedBehind,
      stoppable: entries[0]!.stoppable,
    },
    {
      jobId: "head",
      running: true,
      startedAt: 1000,
      queuedBehind: 1,
      stoppable: true,
    },
  );
  assert.equal(entries[0]!.activity, "Reading store.ts");
});

test("a job already stopping is not stoppable again", () => {
  const [entry] = railLive([job({ cancellationPending: true })]);
  assert.equal(entry!.stoppable, false);
  assert.equal(entry!.activity, "Stopping…");
});

test("dispatching jobs fall back to the dispatch start for elapsed time", () => {
  const [entry] = railLive([
    job({ status: "dispatching", startedAt: null, dispatchStartedAt: 500 }),
  ]);
  assert.equal(entry!.startedAt, 500);
  assert.equal(entry!.running, false);
});

test("routing counts only runs still choosing recipients", () => {
  assert.equal(
    railRoutingCount([
      run({ id: "a", routing: "pending" }),
      run({ id: "b", routing: "pending", status: "done" }),
      run({ id: "c", routing: "done" }),
      run({ id: "d" }),
    ]),
    1,
  );
});
