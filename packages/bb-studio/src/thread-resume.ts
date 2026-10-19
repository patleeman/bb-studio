// Thread resume: a host daemon restart (or a lost host connection) cuts off
// every running turn on that host, and BB leaves those threads in `error`
// ("Please retry the thread to continue"). Studio picks them up again.
//
// A thread qualifies only when all of these hold:
//   - its status is `error`;
//   - its newest event is `system/thread/interrupted` with reason
//     `host-daemon-restarted` (cause `host-connection-lost` included), the
//     same rule as BB's listThreadIdsWithLatestHostDaemonRestartInterruption
//     (packages/db/src/data/events.ts). Stalled turns (`provider-turn-idle`),
//     user stops and model or tool errors don't match, and nothing reads
//     error text;
//   - it isn't archived or deleted, and if a Bot owns it, that Bot is active;
//   - Studio didn't already resume that same interrupt event.
//
// Resume: threads.send in auto mode, which starts a turn on an `error` thread
// (BB's resolveSendMode), with the visible marker RESUME_MARKER and an
// agent-only note to check the current state before redoing anything.
//
// Cap: at most RESUME_CAP resumes per thread in a rolling hour, recorded in
// thread_auto_resumes (append-only). Past the cap the thread stays in error:
// once per interrupt, a Bot-owned thread goes to its Bot's Needs you plus one
// line in its chat and a phone push (the alertBot urgent path); any other
// thread gets a phone push from Studio Mobile.
//
// When: 30s after a thread fails, soon after a host connects
// (host:changed host-connected), at startup once the first minute is past,
// and on the five-minute sweep. One resume starts about every 15s, with at
// most 3 resumed turns running at once.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";

type Sdk = BbPluginApi["sdk"];

export const RESUME_CAP = 2;
const HOUR = 60 * 60_000;
export const RESUME_MARKER = "↻ Resumed after a restart";
export const RESUME_NOTE = "Your last turn was interrupted by a host restart. Before redoing anything, check the current state (files, running commands, messages you already sent), then continue where you left off.";
/** Send failures per interrupt before Studio leaves it alone. */
const SEND_TRIES = 3;
const MAX_IN_FLIGHT = 3;
/** A resumed turn counts as running at most this long, should no idle or failed event come. */
const IN_FLIGHT_MS = 15 * 60_000;
const PAGE = 200;
const PAGES = 5;

/** Studio's setting (on by default). */
export const THREAD_RESUME_SETTINGS = {
  autoResumeThreads: {
    type: "boolean",
    label: "Resume threads cut off by a restart",
    default: true,
    description: `When a host restart or a lost host connection stops a running thread, Studio sends it "${RESUME_MARKER}" so it continues, at most ${RESUME_CAP} times per thread an hour.`,
  },
} as const;

export type RestartReason = "host restarted" | "host connection lost";
export interface Interruption { eventId: string; seq: number; reason: RestartReason }

type EventLike = { id?: string; seq?: number; type?: string; data?: unknown };

/** The restart that interrupted a turn, from the newest interrupt event; null for any other reason. */
export function restartReason(event: EventLike | undefined | null): RestartReason | null {
  if (!event || event.type !== "system/thread/interrupted") return null;
  const data = (event.data ?? {}) as { reason?: unknown; cause?: unknown };
  if (data.cause === "host-connection-lost") return "host connection lost";
  if (data.reason === "host-daemon-restarted") return "host restarted";
  return null;
}

/**
 * The thread's restart interruption when that is its newest event: the
 * newest interrupt event, then the newest event of any type, which must be
 * the same one (anything newer means the thread moved on).
 */
