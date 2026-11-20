// Strands for Studio (phase 1: a Bot's Main, read-only): the detector fed
// from BB's thread events, the live signals each read is worked out from,
// and the RPCs the workbench tab, the composer strip and the message tags read.
import type Database from "better-sqlite3";
import { type StrandItemView, type StrandList, type StrandView } from "./contract";
import { JEV_DAILY_CAP, StrandDetector, type DetectorDeps, type OpenTask } from "./detector";
import { byState, liveState, type AskSignal, type Signals, type TaskSignal, type WorkerSignal, type WorkerStatus } from "./states";
import { StrandStore, type Strand } from "./store";
import { USER_OWNER } from "../tasks/contract";

export interface WorkerFact { threadId: string; title: string; status: WorkerStatus; createdAt: number; endedAt: number | null }

export interface StrandServiceDeps extends Omit<DetectorDeps, "store" | "openTasks"> {
  db: Database.Database;
  /** The conversations strands run in (phase 1: each Bot's Main). */
  conversations(): string[];
  /** The conversation's workers, with BB's status. */
  workers(threadId: string): Promise<WorkerFact[]>;
  /** Pending BB questions and approvals in a thread. */
  interactions(threadId: string): Promise<{ id: string; createdAt: number; label: string }[]>;
  /** Whether the thread is in a turn. */
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

export class StrandService {
  readonly store: StrandStore;
  readonly detector: StrandDetector;

  constructor(private readonly deps: StrandServiceDeps) {
    this.store = new StrandStore(deps.db, deps.now);
    this.detector = new StrandDetector({ ...deps, store: this.store, openTasks: (threadId) => openAgentTasks(deps.db, threadId) });
  }

  private now() { return this.deps.now?.() ?? Date.now(); }
  enabled(threadId: string): boolean { return this.deps.conversations().includes(threadId); }

  // ---- events ----

  /** A turn finished (or failed): backfill first if it never ran, then sort. */
  async idle(threadId: string): Promise<void> {
    if (!this.enabled(threadId)) return;
    if (this.detector.needsBackfill(threadId)) await this.detector.backfill(threadId);
    await this.detector.idle(threadId);
  }
  active(threadId: string): void { if (this.enabled(threadId) && !this.detector.needsBackfill(threadId)) this.detector.active(threadId); }
  async asked(threadId: string): Promise<void> { if (this.enabled(threadId) && !this.detector.needsBackfill(threadId)) await this.detector.asked(threadId); }
  forget(threadId: string): void { this.store.forget(threadId); }

  /** Backfills every enabled conversation that hasn't been, one at a time. */
  async backfillAll(): Promise<void> {
    for (const threadId of this.deps.conversations()) {
      if (!this.detector.needsBackfill(threadId)) continue;
      try { await this.detector.backfill(threadId); await this.detector.idle(threadId); } catch (error) { this.deps.log(`Strands: backfill of ${threadId} failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }

  dispose(): void { this.detector.dispose(); }

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
    const workers: WorkerSignal[] = workerFacts.map((worker) => ({ ...worker, strandId: this.workerStrand(threadId, worker, busy) }));
    const turnStrand = (at: number) => (busy && this.detector.hasRunningTurn(threadId) ? runningStrandId : this.store.strandAt(threadId, at)?.strandId ?? null);
    const asks: AskSignal[] = interactions.map((ask) => ({ id: ask.id, kind: "question", strandId: turnStrand(ask.createdAt), label: ask.label }));
    for (const request of this.gatewayRequests()) {
      const worker = workers.find((each) => each.threadId === request.threadId);
      if (request.threadId === threadId) asks.push({ id: request.id, kind: "gateway", strandId: turnStrand(request.createdAt), label: `Tool Gateway: ${request.input?.label ?? request.input?.name ?? "a server"}` });
      else if (worker) asks.push({ id: request.id, kind: "gateway", strandId: worker.strandId, label: `${worker.title}: Tool Gateway request` });
    }
    const tasks: TaskSignal[] = openAgentTasks(this.deps.db, threadId).flatMap((task) => {
      const strand = this.store.byTask(task.id);
      return strand ? [{ id: task.id, strandId: strand.id, waitingOn: task.waitingOn ?? null }] : [];
    });
    return { now, runningStrandId, workers, asks, tasks };
  }

  /**
   * A worker's strand: the turn it started in (its conversation's newest
   * sorted message at or before its start), kept once that turn is settled.
   * While the turn it started in is still running and unsorted, none.
   */
  private workerStrand(threadId: string, worker: WorkerFact, busy: boolean): string | null {
    const kept = this.store.db.prepare("SELECT strand_id FROM strand_items WHERE thread_id = ? AND kind = 'worker' AND ref = ? LIMIT 1").get(threadId, worker.threadId) as { strand_id: string | null } | undefined;
    if (kept) return kept.strand_id;
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
    const read = this.store.read(threadId);
    const backfill = read?.backfill ? (() => { try { return JSON.parse(read.backfill!) as { at?: number; messages?: number; sorted?: number }; } catch { return {}; } })() : null;
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const base = {
      threadId, enabled,
      backfill: { done: !!backfill, at: backfill?.at ?? null, messages: backfill?.messages ?? 0, sorted: backfill?.sorted ?? 0 },
      jevCallsToday: read?.day === day ? read.jevCalls : 0, jevDailyCap: JEV_DAILY_CAP,
    };
    const strands = this.store.list(threadId);
    if (!strands.length) return { ...base, sortingTurn: false, strands: [], earlier: [] };
    const signals = await this.signals(threadId);
    const counts = this.store.counts(threadId);
    const rows = strands.map((strand) => ({ strand, live: liveState(strand, signals) }));
    const view = ({ strand, live }: { strand: Strand; live: ReturnType<typeof liveState> }): StrandView => {
      const latest = this.store.latest(strand.id, threadId);
      const count = counts.get(strand.id);
      return {
        id: strand.id, title: strand.title, summary: strand.summary, named: strand.named, state: live.state, detail: live.detail, workers: live.workers,
        lastAt: strand.lastAt, latestSeq: latest?.seq ?? null, latestTurnId: latest?.turnId ?? null, messages: count?.messages ?? 0, unsure: count?.unsure ?? 0,
        pinned: strand.pinned, origin: strand.origin, taskId: strand.taskId,
      };
    };
    const ordered = byState(rows);
    return {
      ...base,
      sortingTurn: (await this.deps.busy(threadId).catch(() => false)) && this.detector.hasRunningTurn(threadId) && !this.detector.runningStrand(threadId),
      strands: ordered.filter((row) => !row.live.earlier).map(view),
      earlier: ordered.filter((row) => row.live.earlier).map(view),
    };
  }

  items(threadId: string, limit: number): StrandItemView[] {
    return this.store.items(threadId, limit, ["user", "report", "worker"]).map((item) => ({ ...item }));
  }

  tags(threadId: string): { tags: { turnId: string; strandId: string | null }[]; strands: { id: string; title: string }[] } {
    const rows = this.store.db.prepare("SELECT turn_id, strand_id FROM strand_items WHERE thread_id = ? AND kind IN ('user', 'report') AND turn_id IS NOT NULL ORDER BY seq DESC LIMIT 2000").all(threadId) as { turn_id: string; strand_id: string | null }[];
    return {
      tags: rows.map((row) => ({ turnId: row.turn_id, strandId: row.strand_id })),
      strands: this.store.list(threadId).map((strand) => ({ id: strand.id, title: strand.title })),
    };
  }

  opened(strandId: string): boolean {
    if (!this.store.get(strandId)) return false;
    this.store.opened(strandId);
    return true;
  }
}
