// Strands for Studio, in every Bot conversation (Main included, not workers):
// the detector fed from BB's thread events, the live signals each read is
// worked out from, the user's edits (move, new strand from here, rename,
// pin, merge), the RPCs the strip, the message tags and the Strands tab read,
// and the needs-you push's check. A conversation is backfilled lazily (opened, or a turn
// finished), only when it was active in the last 14 days, one at a time,
// the most recently active first.
import type Database from "better-sqlite3";
import { type OverviewConversation, type ReplyTagView, type StrandItemView, type StrandList, type StrandView } from "./contract";
import { firstLineTitle } from "./naming";
import { JEV_DAILY_CAP, StrandDetector, type DetectorDeps, type OpenTask } from "./detector";
import { approvalDecisions, approvalLines, isWorkerApproval, shortApproval, type Interaction } from "../worker-approvals";
import { byState, liveState, strayWorkersOf, type AskSignal, type Signals, type TaskSignal, type WorkerSignal, type WorkerStatus } from "./states";
import { StrandStore, type Strand } from "./store";
import { REPLY_OPEN_MS } from "./reply";
import { isPingRequest } from "../bot-cache";
import type { EventRow } from "./turns";
import { USER_OWNER } from "../tasks/contract";
import { mapPool } from "../kit/pool";

export interface WorkerFact { threadId: string; title: string; status: WorkerStatus; createdAt: number; endedAt: number | null }

export interface StrandServiceDeps extends Omit<DetectorDeps, "store" | "openTasks"> {
  db: Database.Database;
  /** A conversation strands run in (a Bot's, Main included; not a worker, not archived): its Bot and last activity. Null for any other thread. */
  conversation(threadId: string): { botId: string; lastActiveAt: number } | null;
  /** A Bot's conversations, for the needs-you push's check. */
  conversationsOf(botId: string): Promise<{ threadId: string; title: string; isMain: boolean; lastActiveAt: number }[]>;
  /** The conversation's workers, with BB's status. */
  workers(threadId: string): Promise<WorkerFact[]>;
  /** Pending BB questions and approvals in a thread. */
  interactions(threadId: string): Promise<(Interaction & { createdAt?: number })[]>;
  /** Whether the thread is in a turn. */
  /** A worker's conversation (strand_note from a worker), else null. */
  conversationOfWorker?(threadId: string): string | null;
  /**
   * What else waits on the user in this conversation: an area's item that
   * needs them (reported here: a runner's to Main, a lead's to its own), and
   * the conversation's own flag (bot_needs_you). Each with when it was raised.
   */
  extraAsks?(threadId: string): { id: string; kind: "area" | "flag"; label: string; at: number }[];
  busy(threadId: string): Promise<boolean>;
}

type TaskRow = { record: string };
type TaskRecord = { id: string; title?: string; owner?: string; updatedAt?: number; automation?: unknown; waitingOn?: { kind: string; ref: string | null; text: string | null } | null };
type GatewayRecord = { id: string; threadId: string | null; createdAt: number; input?: { label?: string; name?: string } };

/** Open agent tasks linked to the conversation: not the user's own to-dos, not automation runs or their findings. */
export function openAgentTasks(db: Database.Database, threadId: string): (OpenTask & { waitingOn: TaskRecord["waitingOn"] })[] {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get()) return [];
  return (db.prepare("SELECT record FROM tasks WHERE conversation = ? AND closed_at IS NULL ORDER BY updated_at DESC LIMIT 60").all(threadId) as TaskRow[])
    .map((row) => { try { return JSON.parse(row.record) as TaskRecord; } catch { return null; } })
    .filter((task): task is TaskRecord => !!task && !!task.title && task.owner !== USER_OWNER && !task.automation && !task.id.startsWith("task_auto-") && !task.id.startsWith("loop_"))
    .map((task) => ({ id: task.id, title: task.title!, updatedAt: task.updatedAt ?? 0, waitingOn: task.waitingOn ?? null }));
}

