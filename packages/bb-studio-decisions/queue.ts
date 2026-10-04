import type { MessageDispatchHookContext, MessageDispatchHookDecision } from "@get-bb/plugin-sdk";
import type { Verdict } from "./classifier";

export type QueuedRow = MessageDispatchHookContext["queuedMessages"][number];
export type ThreadInfo = MessageDispatchHookContext["thread"];
export type DecisionRecord = {
  at: number;
  threadId: string;
  queuedMessageId: string;
  preview: string;
  verdict: Verdict;
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
  classify: (row: QueuedRow, thread: ThreadInfo, signal: AbortSignal) => Promise<Verdict>;
  steer: (row: QueuedRow) => Promise<void>;
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
  /** Routes one row at a time, so the held rows keep the order the owner queued them in. */
  private routing = Promise.resolve();
  /** Threads whose follow-ups are being grouped, so the drain waits for the plan. */
  private readonly batching = new Map<string, AbortController>();
  /** Threads whose next turn is arranged; cleared once the thread is busy again. */
  private readonly batched = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly deps: SmartQueueDeps) {
    this.now = deps.now ?? Date.now;
  }

  eligibleThread(thread: ThreadInfo) {
    // Visible bot profile threads use the same owner queue as other threads.
    return (
      thread.visibility !== "hidden" &&
      thread.originPluginId !== this.deps.pluginId
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
      return { action: "wait", reason: decidingReason, sendAt: this.now() + holdMs };
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
    for (const [id, entry] of this.entries) {
      if (entry.seenAt >= listedAt) continue;
      const row = live.get(id);
      if (!row || !row.editable || rowText(row) !== entry.text) this.gone({ id });
    }
    for (const row of rows) this.queued(row);
  }

  /** `message.queued`: decide each owner row this plugin holds, and route the ones core queued. */
  queued(row: QueuedRow) {
    if (this.entries.has(row.id)) return;
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
    this.entries.set(row.id, {
      state: "pending",
      threadId: row.threadId,
      createdAt: row.createdAt,
      seenAt: this.now(),
      text: rowText(row),
      applied,
      finish,
      startedAt: this.now(),
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
    const ignore = () => {
      this.routed.delete(row.id);
      this.entries.set(row.id, {
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
      await this.deps.route(row);
    } catch (error) {
      if (!/not found|HTTP 404|already being sent/i.test(String(error)))
        this.deps.warn(`Smart Queue could not take over ${row.id}: ${String(error)}`);
      ignore();
    }
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
    let verdict: Verdict;
    try {
      const thread = await this.deps.thread(row.threadId);
      if (!current()) return;
      if (!isBusy(thread.status)) {
        this.entries.delete(row.id);
        await this.deps.recheck();
        return;
      }
      verdict = await this.deps.classify(row, thread, controller.signal);
    } catch (error) {
      if (controller.signal.aborted || !current()) return;
      verdict = { action: "followup", source: "default", confidence: null, note: String(error) };
      this.deps.warn(`Smart Queue could not classify ${row.id}: ${String(error)}`);
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
        await this.earlierApplied(row);
        // An edit replaces the entry and starts another classification. The
        // old result must not steer that new message while it is undecided.
        if (this.entries.get(row.id) !== decision) return;
        await this.deps.steer(row);
      } catch (error) {
        // Cancelled, or already being sent because the owner sent it by hand.
        if (/not found|HTTP 404|already being sent/i.test(String(error))) {
          this.entries.delete(row.id);
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
      });
    } catch (error) {
      this.deps.warn(`Smart Queue could not record a decision: ${String(error)}`);
    }
    // Refresh the queued card's reason, or release the row if the turn ended meanwhile.
    if (verdict.action === "followup") await this.deps.recheck();
  }

  /** `message.dispatched` and `message.cancelled`. */
  gone(row: Pick<QueuedRow, "id">) {
    this.routed.delete(row.id);
    const entry = this.entries.get(row.id);
    if (entry?.state === "pending") entry.controller.abort();
    entry?.finish();
    this.entries.delete(row.id);
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
    for (const [id, entry] of this.entries)
      if (entry.threadId === threadId) {
        if (entry.state === "pending") entry.controller.abort();
        entry.finish();
        this.entries.delete(id);
      }
  }

  dispose() {
    for (const controller of this.batching.values()) controller.abort();
    this.batching.clear();
    for (const entry of this.entries.values()) {
      if (entry.state === "pending") entry.controller.abort();
      entry.finish();
    }
    this.entries.clear();
  }
}
