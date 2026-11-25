import type { MessageDispatchHookContext, MessageDispatchHookDecision } from "@get-bb/plugin-sdk";
import type { Action, Verdict } from "./classifier";

export type QueuedRow = MessageDispatchHookContext["queuedMessages"][number];
export type ThreadInfo = MessageDispatchHookContext["thread"];
export type DecisionRecord = {
  at: number;
  threadId: string;
  queuedMessageId: string;
  preview: string;
  verdict: Verdict;
  /** From the row being held to the decision, in ms. */
  ms?: number;
};

type Tracking = {
  threadId: string;
  createdAt: number;
  /** When Smart Queue first saw the row, so a queue snapshot taken earlier cannot prune it. */
  seenAt: number;
  /** The text classified, so an edit to the queued card can start a fresh decision. */
  text: string;
  /** Resolves once this row's decision, including any steer, has been applied. */
  applied: Promise<void>;
  finish: () => void;
  /**
   * What BB does with the row when no classifier answers in time: steer for a
   * message the composer sent to steer, follow-up for one it queued (`route`).
   */
  fallback?: Action;
};
type Entry =
  | (Tracking & { state: "pending"; startedAt: number; controller: AbortController })
  | (Tracking & { state: "decided"; verdict: Verdict })
  /** A core-queued row Smart Queue leaves alone, remembered so the watcher does not re-read it. */
  | (Tracking & { state: "ignored" });

export type SmartQueueDeps = {
  pluginId: string;
  enabled: () => Promise<boolean>;
  thread: (threadId: string) => Promise<ThreadInfo>;
  /**
   * True when the thread's turn is open only for background work: the agent
   * finished its reply. BB then starts a new run at once for a steered or a
   * queued message, so Smart Queue holds nothing.
   */
  mainRunIdle?: (threadId: string) => Promise<boolean>;
  /** Overrides {@link decideBudgetMs} (tests). */
  decideBudgetMs?: number;
  classify: (row: QueuedRow, thread: ThreadInfo, signal: AbortSignal) => Promise<Verdict>;
  steer: (row: Pick<QueuedRow, "id" | "threadId">) => Promise<void>;
  /** Re-sends a core-queued row inline, so the dispatch hook holds it. */
  route: (row: QueuedRow) => Promise<void>;
  /** The thread's live queue, in order. */
  list: (threadId: string) => Promise<QueuedRow[]>;
  /** Which of `candidates` belong in the same turn as `head`. */
  batch: (head: QueuedRow, candidates: QueuedRow[], thread: ThreadInfo, signal: AbortSignal) => Promise<string[]>;
  /** Moves `ids` to the front of the queue, in order, as one group core sends as one turn. */
  group: (threadId: string, ids: string[]) => Promise<void>;
  recheck: () => Promise<void>;
  record: (record: DecisionRecord) => Promise<void>;
  warn: (message: string) => void;
  now?: () => number;
};

/**
 * Core paces re-attempts per thread and can drop a recheck that arrives right
 * after a row queued, so every hold also carries its own re-ask time. While
 * deciding it is short, so the queued card shows the decision promptly.
 */
export const holdMs = 5_000;
/** A held follow-up is normally released by the idle recheck; this is the backstop. */
export const followupRecheckMs = 60_000;
/** A decision older than this is abandoned in favor of follow-up. */
export const maxDecideMs = 90_000;
/**
 * How long a held message waits for Jev, from the moment it was held. After
 * that it goes the way BB sends it without Smart Queue (see `fallback`), so a
 * slow or failing classifier never keeps the owner's message off the thread.
 */
export const decideBudgetMs = 1_500;
/** A core row re-sent for Smart Queue to hold comes back within this, or it was never held. */
export const reroutedTtlMs = 5_000;
/** A release that keeps failing warns at most this often per row. */
export const releaseWarnEveryMs = 60_000;
/** Max remembered departed row ids (evicted by TTL and FIFO cap even if sync() isn't called). */
export const maxDeparted = 500;
export const departedTtlMs = 5 * 60_000;
export const decidingReason = "Smart Queue is deciding whether to steer or follow up.";
export const batchingReason = "Smart Queue is grouping related follow-ups into one turn.";
/** How many follow-ups one batching decision weighs. */
export const maxBatch = 12;
/** Batching gives up after this and sends the follow-ups one turn each. */
export const maxBatchMs = 20_000;