/** A pending BB interaction as an ask: an approval with BB's choices, or a question by its first prompt. */
export function askOf(interaction: Interaction & { createdAt?: number }, threadId: string, strandId: string | null): AskSignal {
  if (isWorkerApproval(interaction)) return { id: interaction.id, kind: "approval", strandId, threadId, label: `Approve: ${shortApproval(interaction)}`, details: approvalLines(interaction), decisions: approvalDecisions(interaction) };
  const questions = (interaction.payload as { questions?: { prompt?: string; shortLabel?: string }[] } | null | undefined)?.questions;
  const prompt = questions?.[0]?.shortLabel?.trim() || questions?.[0]?.prompt?.trim();
  return { id: interaction.id, kind: "question", strandId, threadId, label: prompt ? (prompt.length > 120 ? `${prompt.slice(0, 119)}…` : prompt) : "A question is waiting", details: [], decisions: [] };
}

/** A failed backfill waits this long before the next try, twice as long each time, up to an hour. */
export const BACKFILL_RETRY_MS = 5 * 60 * 1000;
export const BACKFILL_RETRY_MAX_MS = 60 * 60 * 1000;

/** How long a worker whose spawn wasn't found yet waits before it is looked up again, and how many workers' spawn turns are kept. */
export const SPAWN_MISS_MS = 60_000;
export const SPAWN_CACHE = 500;

/** Only conversations active this recently are backfilled. */
export const BACKFILL_ACTIVE_MS = 14 * 24 * 60 * 60 * 1000;

export class StrandService {
  readonly store: StrandStore;
  readonly detector: StrandDetector;
  private readonly backfillWanted = new Set<string>();
  /** Conversations whose backfill failed: not tried again until `until` (5 minutes, doubling up to an hour). */
  private readonly backfillFailed = new Map<string, { until: number; delay: number }>();
  private backfilling: Promise<void> | null = null;
  /** The turn that started each worker, once looked up; a miss (null) is kept for SPAWN_MISS_MS, then looked up again. At most SPAWN_CACHE workers. */
  private readonly spawnTurns = new Map<string, { turnId: string | null; at: number }>();
  /** Workers whose strand Jev is choosing now (one call at a time per worker). */
  private readonly choosing = new Set<string>();
  /** After a reload the old instance's database is closed: nothing new starts, and work in flight ends quietly. */
  private disposed = false;

  constructor(private readonly deps: StrandServiceDeps) {
    this.store = new StrandStore(deps.db, deps.now);
    this.detector = new StrandDetector({
      ...deps, store: this.store, openTasks: (threadId) => openAgentTasks(deps.db, threadId),
      workerStrand: async (threadId, workerThreadId) => {
        const worker = (await deps.workers(threadId).catch(() => [] as WorkerFact[])).find((each) => each.threadId === workerThreadId);
        return worker ? await this.workerStrand(threadId, worker, false) : undefined;
      },
    });
  }

  private now() { return this.deps.now?.() ?? Date.now(); }
  enabled(threadId: string): boolean { return !!this.deps.conversation(threadId); }

  // ---- events ----

  /** A turn finished (or failed): sort it, or backfill first if the conversation never was. `settled`: BB said the thread is idle or failed. */
  async idle(threadId: string, settled = false): Promise<void> {
    if (this.disposed || !this.enabled(threadId)) return;
    if (this.detector.needsBackfill(threadId)) { await this.requestBackfill(threadId, true); return; }
    await this.detector.idle(threadId, settled);
  }

  /**
   * Asks for a conversation's backfill (it was opened, or a turn just ended:
   * `active`). Only one active in the last 14 days; one at a time, the most
   * recently active first. Resolves when the queue it joined is done.
   */
  requestBackfill(threadId: string, active = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const conversation = this.deps.conversation(threadId);
    if (!conversation || !this.detector.needsBackfill(threadId)) return Promise.resolve();
    if (!active && this.now() - conversation.lastActiveAt > BACKFILL_ACTIVE_MS) return Promise.resolve();
    const failed = this.backfillFailed.get(threadId);
    if (failed && this.now() < failed.until) return Promise.resolve();
    this.backfillWanted.add(threadId);
    this.backfilling ??= this.drain().finally(() => { this.backfilling = null; });
    return this.backfilling;
  }

