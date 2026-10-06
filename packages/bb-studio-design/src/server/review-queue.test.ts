import { describe, expect, it, vi } from "vitest";
import { ReviewQueue, type ReviewDeps, type ReviewResult } from "./review-queue";

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
    expect(deps.report).toHaveBeenCalledWith("dsn_a", request(), "- 1a overflows");
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