export function describeVerdict(verdict: Verdict) {
  const via = verdict.via ? ` via ${verdict.via}` : "";
  if (verdict.source === "jev")
    return `Jev${verdict.confidence === null ? "" : ` ${Math.round(verdict.confidence * 100)}%`}${via}`;
  return verdict.source === "model" ? `fallback model${via}` : "no classifier answered";
}
export const followupReason = (verdict: Verdict) =>
  `Smart Queue: follow-up after the current turn (${describeVerdict(verdict)}).`;

/**
 * Taking over a core row failed after the row was deleted. `restoredId` is
 * the row put back in its place, which stays with core so a lasting failure
 * does not delete and re-send it every time the queue is read.
 */
export class RouteFailed extends Error {
  constructor(
    message: string,
    readonly restoredId: string | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** A held message sent because the agent had finished and only background work kept its turn open. */
const finishedVerdict: Verdict = { action: "steer", source: "default", confidence: null, note: "The agent had finished; only background work was running." };

export const isBusy = (status: ThreadInfo["status"]) => status === "active" || status === "starting";
export const rowText = (row: Pick<QueuedRow, "content">) =>
  row.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

/** Core only groups rows that would run the same way. */
const sameEnvelope = (a: QueuedRow, b: QueuedRow) =>
  a.senderThreadId === b.senderThreadId &&
  a.model === b.model &&
  a.reasoningLevel === b.reasoningLevel &&
  a.permissionMode === b.permissionMode &&
  a.serviceTier === b.serviceTier;

const lostVerdict: Verdict = {
  action: "followup",
  source: "default",
  confidence: null,
  note: "The decision was lost when Smart Queue restarted.",
};

/**
 * Holds owner messages sent to a busy thread until a classifier decides.
 * Steer delivers the row into the running turn now; follow-up keeps it held
 * until the thread is no longer busy. Core-queued rows (Enter set to queue)
 * are sent back through the hook, so they are held and decided the same way.
 * When the thread frees up, related follow-ups are grouped into one turn,
 * wherever they sit in the queue.
 */
export class SmartQueue {
  readonly entries = new Map<string, Entry>();
  /** Core-queued rows being sent back through the dispatch hook. */
  readonly routed = new Set<string>();
  /**
   * Re-sent core rows not held yet (thread and text → when each was re-sent):
   * the owner queued them, so their fallback is follow-up. A re-send that is
   * never held (the thread went free first) ages out after {@link reroutedTtlMs}.
   */
  private readonly rerouted = new Map<string, number[]>();
  /** When the hook held a new message (thread and text), so its decision budget starts there, not at `message.queued`. */
  private readonly heldAt = new Map<string, number>();
  /** Per thread, held follow-ups being released, one release at a time. */
  private readonly releasing = new Map<string, Promise<void>>();
  /** When a failing release last warned, per row. */
  private readonly releaseWarnedAt = new Map<string, number>();
  /** Routes one row at a time, so the held rows keep the order the owner queued them in. */
  private routing = Promise.resolve();
  /** Threads whose follow-ups are being grouped, so the drain waits for the plan. */
  private readonly batching = new Map<string, AbortController>();
  /** Threads whose next turn is arranged; cleared once the thread is busy again. */
  private readonly batched = new Set<string>();
  /** When tracked rows were sent or cancelled, so a queue snapshot listed earlier cannot bring them back. */
  private readonly departed = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly deps: SmartQueueDeps) {
    this.now = deps.now ?? Date.now;
  }

  eligibleThread(thread: ThreadInfo) {
    // Visible bot profile threads use the same owner queue as other threads.
    return (
      thread.visibility !== "hidden"
    );
  }

  heldByUs(row: Pick<QueuedRow, "waitingOn">) {
    return row.waitingOn?.kind === "plugin" && row.waitingOn.pluginId === this.deps.pluginId;
  }

  /** Answers `message.dispatch`. Only memory and settings are read: the hook runs under core's lock. */
  async dispatch(context: MessageDispatchHookContext): Promise<MessageDispatchHookDecision> {
    const proceed = { action: "proceed" } as const;
    if (!this.eligibleThread(context.thread) || !(await this.deps.enabled())) return proceed;
    const busy = isBusy(context.thread.status);
    if (!context.queuedMessages.length) {
      const human =
        context.initiator === "user" &&
        context.senderThreadId === null &&
        context.experimental_submission === null;
      if (!human || (context.attempt !== "join-turn" && !busy)) return proceed;
      const now = this.now();
      for (const [key, at] of this.heldAt) if (now - at >= reroutedTtlMs) this.heldAt.delete(key);
      this.heldAt.set(`${context.thread.id}\0${context.input?.text ?? ""}`, now);
      return { action: "wait", reason: decidingReason, sendAt: now + holdMs };
    }
    const threadId = context.thread.id;
    if (!busy) {
      // A thread that is free needs no decision: deliver what is waiting,
      // once related follow-ups are grouped into the next turn.
      if (this.batched.has(threadId) || !context.queuedMessages.some((row) => this.heldByUs(row))) return proceed;
      if (!this.batching.has(threadId) && this.followups(threadId).length < 2) return proceed;
      this.batch(threadId);
      return { action: "wait", reason: batchingReason, sendAt: this.now() + holdMs };
    }
    this.batched.delete(threadId);
    let pending = false;
    let followup: Verdict | null = null;
    for (const row of context.queuedMessages) {
      // Core owns the waits it created; a decision only changes those by steering.
      if (!this.heldByUs(row)) continue;
      let entry = this.entries.get(row.id);
      if (entry?.state === "pending" && this.now() - entry.startedAt >= maxDecideMs) {
        entry.controller.abort();
        // A classifier can ignore cancellation. Its replacement follow-up
        // must still release later steers waiting for this decision.
        entry.finish();
        entry = {
          ...entry,
          state: "decided",
          verdict: { action: "followup", source: "default", confidence: null, note: "The classifier timed out." },
        };
        this.entries.set(row.id, entry);
      }
      if (entry?.state === "pending") pending = true;
      else if (entry?.state === "decided" && entry.verdict.action === "followup") followup ??= entry.verdict;
      else if (!entry) followup ??= lostVerdict;
    }
    if (pending) return { action: "wait", reason: decidingReason, sendAt: this.now() + holdMs };
    if (followup) return { action: "wait", reason: followupReason(followup), sendAt: this.now() + followupRecheckMs };
    return proceed;
  }

  /**
   * The app's composer queues a busy-thread message by creating the row
   * directly, which runs no hook and fires no `message.queued`. A periodic
   * snapshot of every live row finds those, and forgets rows that left the
   * queue without an event. Edits and manual sends fire no event either, so
   * the snapshot also cancels a decision for a row the owner sent by hand
   * (claimed rows stop being editable) and restarts one for an edited row.
   */
  sync(rows: readonly QueuedRow[], listedAt: number) {
    const live = new Map(rows.map((row) => [row.id, row]));
    for (const id of this.routed) if (!live.has(id)) this.routed.delete(id);
    for (const [id, at] of this.departed) if (at < listedAt) this.departed.delete(id);
    for (const [id, entry] of this.entries) {
      if (entry.seenAt >= listedAt) continue;
      const row = live.get(id);
      if (!row || !row.editable || rowText(row) !== entry.text) this.drop(id);
    }
    for (const id of this.releaseWarnedAt.keys()) if (!this.entries.has(id)) this.releaseWarnedAt.delete(id);
    for (const row of rows) if (!this.departed.has(row.id)) this.queued(row);
  }

  /** `message.queued`: decide each owner row this plugin holds, and route the ones core queued. */
  queued(row: QueuedRow) {
    if (this.entries.has(row.id)) return;
    // Smart Queue's own re-sends (`route`) still pass this check: a plugin's
    // `threads.send` reaches core's send route, which dispatches with
    // `originPluginId: null` and trigger "user". Only spawn and fork stamp the
    // plugin (BB 536b292a: apps/server/src/services/threads/thread-send-request.ts,
    // and withPluginThreadAttribution in apps/server/src/services/plugins/plugin-api.ts).
    if (row.initiator !== "user" || row.senderThreadId !== null || row.originPluginId !== null) return;
    // A claimed row is already on its way to the provider.
    if (row.payload.kind !== "inline" || !row.editable) return;
    if (!this.heldByUs(row)) {
      // A row the owner grouped by hand stays with core, so its group goes as one prompt.
      if (row.waitingOn?.kind === "thread-busy" && !row.groupWithNext && !this.routed.has(row.id)) {
        this.routed.add(row.id);
        this.routing = this.routing.then(() => this.route(row));
      }
      return;
    }
    const controller = new AbortController();
    let finish!: () => void;
    const applied = new Promise<void>((resolve) => (finish = resolve));
    const text = rowText(row);
    const key = `${row.threadId}\0${text}`;
    const queuedByOwner = this.takeRerouted(key);
    const heldAt = this.heldAt.get(key);
    this.heldAt.delete(key);
    const startedAt = heldAt !== undefined && this.now() - heldAt < reroutedTtlMs ? heldAt : this.now();
    this.entries.set(row.id, {
      state: "pending",
      threadId: row.threadId,
      createdAt: row.createdAt,
      seenAt: this.now(),
      text,
      applied,
      finish,
      fallback: queuedByOwner ? "followup" : "steer",
      startedAt,
      controller,
    });
    void this.decide(row, controller).finally(finish);
  }

  /**
   * The composer queues a busy-thread message as a core row, which no hook
   * sees, and sending a queued row skips the hook too. Re-sending its content
   * inline runs the dispatch pass, where Smart Queue holds it as a new row on
   * its own card while it decides. A row on a thread Smart Queue skips is left
   * with core.
   */
  private async route(row: QueuedRow) {
    // Sent by hand or cancelled while earlier rows were routed.
    if (!this.routed.has(row.id)) return;
    const ignore = (id = row.id) => {
      this.routed.delete(id);
      this.entries.set(id, {
        state: "ignored",
        threadId: row.threadId,
        createdAt: row.createdAt,
        seenAt: this.now(),
        text: rowText(row),
        applied: Promise.resolve(),
        finish: () => {},
      });
    };
    try {
      const thread = await this.deps.thread(row.threadId);
      if (!isBusy(thread.status) || !this.eligibleThread(thread) || !(await this.deps.enabled())) return ignore();
      const key = `${row.threadId}\0${rowText(row)}`;
      const at = this.now();
      this.rerouted.set(key, [...this.freshRerouted(key), at]);
      try {
        await this.deps.route(row);
      } catch (error) {
        const left = this.freshRerouted(key).filter((each) => each !== at);
        if (left.length) this.rerouted.set(key, left);
        else this.rerouted.delete(key);
        throw error;
      }
    } catch (error) {
      if (!/not found|HTTP 404|already being sent/i.test(String(error)))
        this.deps.warn(`Smart Queue could not take over ${row.id}: ${String(error)}`);
      if (error instanceof RouteFailed && error.restoredId) ignore(error.restoredId);
      ignore();
    }
  }

  /** The re-sends of `key` still young enough to be held, dropping the stale ones. */
  private freshRerouted(key: string) {
    const fresh = (this.rerouted.get(key) ?? []).filter((at) => this.now() - at < reroutedTtlMs);
    if (fresh.length) this.rerouted.set(key, fresh);
    else this.rerouted.delete(key);
    return fresh;
  }

  /** Whether a held row is the re-sent copy of a row the owner queued; consumes one re-send. */
  private takeRerouted(key: string) {
    const [, ...rest] = this.freshRerouted(key);
    if (!this.rerouted.has(key)) return false;
    if (rest.length) this.rerouted.set(key, rest);
    else this.rerouted.delete(key);
    return true;
  }

  private followups(threadId: string) {
    return [...this.entries.entries()].flatMap(([id, entry]) =>
      entry.threadId === threadId && entry.state === "decided" && entry.verdict.action === "followup" ? [id] : [],
    );
  }

  /**
   * Groups the follow-ups that belong with the first queued row into one turn,
   * moving them up to it from wherever they were queued. The rest wait for the
   * next turn, where the same question is asked again. Anything that goes
   * wrong leaves the queue as it was, so each row still sends on its own.
   */
  private batch(threadId: string) {
    if (this.batching.has(threadId)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Batching timed out.")), maxBatchMs);
    this.batching.set(threadId, controller);
    void (async () => {
      try {
        const rows = await this.deps.list(threadId);
        const head = rows[0];
        const followups = new Set(this.followups(threadId));
        // A group the owner made by hand is theirs to keep.
        if (!head || !followups.has(head.id) || rows.some((row) => row.groupWithNext)) return;
        const candidates = rows
          .slice(1)
          .filter((row) => followups.has(row.id) && sameEnvelope(head, row))
          .slice(0, maxBatch - 1);
        if (!candidates.length) return;
        const thread = await this.deps.thread(threadId);
        if (isBusy(thread.status)) return;
        const joined = new Set(await this.deps.batch(head, candidates, thread, controller.signal));
        const ids = [head.id, ...candidates.filter((row) => joined.has(row.id)).map((row) => row.id)];
        if (ids.length > 1 && !controller.signal.aborted) await this.deps.group(threadId, ids);
      } catch (error) {
        if (!/not found|HTTP 404|claimed|stale/i.test(String(error)))
          this.deps.warn(`Smart Queue could not group follow-ups in ${threadId}: ${String(error)}`);
      } finally {
        clearTimeout(timer);
        // Forgotten or disposed meanwhile: there is nothing left to release.
        if (this.batching.get(threadId) === controller) {
          this.batching.delete(threadId);
          this.batched.add(threadId);
          await this.deps.recheck().catch((error) => this.deps.warn(`Smart Queue could not release ${threadId}: ${String(error)}`));
        }
      }
    })();
  }

  /** Steers land in the order the owner sent them, even when a later classification finishes first. */
  private async earlierApplied(row: QueuedRow) {
    const earlier = [...this.entries.entries()].filter(
      ([id, entry]) =>
        id !== row.id &&
        entry.threadId === row.threadId &&
        (entry.createdAt < row.createdAt || (entry.createdAt === row.createdAt && id < row.id)),
    );
    await Promise.all(earlier.map(([, entry]) => entry.applied));
  }

  private async decide(row: QueuedRow, controller: AbortController) {
    const current = () => {
      const entry = this.entries.get(row.id);
      return entry?.state === "pending" && entry.controller === controller;
    };
    const started = this.entries.get(row.id);
    const startedAt = started?.state === "pending" ? started.startedAt : this.now();
    const fallback: Action = started?.fallback ?? "steer";
    // Everything below, reads included, shares one budget from the moment the row was held.
    const late = new AbortController();
    const budgetMs = this.deps.decideBudgetMs ?? decideBudgetMs;
    const timer = setTimeout(() => late.abort(new Error("Smart Queue's decision budget ran out.")), Math.max(0, budgetMs - (this.now() - startedAt)));
    const outOfTime = new Promise<"late">((resolve) => late.signal.addEventListener("abort", () => resolve("late"), { once: true }));
    const signal = AbortSignal.any([controller.signal, late.signal]);
    let verdict: Verdict;
    try {
      const answer = await Promise.race([
        (async (): Promise<Verdict | "free"> => {
          const [thread, mainRunIdle] = await Promise.all([
            this.deps.thread(row.threadId),
            this.deps.mainRunIdle ? this.deps.mainRunIdle(row.threadId).catch(() => false) : false,
          ]);
          if (!isBusy(thread.status)) return "free";
          // The agent already answered; only background work keeps the turn open. BB starts a new run now.
          if (mainRunIdle) return finishedVerdict;
          return this.deps.classify(row, thread, signal);
        })(),
        outOfTime,
      ]);
      if (!current()) return;
      if (answer === "free") {
        this.entries.delete(row.id);
        this.releaseWarnedAt.delete(row.id);
        await this.deps.recheck();
        return;
      }
      verdict =
        answer === "late"
          ? { action: fallback, source: "default", confidence: null, note: `No decision within ${budgetMs} ms; sent the way BB sends it.` }
          : answer.source === "default" && answer !== finishedVerdict
            ? { ...answer, action: fallback } // No classifier answered.
            : answer;
    } catch (error) {
      if (controller.signal.aborted || !current()) return;
      verdict = late.signal.aborted
        ? { action: fallback, source: "default", confidence: null, note: `No decision within ${budgetMs} ms; sent the way BB sends it.` }
        : { action: fallback, source: "default", confidence: null, note: String(error) };
      if (!late.signal.aborted) this.deps.warn(`Smart Queue could not classify ${row.id}: ${String(error)}`);
    } finally {
      clearTimeout(timer);
      // A classifier still running past the budget is cancelled.
      if (!late.signal.aborted) late.abort();
    }
    const decided = (verdict: Verdict) => {
      const entry = this.entries.get(row.id);
      if (entry) this.entries.set(row.id, { ...entry, state: "decided", verdict });
    };
    if (!current()) return;
    decided(verdict);
    const decision = this.entries.get(row.id);
    if (verdict.action === "steer") {
      try {
        if (verdict === finishedVerdict) {
          // The run ended: follow-ups the owner sent before this message go first.
          await this.earlierApplied(row);
          await this.releaseThread(row.threadId, row);
        }
        await this.earlierApplied(row);
        // An edit replaces the entry and starts another classification. The
        // old result must not steer that new message while it is undecided.
        if (this.entries.get(row.id) !== decision) return;
        await this.deps.steer(row);
      } catch (error) {
        // Cancelled, or already being sent because the owner sent it by hand.
        if (/not found|HTTP 404|already being sent/i.test(String(error))) {
          this.entries.delete(row.id);
          this.releaseWarnedAt.delete(row.id);
          return;
        }
        this.deps.warn(`Smart Queue could not steer ${row.id}: ${String(error)}`);
        verdict = { ...verdict, action: "followup", note: `Steer failed: ${String(error)}` };
        decided(verdict);
      }
    }
    try {
      await this.deps.record({
        at: this.now(),
        threadId: row.threadId,
        queuedMessageId: row.id,
        preview: rowText(row).replace(/\s+/g, " ").trim().slice(0, 120),
        verdict,
        ms: this.now() - startedAt,
      });
    } catch (error) {
      this.deps.warn(`Smart Queue could not record a decision: ${String(error)}`);
    }
    // Refresh the queued card's reason, or release the row if the turn ended meanwhile.
    if (verdict.action === "followup")
      await this.deps.recheck().catch((error) => this.deps.warn(`Smart Queue could not release ${row.threadId}: ${String(error)}`));
  }

  /**
   * Held follow-ups wait for the current run, not for background work: once
   * the agent has finished its reply (the turn stays open only for background
   * tasks), they are sent now, oldest first, as BB sends a queued message then.
   * The queue watcher calls this outside core's dispatch lock.
   */
  async releaseFinished() {
    if (!this.deps.mainRunIdle) return;
    const threads = new Set<string>();
    for (const entry of this.entries.values()) if (entry.state === "decided" && entry.verdict.action === "followup") threads.add(entry.threadId);
    for (const threadId of threads) {
      if (!(await this.deps.mainRunIdle(threadId).catch(() => false))) continue;
      await this.releaseThread(threadId);
    }
  }

  /**
   * Sends a thread's held follow-ups, oldest first (only those sent before
   * `before`, when given). One release per thread at a time, so the watcher
   * and a decision never interleave their steers.
   */
  releaseThread(threadId: string, before?: Pick<QueuedRow, "id" | "createdAt">): Promise<void> {
    const run = (this.releasing.get(threadId) ?? Promise.resolve()).then(() => this.releaseNow(threadId, before));
    const tail = run.catch(() => {});
    this.releasing.set(threadId, tail);
    void tail.then(() => {
      if (this.releasing.get(threadId) === tail) this.releasing.delete(threadId);
    });
    return run;
  }

  private async releaseNow(threadId: string, before?: Pick<QueuedRow, "id" | "createdAt">) {
    const rows = [...this.entries.entries()].filter(
      ([id, entry]) =>
        entry.threadId === threadId &&
        entry.state === "decided" &&
        entry.verdict.action === "followup" &&
        (!before || entry.createdAt < before.createdAt || (entry.createdAt === before.createdAt && id < before.id)),
    );
    rows.sort(([a, x], [b, y]) => x.createdAt - y.createdAt || (a < b ? -1 : 1));
    for (const [id, entry] of rows) {
      if (this.entries.get(id) !== entry) continue;
      const released: Entry = { ...entry, state: "decided", verdict: finishedVerdict };
      this.entries.set(id, released);
      try {
        await this.deps.steer({ id, threadId });
        this.releaseWarnedAt.delete(id);
      } catch (error) {
        if (/not found|HTTP 404|already being sent/i.test(String(error))) {
          if (this.entries.get(id) === released) {
            this.entries.delete(id);
            this.releaseWarnedAt.delete(id);
          }
          continue;
        }
        // Still held unless the row was sent, cancelled or edited meanwhile.
        const stillHeld = this.entries.get(id) === released;
        if (stillHeld) this.entries.set(id, entry);
        const warned = this.releaseWarnedAt.get(id);
        if (warned === undefined || this.now() - warned >= releaseWarnEveryMs) {
          if (stillHeld) this.releaseWarnedAt.set(id, this.now());
          this.deps.warn(`Smart Queue could not release ${id}: ${String(error)}`);
        }
        break;
      }
    }
  }

  /** `message.dispatched` and `message.cancelled`. */
  gone(row: Pick<QueuedRow, "id">) {
    if (this.entries.has(row.id) || this.routed.has(row.id)) {
      const now = this.now();
      for (const [id, at] of this.departed) if (now - at >= departedTtlMs) this.departed.delete(id);
      this.departed.delete(row.id);
      this.departed.set(row.id, now);
      while (this.departed.size > maxDeparted) this.departed.delete(this.departed.keys().next().value!);
    }
    this.drop(row.id);
  }

  private drop(id: string) {
    this.routed.delete(id);
    this.releaseWarnedAt.delete(id);
    const entry = this.entries.get(id);
    if (entry?.state === "pending") entry.controller.abort();
    entry?.finish();
    this.entries.delete(id);
  }

  /** `thread.idle` and `thread.failed`: release the follow-ups held for this thread. */
  async settled(threadId: string) {
    this.batched.delete(threadId);
    if ([...this.entries.values()].some((entry) => entry.threadId === threadId)) await this.deps.recheck();
  }

  /** `thread.archived` and `thread.deleted`: rows vanish without a queue event. */
  forget(threadId: string) {
    this.batching.get(threadId)?.abort();
    this.batching.delete(threadId);
    this.batched.delete(threadId);
    for (const [id, entry] of [...this.entries])
      if (entry.threadId === threadId) this.drop(id);
  }

  dispose() {
    for (const controller of this.batching.values()) controller.abort();
    this.batching.clear();
    this.batched.clear();
    for (const entry of this.entries.values()) {
      if (entry.state === "pending") entry.controller.abort();
      entry.finish();
    }
    this.entries.clear();
    this.routed.clear();
    this.rerouted.clear();
    this.heldAt.clear();
    this.releaseWarnedAt.clear();
    this.departed.clear();
  }
}