  private async drain(): Promise<void> {
    while (!this.disposed && this.backfillWanted.size) {
      const next = [...this.backfillWanted].sort((a, b) => (this.deps.conversation(b)?.lastActiveAt ?? 0) - (this.deps.conversation(a)?.lastActiveAt ?? 0))[0]!;
      this.backfillWanted.delete(next);
      try {
        await this.detector.backfill(next);
        this.backfillFailed.delete(next);
        await this.detector.idle(next);
      } catch (error) {
        if (this.disposed) return;
        if (!this.detector.needsBackfill(next)) continue;
        // Wait before trying again (the host may be down); say so once, not on every open, signal and poll.
        const before = this.backfillFailed.get(next);
        const delay = before ? Math.min(before.delay * 2, BACKFILL_RETRY_MAX_MS) : BACKFILL_RETRY_MS;
        this.backfillFailed.set(next, { until: this.now() + delay, delay });
        if (!before) this.deps.log(`Strands: backfill of ${next} failed (${error instanceof Error ? error.message : String(error)}); trying again later, waiting longer each time.`);
      }
    }
  }
  active(threadId: string): void { if (!this.disposed && this.enabled(threadId) && !this.detector.needsBackfill(threadId)) this.detector.active(threadId); }
  async asked(threadId: string): Promise<void> { if (!this.disposed && this.enabled(threadId) && !this.detector.needsBackfill(threadId)) await this.detector.asked(threadId); }
  forget(threadId: string): void { if (!this.disposed) this.store.forget(threadId); }


  dispose(): void { this.disposed = true; this.backfillWanted.clear(); this.detector.dispose(); }

  // ---- reads ----

  /** The live signals for one conversation, each joined to its strand. */
  async signals(threadId: string): Promise<Signals> {
    const now = this.now();
    const [busy, workerFacts, interactions] = await Promise.all([
      this.deps.busy(threadId).catch(() => false),
      this.deps.workers(threadId).catch(() => [] as WorkerFact[]),
      this.deps.interactions(threadId).catch(() => []),
    ]);
    const runningStrandId = busy ? this.detector.runningStrand(threadId) : null;
    const workers: WorkerSignal[] = await mapPool(workerFacts, 6, async (worker) => ({
      ...worker,
      strandId: await this.workerStrand(threadId, worker, busy),
    }));
    const turnStrand = (at: number) => (busy && this.detector.hasRunningTurn(threadId) ? runningStrandId : this.store.strandAt(threadId, at)?.strandId ?? null);
    // The turn an ask waits in: the running turn, else the newest sorted one at or before it.
    const turnOf = (at: number) => {
      const seq = busy && this.detector.hasRunningTurn(threadId) ? this.detector.runningSeq(threadId) : this.store.strandAt(threadId, at)?.seq ?? null;
      if (seq === null) return null;
      return (this.store.item(threadId, "user", seq) ?? this.store.item(threadId, "report", seq))?.turnId ?? null;
    };
    const asks: AskSignal[] = interactions.map((ask) => ({ ...askOf(ask, threadId, turnStrand(ask.createdAt ?? now)), turnId: turnOf(ask.createdAt ?? now) }));
    // A worker that needs the user: what it waits on, with its approval's choices.
    const needsYouWorkers = workers.filter((each) => each.status === "needs-you");
    const workerAsks = await mapPool(needsYouWorkers, 6, async (worker) => {
      const pending = await this.deps.interactions(worker.threadId).catch(() => []);
      return pending.map((ask) => ({ ...askOf(ask, worker.threadId, worker.strandId), label: `${worker.title}: ${askOf(ask, worker.threadId, null).label}` }));
    });
    for (const group of workerAsks) asks.push(...group);
    for (const request of this.gatewayRequests()) {
      const worker = workers.find((each) => each.threadId === request.threadId);
      const label = `Add MCP server: ${request.input?.label ?? request.input?.name ?? "a server"}`;
      if (request.threadId === threadId) asks.push({ id: request.id, kind: "gateway", strandId: turnStrand(request.createdAt), label, threadId, details: [], decisions: [] });
      else if (worker) asks.push({ id: request.id, kind: "gateway", strandId: worker.strandId, label: `${worker.title}: ${label}`, threadId: worker.threadId, details: [], decisions: [] });
    }
    // An area's item that needs the user, or the conversation's flag: on the strand of the turn it was raised in.
    for (const ask of this.deps.extraAsks?.(threadId) ?? []) asks.push({ id: ask.id, kind: ask.kind, strandId: turnStrand(ask.at), label: ask.label, threadId, details: [], decisions: [], turnId: turnOf(ask.at) });
    // A reply that asks the user something, until they answer in its strand or mark it done.
    for (const reply of this.store.openReplies(threadId, now - REPLY_OPEN_MS)) {
      asks.push({ id: `reply:${reply.seq}`, kind: "reply", strandId: reply.strandId, label: reply.ask ?? "A reply needs you", threadId, details: [], decisions: [], turnId: reply.turnId, seq: reply.seq });
    }
    const tasks: TaskSignal[] = openAgentTasks(this.deps.db, threadId).flatMap((task) => {
      const strand = this.store.byTask(task.id);
      return strand ? [{ id: task.id, strandId: strand.id, waitingOn: task.waitingOn ?? null }] : [];
    });
    return { now, busy, runningStrandId, workers, asks, tasks };
  }

