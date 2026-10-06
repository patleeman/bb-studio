import { describe, expect, it, vi } from "vitest";
import { MAX_REVIEWS_IN_A_ROW, ReviewQueue, type ReviewDeps, type ReviewResult } from "./review-queue";

/** A reviewer the test finishes by hand, one run at a time. */
function harness() {
  const runs: { designId: string; screenIds: string[]; finish(result: ReviewResult | Error): void }[] = [];
  const deps = {
    run: vi.fn((designId: string, request: { screenIds: string[] }) => new Promise<ReviewResult>((resolve, reject) => {
      runs.push({ designId, screenIds: request.screenIds, finish: (result) => (result instanceof Error ? reject(result) : resolve(result)) });
    })),
    publish: vi.fn(),
    report: vi.fn(async () => {}),
    warn: vi.fn(),
    now: () => 1,
  } satisfies ReviewDeps;
  return { deps, runs, queue: new ReviewQueue(deps) };
}

const request = (screenIds = ["1a", "1b"]) => ({ screenIds, requesterThreadId: "thr_1" });

describe("the review queue", () => {
  it("reports needs work to the design's thread and remembers the state", async () => {
    const { deps, runs, queue } = harness();
    expect(queue.request("dsn_a", request())).toBe("started");
    expect(queue.state("dsn_a")).toMatchObject({ state: "reviewing", round: 1 });
    runs[0]!.finish({ verdict: "needs_work", findings: "- 1a overflows" });
    await queue.settled("dsn_a");
    expect(queue.state("dsn_a")).toMatchObject({ state: "needs_work", summary: "- 1a overflows" });
    expect(deps.report).toHaveBeenCalledWith("dsn_a", request(), "- 1a overflows", false);
  });

  it("touches nothing once disposed while a review runs", async () => {
    const { deps, runs, queue } = harness();
    queue.request("dsn_a", request());
    deps.publish.mockClear();
    queue.dispose();
    runs[0]!.finish(new Error("aborted"));
    await queue.settled("dsn_a");
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.warn).not.toHaveBeenCalled();
    expect(queue.request("dsn_a", request())).toBe("disposed");
  });

  it("forgets a deleted design and stays quiet about its running review", async () => {
    const { deps, runs, queue } = harness();
    queue.request("dsn_a", request());
    deps.publish.mockClear();
    queue.forget("dsn_a");
    expect(queue.state("dsn_a")).toBeNull();
    runs[0]!.finish({ verdict: "needs_work", findings: "- gone" });
    await queue.settled("dsn_a");
    expect(queue.state("dsn_a")).toBeNull();
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.report).not.toHaveBeenCalled();
  });
});

describe("design_ready during a running review", () => {
  it("queues one follow-up of the latest call instead of dropping it", async () => {
    const { deps, runs, queue } = harness();
    queue.request("dsn_a", request(["1a"]));
    expect(queue.request("dsn_a", request(["1a", "1b"]))).toBe("queued");
    expect(queue.request("dsn_a", request(["2a"]))).toBe("queued");
    expect(deps.run).toHaveBeenCalledTimes(1);
    runs[0]!.finish({ verdict: "done" });
    await vi.waitFor(() => expect(runs).toHaveLength(2));
    expect(runs[1]!.screenIds).toEqual(["2a"]);
    runs[1]!.finish({ verdict: "done" });
    await queue.settled("dsn_a");
    expect(deps.run).toHaveBeenCalledTimes(2);
  });

  it("drops the follow-up when the design is deleted", async () => {
    const { deps, runs, queue } = harness();
    queue.request("dsn_a", request());
    queue.request("dsn_a", request());
    queue.forget("dsn_a");
    runs[0]!.finish({ verdict: "done" });
    await queue.settled("dsn_a");
    expect(deps.run).toHaveBeenCalledTimes(1);
  });
});

describe("the automatic review cap", () => {
  async function needsWork(queue: ReviewQueue, runs: ReturnType<typeof harness>["runs"]) {
    expect(queue.request("dsn_a", request())).toBe("started");
    runs.at(-1)!.finish({ verdict: "needs_work", findings: "- still broken" });
    await queue.settled("dsn_a");
  }

  it(`pauses after ${MAX_REVIEWS_IN_A_ROW} needs-work reviews in a row and says so`, async () => {
    const { deps, runs, queue } = harness();
    for (let index = 0; index < MAX_REVIEWS_IN_A_ROW; index++) await needsWork(queue, runs);
    expect(deps.report.mock.calls.map((call) => (call as unknown[])[3])).toEqual([...Array(MAX_REVIEWS_IN_A_ROW - 1).fill(false), true]);
    expect(queue.request("dsn_a", request())).toBe("paused");
    expect(deps.run).toHaveBeenCalledTimes(MAX_REVIEWS_IN_A_ROW);
  });

  it("resumes after a user edit or when the user asks", async () => {
    const { runs, queue } = harness();
    for (let index = 0; index < MAX_REVIEWS_IN_A_ROW; index++) await needsWork(queue, runs);
    queue.userChanged("dsn_a");
    await needsWork(queue, runs);
    for (let index = 1; index < MAX_REVIEWS_IN_A_ROW; index++) await needsWork(queue, runs);
    expect(queue.request("dsn_a", request())).toBe("paused");
    expect(queue.request("dsn_a", request(), { userAsked: true })).toBe("started");
  });

  it("starts the count over when a review passes", async () => {
    const { runs, queue } = harness();
    for (let index = 1; index < MAX_REVIEWS_IN_A_ROW; index++) await needsWork(queue, runs);
    queue.request("dsn_a", request());
    runs.at(-1)!.finish({ verdict: "done" });
    await queue.settled("dsn_a");
    for (let index = 1; index < MAX_REVIEWS_IN_A_ROW; index++) await needsWork(queue, runs);
    expect(queue.paused("dsn_a")).toBe(false);
  });
});
