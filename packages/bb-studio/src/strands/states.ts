// A strand's live state, worked out on each read from real signals only
// (engineering plan, "Live states"); nothing here is guessed or stored.
//
//   needs-you   a reply in the strand that needs the user (src/strands/reply.ts)
//               and isn't answered yet, a pending BB question or approval in a turn of the strand, a
//               worker of the strand in needs-you, a Tool Gateway request
//               from the conversation or one of the strand's workers, or an
//               area's item that needs the user, on the strand its report sits in,
//               or the conversation's flag (bot_needs_you), on the strand of its turn
//   running     the strand's turn is running, or one of its workers is
//   done-unseen a worker finished or failed since the strand was last opened (24 hours)
//   quiet       an agent said it is done (strand_note), until its next activity:
//               straight to Earlier unless pinned
//   waiting     an agent said so (waiting_on, cleared by the next activity), or
//               a linked task waits on CI or someone outside
//   active      none of those, activity in the last 24 hours
//   quiet       none of those, no activity for 24 hours; after 3 more days
//               quiet it moves to "Earlier" unless pinned
import type { Strand } from "./store";

export const STATES = ["needs-you", "running", "done-unseen", "waiting", "active", "quiet"] as const;
export type StrandState = (typeof STATES)[number];

export const QUIET_AFTER_MS = 24 * 60 * 60 * 1000;
export const EARLIER_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
export const DONE_SHOWN_MS = 24 * 60 * 60 * 1000;
/** A failed worker with no strand is listed this long, as the sidebar lists failed workers. */
export const STRAY_FAILED_MS = 7 * 24 * 60 * 60 * 1000;

/** Workers of the conversation that no strand holds: running or waiting on the user, or failed in the last 7 days; waiting first, then running, then failed, newest first. */
export function strayWorkersOf(signals: Pick<Signals, "now" | "workers">): { threadId: string; title: string; status: WorkerStatus; endedAt: number | null }[] {
  const rank: Record<WorkerStatus, number> = { "needs-you": 0, running: 1, failed: 2, done: 3 };
  return signals.workers
    .filter((worker) => worker.strandId === null && (worker.status === "running" || worker.status === "needs-you" || (worker.status === "failed" && (worker.endedAt === null || signals.now - worker.endedAt < STRAY_FAILED_MS))))
    .sort((a, b) => rank[a.status] - rank[b.status] || (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .map(({ threadId, title, status, endedAt }) => ({ threadId, title, status, endedAt }));
}

export type WorkerStatus = "running" | "needs-you" | "failed" | "done";
export interface WorkerSignal { threadId: string; title: string; status: WorkerStatus; strandId: string | null; endedAt: number | null }
export type AskDecision = "allow_once" | "allow_for_session" | "deny";
/** Something waiting on the user: a BB question or approval (in the conversation or one of its workers), or a Tool Gateway request. */
export interface AskSignal { id: string; kind: "question" | "approval" | "gateway" | "area" | "flag" | "reply"; strandId: string | null; label: string; threadId: string; decisions: AskDecision[]; /** An approval's full command, working folder, actions and session grant, in BB's words. */ details: string[]; /** The conversation's turn it waits in (its rows stay in view under any strand filter); null for a worker's. */ turnId?: string | null; /** A reply that needs the user: its message's seq. */ seq?: number | null }
export interface TaskSignal { id: string; strandId: string; waitingOn: { kind: string; text: string | null; ref: string | null } | null }

export interface Signals {
  now: number;
  /** Whether the conversation thread itself is currently busy (reused by list() to avoid a second busy() RPC). */
  busy?: boolean;
  /** The conversation's running turn, once it is sorted (an unsorted turn names no strand). */
  runningStrandId: string | null;
  workers: readonly WorkerSignal[];
  asks: readonly AskSignal[];
  tasks: readonly TaskSignal[];
}

export interface StrandLive {
  state: StrandState;
  /** What waits on the user in it, oldest first. */
  asks: AskSignal[];
  /** One line on why: who it waits on, the worker that needs you. */
  detail: string | null;
  workers: { threadId: string; title: string; status: WorkerStatus; endedAt: number | null }[];
  /** Out of the strip and the tab, in "Earlier". */
  earlier: boolean;
}

export function liveState(strand: Strand, signals: Signals): StrandLive {
  const workers = signals.workers.filter((worker) => worker.strandId === strand.id);
  const asks = signals.asks.filter((ask) => ask.strandId === strand.id);
  const shown = workers.map(({ threadId, title, status, endedAt }) => ({ threadId, title, status, endedAt }));
  const done = (state: StrandState, detail: string | null): StrandLive => ({ state, detail, asks, workers: shown, earlier: false });
  const needs = workers.find((worker) => worker.status === "needs-you");
  // A reply's ask is told last: a BB ask or a worker waiting on the user says more, and the reply has pushed its own ask.
  const ask = asks.find((each) => each.kind !== "reply");
  if (ask) return done("needs-you", ask.label);
  if (needs) return done("needs-you", `${needs.title} needs you`);
  if (asks.length) return done("needs-you", asks[0]!.label);
  const running = workers.filter((worker) => worker.status === "running");
  if (signals.runningStrandId === strand.id || running.length) return done("running", running.length ? running.map((worker) => worker.title).join(", ") : null);
  const since = Math.max(strand.openedAt ?? 0, signals.now - DONE_SHOWN_MS);
  const ended = workers.filter((worker) => (worker.status === "done" || worker.status === "failed") && worker.endedAt !== null && worker.endedAt > since);
  if (ended.length) return done("done-unseen", ended.map((worker) => `${worker.title} ${worker.status === "failed" ? "failed" : "finished"}`).join(", "));
  if (strand.doneAt !== null && strand.doneAt !== undefined && strand.doneAt >= strand.lastAt) return { state: "quiet", detail: "Done", asks, workers: shown, earlier: !strand.pinned };
  if (strand.waitingOn && (strand.waitingAt ?? 0) >= strand.lastAt) return done("waiting", strand.waitingOn);
  const task = signals.tasks.find((each) => each.strandId === strand.id && (each.waitingOn?.kind === "ci" || each.waitingOn?.kind === "outside"));
  if (task) return done("waiting", task.waitingOn!.text ?? task.waitingOn!.ref ?? (task.waitingOn!.kind === "ci" ? "CI" : "someone outside"));
  const idle = signals.now - strand.lastAt;
  if (idle < QUIET_AFTER_MS) return done("active", null);
  return { state: "quiet", detail: null, asks, workers: shown, earlier: !strand.pinned && idle >= QUIET_AFTER_MS + EARLIER_AFTER_MS };
}

const RANK: Record<StrandState, number> = { "needs-you": 0, running: 1, "done-unseen": 2, waiting: 3, active: 4, quiet: 5 };

/** The strip's and the tab's order: needs you first, then running, then by newest activity. */
export function byState<T extends { live: StrandLive; strand: Pick<Strand, "lastAt" | "pinned"> }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => RANK[a.live.state] - RANK[b.live.state] || Number(b.strand.pinned) - Number(a.strand.pinned) || b.strand.lastAt - a.strand.lastAt);
}