  /**
   * A worker's strand: the strand of the turn that started it, a link read
   * from the conversation (the spawn's item names the worker), kept once that
   * turn is sorted. A turn about more than one strand asks Jev which one the
   * worker's task is. While that turn isn't sorted yet, none, and nothing is
   * kept. When no item names it (an older BB, a worker started elsewhere),
   * the newest sorted message at or before its start, as before.
   */
  private async workerStrand(threadId: string, worker: WorkerFact, busy: boolean): Promise<string | null> {
    const kept = this.store.db.prepare("SELECT strand_id FROM strand_items WHERE thread_id = ? AND kind = 'worker' AND ref = ? LIMIT 1").get(threadId, worker.threadId) as { strand_id: string | null } | undefined;
    if (kept) return kept.strand_id;
    const cached = this.spawnTurns.get(worker.threadId);
    // Found, or not found once the conversation was idle (no item will name it), is kept; a miss while busy only for a while.
    let turnId = cached && (cached.turnId !== null || !busy || this.now() - cached.at < SPAWN_MISS_MS) ? cached.turnId : undefined;
    if (turnId === undefined) {
      // A read that failed isn't a miss: nothing is kept, and the next read looks again.
      try { turnId = await this.detector.spawnTurn(threadId, worker.threadId, worker.createdAt); } catch { return null; }
      // A miss while its turn may still be writing is looked up again after a while, not on every read.
      this.spawnTurns.delete(worker.threadId);
      this.spawnTurns.set(worker.threadId, { turnId, at: this.now() });
      while (this.spawnTurns.size > SPAWN_CACHE) this.spawnTurns.delete(this.spawnTurns.keys().next().value!);
    }
    if (turnId) {
      const head = this.store.byTurn(threadId, turnId);
      if (!head) return busy && this.detector.hasRunningTurn(threadId) ? this.detector.runningStrand(threadId) : null;
      // A turn about two strands, with richer sorting: Jev picks the worker's (one call at a time per worker, in the background); until then the turn's main strand, not kept.
      if (head.strandId && head.also.length && this.deps.richSorting?.()) {
        if (!this.choosing.has(worker.threadId)) {
          this.choosing.add(worker.threadId);
          const found = turnId;
          void this.detector.workerChoice(threadId, worker.title, [head.strandId, ...head.also])
            .then((strandId) => {
              if (this.disposed || this.store.item(threadId, "worker", head.seq, worker.threadId)) return;
              this.store.put({ threadId, seq: head.seq, kind: "worker", ref: worker.threadId, turnId: found, at: worker.createdAt, line: worker.title, strandId, confidence: null, by: "inherit" });
              this.deps.changed(threadId);
            })
            .catch((error) => this.deps.log(`Strands: choosing a worker's strand failed: ${error instanceof Error ? error.message : String(error)}`))
            .finally(() => this.choosing.delete(worker.threadId));
        }
        return head.strandId;
      }
      this.store.put({ threadId, seq: head.seq, kind: "worker", ref: worker.threadId, turnId, at: worker.createdAt, line: worker.title, strandId: head.strandId, confidence: null, by: "inherit" });
      return head.strandId;
    }
    const at = this.store.strandAt(threadId, worker.createdAt);
    if (!at) return null;
    const later = this.store.db.prepare("SELECT 1 FROM strand_items WHERE thread_id = ? AND kind IN ('user', 'report') AND at > ? LIMIT 1").get(threadId, worker.createdAt);
    if (busy && !later) return this.detector.hasRunningTurn(threadId) ? this.detector.runningStrand(threadId) : null;
    this.store.put({ threadId, seq: at.seq, kind: "worker", ref: worker.threadId, turnId: null, at: worker.createdAt, line: worker.title, strandId: at.strandId, confidence: null, by: "inherit" });
    return at.strandId;
  }