export async function restartInterruption(sdk: Sdk, threadId: string): Promise<Interruption | null> {
  const [interrupts, newest] = await Promise.all([
    sdk.threads.events.list({ threadId, types: ["system/thread/interrupted"], order: "desc", limit: "1" }),
    sdk.threads.events.list({ threadId, order: "desc", limit: "1" }),
  ]) as [EventLike[], EventLike[]];
  const interrupt = interrupts[0];
  const reason = restartReason(interrupt);
  if (!interrupt?.id || !reason) return null;
  const last = newest[0];
  if (!last || last.id !== interrupt.id || (typeof last.seq === "number" && typeof interrupt.seq === "number" && last.seq > interrupt.seq)) return null;
  return { eventId: interrupt.id, seq: interrupt.seq ?? 0, reason };
}

/** The Bot that owns a thread (its chain, a runner, a thread it started), if any. */
export interface ThreadOwner { botId: string; name: string; threadId: string | null; active: boolean }

export interface ThreadResumeDeps {
  db: Database.Database;
  sdk: Sdk;
  /** The Studio setting. */
  enabled(): boolean;
  owner(threadId: string): ThreadOwner | null;
  /** Past the cap, once per interrupt. */
  exhausted(thread: { id: string; title: string; projectId: string | null }, owner: ThreadOwner | null, line: string): Promise<void>;
  log?(message: string): void;
  now?(): number;
  /** After a thread fails (default 30s). */
  debounceMs?: number;
  /** Between resumes (default 15s). */
  staggerMs?: number;
  /** No sweep this soon after startup (default 60s). */
  graceMs?: number;
}

type Row = { id: number; thread_id: string; event_id: string; event: "resumed" | "exhausted" | "send-failed" | "cleared"; bot_id: string | null; title: string | null; reason: string | null; message: string | null; at: number };
type ThreadLike = { id: string; status?: string; title?: string | null; titleFallback?: string | null; projectId?: string | null; archivedAt?: number | null; deletedAt?: number | null; environmentId?: string | null };

export function resumedLog(reason: RestartReason, count: number): string {
  return `Resumed after a restart (${reason}) — ${count} of ${RESUME_CAP} this hour`;
}

export function exhaustedLine(title: string, reason: RestartReason): string {
  return `"${title}" stopped again (${reason}) after ${RESUME_CAP} auto-resumes this hour. Check it, then send it a message to continue.`;
}

export class ThreadResume {
  private readonly started: number;
  private readonly queue: string[] = [];
  private readonly inFlight = new Map<string, number>();
  private readonly debounces = new Map<string, ReturnType<typeof setTimeout>>();
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStart = -Infinity;
  private sweeping: Promise<number> | null = null;
  private busy = false;
  private waitingForSlot = false;
  private disposed = false;

