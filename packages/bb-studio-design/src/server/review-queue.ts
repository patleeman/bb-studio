// Which reviews run, and what the canvas shows about them. The plugin hands
// in how to run a reviewer and how to report; this keeps the latest review
// per design in memory (a restart forgets it) and makes sure nothing touches
// storage or the change feed once the plugin is disposed or the design is gone.
import type { ReviewState } from "./review";

export type ReviewRequest = { screenIds: string[]; requesterThreadId: string };
export type ReviewResult = { verdict: "done" } | { verdict: "needs_work"; findings: string };

export type ReviewDeps = {
  /** Runs one reviewer and returns its verdict; throws when the review fails. */
  run(designId: string, request: ReviewRequest, signal: AbortSignal): Promise<ReviewResult>;
  /** Announces a design's new review state (bumps it so open canvases refetch). */
  publish(designId: string, review: ReviewState): void;
  /** Posts the findings to the design's thread. */
  report(designId: string, request: ReviewRequest, findings: string): Promise<void>;
  warn(message: string): void;
  now?(): number;
};

export type RequestOutcome = "started" | "queued" | "disposed";

function roundOf(screenIds: string[]): number | null {
  return screenIds.length ? Number(screenIds[0]!.slice(0, -1)) : null;
}

export class ReviewQueue {
  private readonly states = new Map<string, ReviewState>();
  private readonly running = new Map<string, Promise<void>>();
  /** One follow-up per design, asked for while a review ran; the latest call wins. */
  private readonly queued = new Map<string, ReviewRequest>();
  /** Bumped when a design is deleted, so a review still running for it stays quiet. */
  private readonly generations = new Map<string, number>();
  private readonly disposed = new AbortController();

  constructor(private readonly deps: ReviewDeps) {}

  /** The design's latest review, while it's remembered. */
  state(designId: string): ReviewState | null {
    return this.states.get(designId) ?? null;
  }

  request(designId: string, request: ReviewRequest): RequestOutcome {
    if (this.disposed.signal.aborted) return "disposed";
    if (this.running.has(designId)) {
      this.queued.set(designId, request);
      return "queued";
    }
    this.start(designId, request);
    return "started";
  }

  /** The design was deleted: forget its reviews, and ignore one still running. */
  forget(designId: string): void {
    this.states.delete(designId);
    this.queued.delete(designId);
    this.generations.set(designId, (this.generations.get(designId) ?? 0) + 1);
  }

  dispose(): void {
    this.disposed.abort();
  }

  /** Resolves once the design's running review has settled. */
  async settled(designId: string): Promise<void> {
    while (this.running.has(designId)) await this.running.get(designId);
  }

  private start(designId: string, request: ReviewRequest): void {
    const task = this.runOne(designId, request).finally(() => {
      this.running.delete(designId);
      // The screens changed while it ran: review their latest state once more.
      const next = this.queued.get(designId);
      this.queued.delete(designId);
      if (next && !this.disposed.signal.aborted) this.start(designId, next);
    });
    this.running.set(designId, task);
  }

  private set(designId: string, review: Omit<ReviewState, "at">): void {
    this.states.set(designId, { ...review, at: (this.deps.now ?? Date.now)() });
    this.deps.publish(designId, this.states.get(designId)!);
  }

  private async runOne(designId: string, request: ReviewRequest): Promise<void> {
    const generation = this.generations.get(designId) ?? 0;
    const live = () => !this.disposed.signal.aborted && (this.generations.get(designId) ?? 0) === generation;
    const base = { round: roundOf(request.screenIds), screens: request.screenIds };
    this.set(designId, { ...base, state: "reviewing", summary: null });
    try {
      const result = await this.deps.run(designId, request, this.disposed.signal);
      if (!live()) return;
      if (result.verdict === "done") {
        this.set(designId, { ...base, state: "done", summary: null });
        return;
      }
      this.set(designId, { ...base, state: "needs_work", summary: result.findings || null });
      await this.deps.report(designId, request, result.findings);
    } catch (error) {
      if (!live()) return;
      const message = error instanceof Error ? error.message : String(error);
      this.deps.warn(`review of ${designId} failed: ${message}`);
      this.set(designId, { ...base, state: "failed", summary: message });
    }
  }
}