  private gatewayRequests(): GatewayRecord[] {
    if (!this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tool_gateway_requests'").get()) return [];
    return (this.store.db.prepare("SELECT record FROM tool_gateway_requests WHERE state = 'pending' ORDER BY created_at DESC LIMIT 50").all() as { record: string }[])
      .map((row) => { try { return JSON.parse(row.record) as GatewayRecord; } catch { return null; } })
      .filter((record): record is GatewayRecord => !!record?.threadId);
  }

  async list(threadId: string): Promise<StrandList> {
    const enabled = this.enabled(threadId);
    // Opened: backfill it in the background when it never was (and was active lately).
    if (enabled && this.detector.needsBackfill(threadId)) void this.requestBackfill(threadId).catch((error) => this.deps.log(`Strands: backfill of ${threadId}: ${error instanceof Error ? error.message : String(error)}`));
    const read = this.store.read(threadId);
    const backfill = read?.backfill ? (() => { try { return JSON.parse(read.backfill!) as { at?: number; messages?: number; sorted?: number }; } catch { return {}; } })() : null;
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const base = {
      threadId, enabled,
      backfill: { done: !!backfill, at: backfill?.at ?? null, messages: backfill?.messages ?? 0, sorted: backfill?.sorted ?? 0 },
      jevCallsToday: read?.day === day ? read.jevCalls : 0, jevDailyCap: JEV_DAILY_CAP,
    };
    const strands = enabled ? this.store.list(threadId) : [];
    if (!enabled) return { ...base, sortingTurn: false, strands: [], earlier: [], strayWorkers: [] };
    const signals = await this.signals(threadId);
    const strayWorkers = strayWorkersOf(signals);
    if (!strands.length) return { ...base, sortingTurn: false, strands: [], earlier: [], strayWorkers };
    const counts = this.store.counts(threadId);
    const rows = strands.map((strand) => ({ strand, live: liveState(strand, signals) }));
    const view = ({ strand, live }: { strand: Strand; live: ReturnType<typeof liveState> }): StrandView => {
      const latest = this.store.latest(strand.id, threadId);
      const first = this.store.first(strand.id, threadId, 1)[0] ?? null;
      const count = counts.get(strand.id);
      return {
        id: strand.id, title: strand.title, summary: strand.summary, named: strand.named, state: live.state, detail: live.detail,
        asks: live.asks.map(({ id, kind, threadId: askThread, label, details, decisions, turnId, seq }) => ({ id, kind, threadId: askThread, label, details, decisions, turnId: turnId ?? null, seq: seq ?? null })), workers: live.workers,
        lastAt: strand.lastAt, firstAt: first?.at ?? null, firstSeq: first?.seq ?? null, latestSeq: latest?.seq ?? null, latestTurnId: latest?.turnId ?? null, messages: count?.messages ?? 0, unsure: count?.unsure ?? 0,
        pinned: strand.pinned, origin: strand.origin, taskId: strand.taskId, parentId: strand.parentId, trunk: strand.trunk,
      };
    };
    const ordered = byState(rows);
    return {
      ...base,
      sortingTurn: !!signals.busy && this.detector.hasRunningTurn(threadId) && !this.detector.runningStrand(threadId),
      strands: ordered.filter((row) => !row.live.earlier).map(view),
      earlier: ordered.filter((row) => row.live.earlier).map(view),
      strayWorkers,
    };
  }

  items(threadId: string, limit: number): StrandItemView[] {
    if (!this.enabled(threadId)) return [];
    return this.store.items(threadId, limit, ["user", "report", "worker"]).map(({ quiet: _quiet, ...item }) => ({ ...item }));
  }

  tags(threadId: string): { tags: { turnId: string; seq: number; strandId: string | null; kind: "user" | "report"; at: number | null; line: string | null; also: string[] }[]; strands: { id: string; title: string; done: boolean; parentId: string | null; trunk: boolean }[]; replies: ReplyTagView[]; opening: { seq: number; replySeq: number | null } | null } {
    if (!this.enabled(threadId)) return { tags: [], strands: [], replies: [], opening: null };
    const rows = this.store.db.prepare("SELECT turn_id, seq, strand_id, kind, at, line, also_strands FROM strand_items WHERE thread_id = ? AND kind IN ('user', 'report') AND turn_id IS NOT NULL ORDER BY seq DESC LIMIT 2000").all(threadId) as { turn_id: string; seq: number; strand_id: string | null; kind: "user" | "report"; at: number | null; line: string | null; also_strands: string | null }[];
    const first = this.store.db.prepare("SELECT seq, turn_id FROM strand_items WHERE thread_id = ? AND kind IN ('user', 'report') AND turn_id IS NOT NULL ORDER BY seq LIMIT 1").get(threadId) as { seq: number; turn_id: string } | undefined;
    const alsoOf = (value: string | null): string[] => { try { const list = value ? JSON.parse(value) as unknown : []; return Array.isArray(list) ? list.filter((each): each is string => typeof each === "string") : []; } catch { return []; } };
    return {
      tags: rows.reverse().map((row) => ({ turnId: row.turn_id, seq: row.seq, strandId: row.strand_id, kind: row.kind, at: row.at, line: row.line, also: alsoOf(row.also_strands) })),
      strands: this.store.list(threadId).map((strand) => ({ id: strand.id, title: strand.title, done: strand.doneAt !== null, parentId: strand.parentId, trunk: strand.trunk })),
      replies: this.store.replies(threadId, this.now() - REPLY_OPEN_MS).flatMap((reply) => (reply.turnId && reply.tag ? [{ turnId: reply.turnId, seq: reply.seq, tag: reply.tag, ask: reply.ask, resolved: reply.resolved, line: reply.line }] : [])),
      opening: first ? { seq: first.seq, replySeq: this.store.replyOfTurn(threadId, first.turn_id)?.seq ?? null } : null,
    };
  }

  /**
   * The seq of the conversation's newest message that starts a turn (not a
   * cache keepalive, not a steer), read by type so a long turn's tool events
   * can't hide it; null when there is none or it can't be read.
   */
  async newestRequest(threadId: string): Promise<number | null> {
    const rows = await this.deps.events({ threadId, order: "desc", limit: 10, types: ["client/turn/requested"] }).catch(() => [] as EventRow[]);
    const request = rows.filter((row) => row.type === "client/turn/requested" && !isPingRequest(row.data) && (row.data as { target?: { kind?: string } } | undefined)?.target?.kind !== "steer")
      .sort((x, y) => (y.seq ?? 0) - (x.seq ?? 0))[0];
    return request?.seq ?? null;
  }

  /** The user marked a reply that needs them done. */
  resolveReply(threadId: string, seq: number): boolean {
    if (!this.enabled(threadId) || !this.store.resolveReply(threadId, seq)) return false;
    this.deps.changed(threadId);
    return true;
  }

  /**
   * Whether a turn's reply is worth a phone push (Main's own push and Studio
   * Mobile's check of BB's): the turn `requestSeq` started (by default the
   * newest, read once when called, so a later turn's tag is never taken),
   * once Jev tagged its reply, waiting up to `waitMs` for the sort. Unknown
   * where strands don't run, when the turn or its reply can't be found, when
   * Jev couldn't tag it, or when it isn't tagged in time: the caller pushes
   * as before.
   */
  async replyPush(threadId: string, waitMs = 20_000, requestSeq?: number | null): Promise<{ decision: "push" | "quiet" | "unknown"; ask: string | null }> {
    const unknown = { decision: "unknown" as const, ask: null };
    if (this.disposed || !this.enabled(threadId) || this.detector.needsBackfill(threadId)) return unknown;
    const deadline = this.now() + waitMs;
    const request = requestSeq ?? await this.newestRequest(threadId);
    if (!request) return unknown;
    for (;;) {
      await Promise.race([this.detector.settled(threadId), new Promise((resolve) => { const timer = setTimeout(resolve, Math.max(0, Math.min(1_000, deadline - this.now()))); (timer as { unref?: () => void }).unref?.(); })]);
      const turn = this.store.turnOfRequest(threadId, request);
      const reply = turn?.turnId ? this.store.replyOfTurn(threadId, turn.turnId) : null;
      if (reply?.by === "none") return unknown;
      if (reply?.tag) return reply.tag === "needs-you" ? { decision: "push", ask: reply.ask } : { decision: "quiet", ask: null };
      if (this.disposed || this.now() >= deadline) return unknown;
      await new Promise((resolve) => { const timer = setTimeout(resolve, 250); (timer as { unref?: () => void }).unref?.(); });
    }
  }

  /**
   * The needs-you push's read (src/strands/push.ts), kept cheap because it
   * runs every few minutes around the clock: only conversations active since
   * `since` that have a strand not marked done (a strand_note done with no
   * activity after it), each read live. `checked` names the conversations it
   * read, so the push keeps what it knew about the others.
   */
  async needsYouCheck(botId: string, since: number): Promise<{ conversations: OverviewConversation[]; checked: string[] }> {
    return this.read(botId, since, (strand) => strand.doneAt === null || strand.lastAt > strand.doneAt);
  }

  private async read(botId: string, since: number, open: (strand: Strand) => boolean): Promise<{ conversations: OverviewConversation[]; checked: string[] }> {
    const candidates = (await this.deps.conversationsOf(botId))
      .filter((conversation) => conversation.lastActiveAt >= since && this.store.list(conversation.threadId).some(open))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    const lists = await mapPool(candidates, 6, (conversation) => this.list(conversation.threadId));
    const conversations: OverviewConversation[] = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const list = lists[i]!;
      if (list.strands.length) conversations.push({ ...candidates[i]!, strands: list.strands });
    }
    return { conversations, checked: candidates.map((conversation) => conversation.threadId) };
  }