  constructor(private readonly deps: ThreadResumeDeps) {
    this.started = this.now();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private get stagger(): number {
    return this.deps.staggerMs ?? 15_000;
  }

  private warn(message: string): void {
    this.deps.log?.(message);
  }

  /** Resumes of a thread in the last hour. */
  count(threadId: string): number {
    return (this.deps.db.prepare("SELECT COUNT(*) AS n FROM thread_auto_resumes WHERE thread_id = ? AND event = 'resumed' AND at > ?").get(threadId, this.now() - HOUR) as { n: number }).n;
  }

  private rows(threadId: string, eventId: string): Row[] {
    return this.deps.db.prepare("SELECT * FROM thread_auto_resumes WHERE thread_id = ? AND event_id = ?").all(threadId, eventId) as Row[];
  }

  private append(threadId: string, eventId: string, event: Row["event"], fields: { botId?: string | null; title?: string | null; reason?: string | null; message?: string | null } = {}): void {
    this.deps.db.prepare("INSERT INTO thread_auto_resumes (thread_id, event_id, event, bot_id, title, reason, message, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(threadId, eventId, event, fields.botId ?? null, fields.title ?? null, fields.reason ?? null, fields.message ?? null, this.now());
  }

  /** A Bot's threads past the cap and still where Studio left them, for Needs you. */
  alerts(botId: string): { threadId: string; name: string; message: string; at: number }[] {
    const rows = this.deps.db.prepare(`SELECT * FROM thread_auto_resumes AS row WHERE bot_id = ? AND id = (SELECT MAX(id) FROM thread_auto_resumes WHERE thread_id = row.thread_id) AND event = 'exhausted' AND at > ?`).all(botId, this.now() - 24 * HOUR) as Row[];
    return rows.map((row) => ({ threadId: row.thread_id, name: row.title ?? "A thread", message: row.message ?? "A thread stopped after a restart", at: row.at }));
  }

  /** A thread failed: look at it once things settle (debounced per thread). */
  failed(threadId: string): void {
    this.settled(threadId);
    if (this.disposed || !this.deps.enabled()) return;
    const existing = this.debounces.get(threadId);
    if (existing) clearTimeout(existing);
    this.debounces.set(threadId, setTimeout(() => { this.debounces.delete(threadId); this.enqueue(threadId); }, this.deps.debounceMs ?? 30_000));
  }

  /** A thread went idle, failed or was archived: a resumed turn there is over. */
  settled(threadId: string): void {
    if (!this.inFlight.delete(threadId)) return;
    // A slot is free: stop waiting for one.
    if (this.pumpTimer && this.waitingForSlot) { clearTimeout(this.pumpTimer); this.pumpTimer = null; }
    this.pump();
  }

  /** A thread finished a turn (the user picked it up): its Needs you entry ends. */
  idle(threadId: string): void {
    this.settled(threadId);
    const latest = this.deps.db.prepare("SELECT * FROM thread_auto_resumes WHERE thread_id = ? ORDER BY id DESC LIMIT 1").get(threadId) as Row | undefined;
    if (latest?.event === "exhausted") this.append(threadId, latest.event_id, "cleared", { botId: latest.bot_id, title: latest.title });
  }

  /** A host connected again: sweep soon (debounced, and not in the first minute). */
  hostConnected(): void {
    this.sweepSoon(5_000);
  }

  private sweepSoon(delay: number): void {
    if (this.disposed) return;
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    const grace = this.started + (this.deps.graceMs ?? 60_000) - this.now();
    this.sweepTimer = setTimeout(() => { this.sweepTimer = null; void this.sweep().catch((error) => this.warn(`Thread resume sweep failed: ${(error as Error)?.message ?? error}`)); }, Math.max(delay, grace));
  }

  /** The startup sweep: once the first minute is past. */
  startup(): void {
    this.sweepSoon(0);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.debounces.values()) clearTimeout(timer);
    this.debounces.clear();
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    this.pumpTimer = this.sweepTimer = null;
  }

  /** Queues every thread in error (recent ones, hidden included); returns how many it queued. */
  sweep(): Promise<number> {
    this.sweeping ??= this.runSweep().finally(() => { this.sweeping = null; });
    return this.sweeping;
  }

  private async runSweep(): Promise<number> {
    if (this.disposed || !this.deps.enabled()) return 0;
    if (this.now() - this.started < (this.deps.graceMs ?? 60_000)) return 0;
    let queued = 0;
    for (let page = 0; page < PAGES; page++) {
      const batch = await this.deps.sdk.threads.list({ archived: false, includeHidden: true, limit: PAGE, offset: page * PAGE }) as ThreadLike[];
      for (const thread of batch) if (thread.status === "error" && this.enqueue(thread.id)) queued++;
      if (batch.length < PAGE) break;
    }
    return queued;
  }

  private enqueue(threadId: string): boolean {
    if (this.disposed || this.queue.includes(threadId) || this.inFlight.has(threadId)) return false;
    this.queue.push(threadId);
    this.pump();
    return true;
  }

  /** Starts the next resume when the stagger and the in-flight limit allow. */
  private pump(): void {
    if (this.disposed || this.pumpTimer || this.busy || !this.queue.length) return;
    const now = this.now();
    for (const [id, at] of this.inFlight) if (now - at > IN_FLIGHT_MS) this.inFlight.delete(id);
    if (this.inFlight.size >= MAX_IN_FLIGHT) {
      // Re-check later in case an idle or failed event never comes.
      this.waitingForSlot = true;
      this.pumpTimer = setTimeout(() => { this.pumpTimer = null; this.pump(); }, 60_000);
      return;
    }
    this.waitingForSlot = false;
    const wait = Math.max(0, this.lastStart + this.stagger - now);
    this.pumpTimer = setTimeout(() => { this.pumpTimer = null; void this.next(); }, wait);
  }

  private async next(): Promise<void> {
    const threadId = this.queue.shift();
    if (!threadId || this.disposed) return;
    this.busy = true;
    try {
      if (await this.attempt(threadId) === "resumed") {
        this.lastStart = this.now();
        this.inFlight.set(threadId, this.now());
      }
    } catch (error) {
      this.warn(`Thread resume of ${threadId} failed: ${(error as Error)?.message ?? error}`);
    } finally {
      this.busy = false;
      this.pump();
    }
  }

  /** Checks one thread and resumes it when it qualifies. */
  async attempt(threadId: string): Promise<"resumed" | "exhausted" | "skipped"> {
    if (!this.deps.enabled()) return "skipped";
    const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null) as ThreadLike | null;
    if (!thread || thread.archivedAt || thread.deletedAt || thread.status !== "error") return "skipped";
    const owner = this.deps.owner(threadId);
    if (owner && !owner.active) return "skipped";
    const interruption = await restartInterruption(this.deps.sdk, threadId);
    if (!interruption) return "skipped";
    const handled = this.rows(threadId, interruption.eventId);
    if (handled.some((row) => row.event === "resumed" || row.event === "exhausted")) return "skipped";
    if (handled.filter((row) => row.event === "send-failed").length >= SEND_TRIES) return "skipped";
    if (!(await this.hostUp(thread))) return "skipped";
    const title = thread.title || thread.titleFallback || "Untitled thread";
    const count = this.count(threadId);
    if (count >= RESUME_CAP) {
      const line = exhaustedLine(title, interruption.reason);
      this.append(threadId, interruption.eventId, "exhausted", { botId: owner?.botId, title, reason: interruption.reason, message: line });
      this.warn(`${threadId}: ${line}`);
      await this.deps.exhausted({ id: threadId, title, projectId: thread.projectId ?? null }, owner, line);
      return "exhausted";
    }
    try {
      await this.deps.sdk.threads.send({
        threadId, mode: "auto",
        input: [
          { type: "text", text: RESUME_MARKER, mentions: [] },
          { type: "text", text: RESUME_NOTE, mentions: [], visibility: "agent-only" },
        ],
      } as never);
    } catch (error) {
      this.append(threadId, interruption.eventId, "send-failed", { botId: owner?.botId, reason: interruption.reason, message: String((error as Error)?.message ?? error).slice(0, 500) });
      throw error;
    }
    this.append(threadId, interruption.eventId, "resumed", { botId: owner?.botId, reason: interruption.reason, message: resumedLog(interruption.reason, count + 1) });
    this.warn(`${threadId}: ${resumedLog(interruption.reason, count + 1)}`);
    return "resumed";
  }

  /** False only when BB says the thread's host is disconnected (a send would fail); the host:changed sweep comes back. */
  private async hostUp(thread: ThreadLike): Promise<boolean> {
    if (!thread.environmentId) return true;
    const environment = await this.deps.sdk.environments.get({ environmentId: thread.environmentId }).catch(() => null) as { hostId?: string | null } | null;
    if (!environment?.hostId) return true;
    const host = await this.deps.sdk.hosts.get({ hostId: environment.hostId }).catch(() => null) as { status?: string } | null;
    return host?.status !== "disconnected";
  }
}
