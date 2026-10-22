// Which reviews run, and what the canvas shows about them. The plugin hands
// in how to run a reviewer and how to report; this keeps the latest review
// per design in memory (a restart forgets it) and makes sure nothing touches
// storage or the change feed once the plugin is disposed or the design is gone.
import type { ReviewState } from "./review";

/**
 * Reviews in a row that may find problems before automatic review pauses for
 * a design. Each "needs work" wakes the agent, which fixes and asks again, so
 * without a cap a reviewer that never agrees spawns agents forever. A user
 * edit or comment, or the user asking for another review, starts the count over.
 */
export const MAX_REVIEWS_IN_A_ROW = 3;

export type ReviewRequest = { screenIds: string[]; requesterThreadId: string };
export type ReviewResult = { verdict: "done" } | { verdict: "needs_work"; findings: string };

export type ReviewDeps = {
  /** Runs one reviewer and returns its verdict; throws when the review fails. */
  run(designId: string, request: ReviewRequest, signal: AbortSignal): Promise<ReviewResult>;
  /** Announces a design's new review state (bumps it so open canvases refetch). */
  publish(designId: string, review: ReviewState | null): void;
  /** The selected screens' current stored revisions, in request order. */
  revision(designId: string, screenIds: string[]): string;
  /** Posts the findings to the design's thread; `paused` when this was the last review in a row. */
  report(designId: string, request: ReviewRequest, findings: string, paused: boolean): Promise<void>;
  warn(message: string): void;
  now?(): number;
};

export type RequestOutcome = "started" | "queued" | "paused" | "disposed";

function roundOf(screenIds: string[]): number | null {
  return screenIds.length ? Number(screenIds[0]!.slice(0, -1)) : null;
}

export class ReviewQueue {
  private readonly revisions = new Map<string, string>();
  private readonly states = new Map<string, ReviewState>();
  private readonly running = new Map<string, Promise<void>>();
  /** One follow-up per design, asked for while a review ran; the latest call wins. */
  private readonly queued = new Map<string, ReviewRequest>();
  /** Bumped when a design is deleted, so a review still running for it stays quiet. */
  private readonly generations = new Map<string, number>();
  private readonly disposed = new AbortController();
  /** "Needs work" verdicts in a row since the user last stepped in. */
  private readonly streaks = new Map<string, number>();

  constructor(private readonly deps: ReviewDeps) {}

  /** The design's latest review, while it's remembered. */
  state(designId: string): ReviewState | null {
    this.screensChanged(designId);
    return this.states.get(designId) ?? null;
  }

  /** Whether automatic review is paused for the design. */
  paused(designId: string): boolean {
    return (this.streaks.get(designId) ?? 0) >= MAX_REVIEWS_IN_A_ROW;
  }

  /** `userAsked`: the user asked for another review, which resumes a paused one. */
  request(designId: string, request: ReviewRequest, options: { userAsked?: boolean } = {}): RequestOutcome {
    if (this.disposed.signal.aborted) return "disposed";
    if (options.userAsked) this.streaks.delete(designId);
    if (this.paused(designId)) return "paused";
    if (this.running.has(designId)) {
      this.queued.set(designId, request);
      return "queued";
    }
    this.start(designId, request);
    return "started";
  }

  /** The user edited or commented on the design: reviews may run again. */
  userChanged(designId: string): void {
    this.streaks.delete(designId);
  }

  /** Screen writes invalidate verdicts without resetting the user's pause rule. */
  screensChanged(designId: string): void {
    const state = this.states.get(designId);
    if (!state || this.revisions.get(designId) === this.deps.revision(designId, state.screens)) return;
    this.states.delete(designId);
    this.revisions.delete(designId);
    this.deps.publish(designId, null);
  }

  /** The design was deleted: forget its reviews, and ignore one still running. */
  forget(designId: string): void {
    this.states.delete(designId);
    this.revisions.delete(designId);
    this.queued.delete(designId);
    this.streaks.delete(designId);
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
      if (next && !this.disposed.signal.aborted && !this.paused(designId)) this.start(designId, next);
    });
    this.running.set(designId, task);
  }

  private set(designId: string, review: Omit<ReviewState, "at">): void {
    this.states.set(designId, { ...review, at: (this.deps.now ?? Date.now)() });
    this.deps.publish(designId, this.states.get(designId)!);
  }

  private async runOne(designId: string, request: ReviewRequest): Promise<void> {
    const generation = this.generations.get(designId) ?? 0;
    const revision = this.deps.revision(designId, request.screenIds);
    this.revisions.set(designId, revision);
    const live = () => {
      if (this.disposed.signal.aborted || (this.generations.get(designId) ?? 0) !== generation) return false;
      if (this.deps.revision(designId, request.screenIds) === revision) return true;
      this.screensChanged(designId);
      return false;
    };
    const base = { round: roundOf(request.screenIds), screens: request.screenIds };
    this.set(designId, { ...base, state: "reviewing", summary: null });
    try {
      const result = await this.deps.run(designId, request, this.disposed.signal);
      if (!live()) return;
      if (result.verdict === "done") {
        this.streaks.delete(designId);
        this.set(designId, { ...base, state: "done", summary: null });
        return;
      }
      const streak = (this.streaks.get(designId) ?? 0) + 1;
      this.streaks.set(designId, streak);
      this.set(designId, { ...base, state: "needs_work", summary: result.findings || null });
      await this.deps.report(designId, request, result.findings, streak >= MAX_REVIEWS_IN_A_ROW);
    } catch (error) {
      if (!live()) return;
      const message = error instanceof Error ? error.message : String(error);
      this.deps.warn(`review of ${designId} failed: ${message}`);
      this.set(designId, { ...base, state: "failed", summary: message });
    }
  }
}