  // ---- the user's edits: their choice always wins ----

  /** A strand of a conversation strands run in, else null. */
  private own(strandId: string): ReturnType<StrandStore["get"]> {
    const strand = this.store.get(strandId);
    return strand && !strand.mergedInto && this.enabled(strand.threadId) ? strand : null;
  }

  /** Moves a message's turn to another strand of the same conversation. */
  move(threadId: string, seq: number, strandId: string): boolean {
    const to = this.own(strandId);
    if (!to || to.threadId !== threadId || !this.store.item(threadId, "user", seq) && !this.store.item(threadId, "report", seq)) return false;
    this.store.moveTurn(threadId, seq, to.id);
    this.deps.changed(threadId);
    return true;
  }

  /** New strand from here: this turn and the later ones in its strand. Named like any new strand (the user can rename it). */
  split(threadId: string, seq: number): string | null {
    if (!this.enabled(threadId)) return null;
    const head = this.store.item(threadId, "user", seq) ?? this.store.item(threadId, "report", seq);
    if (!head) return null;
    const strand = this.store.create({ threadId, title: firstLineTitle(head.line ?? ""), origin: "user", seq, at: head.at });
    this.store.moveTurn(threadId, seq, strand.id, !!head.strandId);
    this.detector.nameSoon(threadId);
    this.deps.changed(threadId);
    return strand.id;
  }

  /** Undoes a merge: the strand and its items come back. */
  unmerge(strandId: string): boolean {
    const strand = this.store.get(strandId);
    if (!strand?.mergedInto || !this.enabled(strand.threadId) || !this.store.unmerge(strand.id)) return false;
    this.deps.changed(strand.threadId);
    return true;
  }

  /** Undoes a message's last move: its turn goes back to the strand it was in. */
  unmove(threadId: string, seq: number): boolean {
    if (!this.enabled(threadId) || !this.store.unmoveTurn(threadId, seq)) return false;
    this.deps.changed(threadId);
    return true;
  }

  rename(strandId: string, title: string): boolean {
    const strand = this.own(strandId);
    const name = title.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!strand || !name) return false;
    this.store.rename(strand.id, name);
    this.deps.changed(strand.threadId);
    return true;
  }

  /**
   * strand_note: an agent marks a strand waiting on someone, done, or renamed.
   * `threadId` is the caller: a conversation, or a worker (its conversation's
   * strand that holds the worker). `strand` names one by id or title;
   * without it, the strand of the caller's newest turn (a worker's: the strand
   * that holds it). Returns what it did in a line, or throws a plain error.
   */
  note(threadId: string | null, input: { strand?: string; waitingOn?: string | null; done?: boolean; title?: string }): { strandId: string; title: string; line: string } {
    if (!threadId) throw new Error("strand_note works in a Bot's conversation or one of its workers.");
    const conversation = this.enabled(threadId) ? threadId : this.deps.conversationOfWorker?.(threadId) ?? null;
    if (!conversation || !this.enabled(conversation)) throw new Error("This thread has no strands: strand_note works in a Bot's conversation or one of its workers.");
    const open = this.store.list(conversation).filter((each) => !each.mergedInto);
    const wanted = input.strand?.trim();
    let strand = wanted ? open.find((each) => each.id === wanted) ?? open.find((each) => each.title.toLowerCase() === wanted.toLowerCase()) ?? null : null;
    if (wanted && !strand) throw new Error(`No strand ${JSON.stringify(wanted)} here. Strands: ${open.slice(0, 12).map((each) => `${each.title} (${each.id})`).join(", ") || "none yet"}.`);
    if (!strand && conversation !== threadId) {
      const held = this.store.db.prepare("SELECT strand_id FROM strand_items WHERE thread_id = ? AND kind = 'worker' AND ref = ? LIMIT 1").get(conversation, threadId) as { strand_id: string | null } | undefined;
      strand = held?.strand_id ? this.store.get(held.strand_id) : null;
    }
    if (!strand) {
      const newest = this.store.db.prepare("SELECT strand_id FROM strand_items WHERE thread_id = ? AND kind IN ('user', 'report') AND strand_id IS NOT NULL ORDER BY seq DESC LIMIT 1").get(conversation) as { strand_id: string } | undefined;
      strand = newest ? this.store.get(newest.strand_id) : null;
    }
    while (strand?.mergedInto) strand = this.store.get(strand.mergedInto);
    if (!strand) throw new Error("No strand to note yet: this conversation's turns aren't sorted into strands. Pass strand (its id or title) once one exists.");
    const now = this.now();
    const did: string[] = [];
    if (input.title !== undefined) {
      const name = input.title.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!name) throw new Error("title is empty.");
      if (this.store.titles(conversation, strand.id).some((each) => each.toLowerCase() === name.toLowerCase())) throw new Error(`Another strand here is called ${JSON.stringify(name)}.`);
      this.store.rename(strand.id, name);
      did.push(`renamed to ${JSON.stringify(name)}`);
    }
    if (input.waitingOn !== undefined || input.done !== undefined) this.store.note(strand.id, { ...(input.waitingOn !== undefined ? { waitingOn: input.waitingOn?.trim() || null } : {}), ...(input.done !== undefined ? { done: input.done } : {}) }, now);
    if (input.waitingOn !== undefined) did.push(input.waitingOn?.trim() ? `waiting on ${input.waitingOn.trim()} until its next activity` : "no longer waiting");
    if (input.done !== undefined) did.push(input.done ? "done: it folds into Earlier until its next activity" : "not done");
    if (!did.length) throw new Error("Say what to note: waitingOn, done or title.");
    this.deps.changed(conversation);
    const title = this.store.get(strand.id)?.title ?? strand.title;
    return { strandId: strand.id, title, line: `Strand ${JSON.stringify(title)} (${strand.id}): ${did.join("; ")}.` };
  }

  pin(strandId: string, pinned: boolean): boolean {
    const strand = this.own(strandId);
    if (!strand) return false;
    this.store.setPinned(strand.id, pinned);
    this.deps.changed(strand.threadId);
    return true;
  }

  merge(strandId: string, into: string): boolean {
    const from = this.own(strandId);
    const target = this.own(into);
    if (!from || !target || from.threadId !== target.threadId || !this.store.merge(from.id, target.id, true)) return false;
    this.deps.changed(from.threadId);
    return true;
  }

  opened(strandId: string): boolean {
    if (!this.store.get(strandId)) return false;
    this.store.opened(strandId);
    return true;
  }
}
