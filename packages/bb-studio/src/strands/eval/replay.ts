// Replays an eval conversation through the real StrandService, turn by turn,
// as BB would deliver it: each turn's events, then "idle", then a read of the
// strands (which links workers). Jev and the small model are passed in: a
// recorded set of answers in tests, a stand-in model when recording.
import type { DetectorDeps } from "../detector";
import { StrandService, type WorkerFact } from "../service";
import { database } from "../test/fixture";
import type { EventRow } from "../turns";
import type { EvalConversation, Filing } from "./types";

export interface ReplayDeps {
  jev: DetectorDeps["jev"];
  model: DetectorDeps["model"];
  completeText?: DetectorDeps["completeText"];
  /** The Studio setting strands_richSorting (off by default). */
  richSorting?: boolean;
  log?(message: string): void;
}

export interface ReplayResult extends Filing { service: StrandService; threadId: string }

const MINUTE = 60_000;

/** The conversation's events: each turn's request, start, a note of the workers it started, its reply, and its end. */
export function eventsOf(conversation: EvalConversation): { rows: EventRow[]; turnOf: Map<string, number>; requestSeq: Map<number, number>; ends: number[] } {
  const rows: EventRow[] = [];
  const turnOf = new Map<string, number>();
  const requestSeq = new Map<number, number>();
  const ends: number[] = [];
  const push = (row: Omit<EventRow, "seq">) => { rows.push({ ...row, seq: rows.length + 1 }); return rows.length; };
  conversation.turns.forEach((turn, index) => {
    const turnId = `turn_${index + 1}`;
    const next = conversation.turns[index + 1]?.at ?? turn.at + 10 * MINUTE;
    const end = Math.max(turn.at + 2, Math.min(next - 1, turn.at + 5 * MINUTE));
    turnOf.set(turnId, turn.seq);
    const input = [{ type: "text", text: turn.text }];
    requestSeq.set(turn.seq, push({ type: "client/turn/requested", createdAt: turn.at, scope: { kind: "thread" }, data: { initiator: turn.kind === "user" ? "user" : "system", input, target: { kind: "new-turn" } } }));
    push({ type: "turn/started", createdAt: turn.at, scope: { kind: "turn", turnId }, data: {} });
    // The workers this turn started: the spawn's tool output names each.
    for (const worker of conversation.workers.filter((each) => each.createdAt >= turn.at && each.createdAt < next)) {
      push({ type: "item/completed", createdAt: worker.createdAt, scope: { kind: "turn", turnId }, data: { item: { type: "commandExecution", command: "bb thread spawn", aggregatedOutput: `Spawned ${worker.id}` } } });
    }
    if (turn.reply) push({ type: "item/completed", createdAt: turn.at + 1, scope: { kind: "turn", turnId }, data: { item: { type: "agentMessage", text: turn.reply } } });
    if (turn.finalReply && turn.finalReply !== turn.reply && !turn.reply.includes(turn.finalReply)) push({ type: "item/completed", createdAt: end - 1, scope: { kind: "turn", turnId }, data: { item: { type: "agentMessage", text: turn.finalReply } } });
    push({ type: "turn/completed", createdAt: end, scope: { kind: "turn", turnId }, data: {} });
    ends.push(rows.length);
  });
  return { rows, turnOf, requestSeq, ends };
}

export async function replay(conversation: EvalConversation, deps: ReplayDeps): Promise<ReplayResult> {
  const threadId = conversation.id;
  const { rows, turnOf, requestSeq, ends } = eventsOf(conversation);
  let visible = 0;
  let now = conversation.turns[0]?.at ?? 0;
  let jevCalls = 0;
  let modelCalls = 0;
  const timers: { run: () => void; at: number }[] = [];
  const db = database();
  const service = new StrandService({
    db, now: () => now, log: deps.log ?? (() => {}), changed: () => {},
    events: async (input) => {
      if (input.threadId !== threadId) return [];
      const shown = rows.slice(0, visible).filter((row) => (!input.types || input.types.includes(row.type ?? "")) && (row.seq ?? 0) > (input.afterSeq ?? 0) && (row.seq ?? 0) < (input.beforeSeq ?? Number.MAX_SAFE_INTEGER));
      return (input.order === "asc" ? shown : shown.reverse()).slice(0, input.limit);
    },
    jev: async (input) => { jevCalls++; return deps.jev(input); },
    model: async (input) => { modelCalls++; return deps.model(input); },
    ...(deps.completeText ? { completeText: async (input: { prompt: string }) => { modelCalls++; return deps.completeText!(input); } } : {}),
    richSorting: () => !!deps.richSorting,
    conversation: (id) => (id === threadId ? { botId: "bot", lastActiveAt: now } : null),
    conversationsOf: async () => [{ threadId, title: conversation.title, isMain: false, lastActiveAt: now }],
    workers: async () => conversation.workers.filter((worker) => worker.createdAt <= now).map((worker): WorkerFact => ({ threadId: worker.id, title: worker.title, status: "done", createdAt: worker.createdAt, endedAt: null })),
    interactions: async () => [],
    busy: async () => false,
    setTimer: (run, ms) => { const timer = { run, at: now + ms }; timers.push(timer); return timer; },
    clearTimer: (handle) => { const at = timers.indexOf(handle as (typeof timers)[number]); if (at >= 0) timers.splice(at, 1); },
  });
  // Live sorting from the window's start, no backfill.
  service.store.saveRead(threadId, { seenSeq: 0, backfill: JSON.stringify({ at: now, eval: true }) });
  // Workers started before the window: their strands were there already (named as labeled), holding them.
  const seeded = new Map<string, string>();
  for (const worker of conversation.workers) {
    if (!worker.strand) continue;
    let strandId = seeded.get(worker.strand);
    if (!strandId) {
      const label = conversation.strands.find((strand) => strand.key === worker.strand);
      strandId = service.store.create({ threadId, title: label?.title ?? worker.strand, named: true, origin: "jev", seq: null, at: worker.createdAt }).id;
      seeded.set(worker.strand, strandId);
    }
    service.store.put({ threadId, seq: 0, kind: "worker", ref: worker.id, turnId: null, at: worker.createdAt, line: worker.title, strandId, confidence: null, by: "inherit" });
  }
  const runTimers = async () => {
    for (let guard = 0; guard < 20; guard++) {
      const due = timers.filter((timer) => timer.at <= now);
      if (!due.length) return;
      for (const timer of due) { timers.splice(timers.indexOf(timer), 1); timer.run(); }
      await service.detector.settled(threadId);
    }
  };
  for (const [index, turn] of conversation.turns.entries()) {
    visible = ends[index]!;
    now = (rows[visible - 1]?.createdAt ?? turn.at) + 1;
    await service.idle(threadId, true);
    await service.detector.settled(threadId);
    await service.list(threadId);
    await runTimers();
  }
  now += 10 * MINUTE;
  await runTimers();

  const bySeq = new Map<number, string[] | null>();
  const seqByRequest = new Map([...requestSeq].map(([seq, request]) => [request, seq]));
  for (const turn of conversation.turns) {
    const request = requestSeq.get(turn.seq)!;
    const item = service.store.item(threadId, turn.kind, request) ?? service.store.item(threadId, turn.kind === "user" ? "report" : "user", request);
    // `also`: the strands a message is also about, where the sorter has them.
    const also = (item as { also?: string[] } | null)?.also ?? [];
    bySeq.set(turn.seq, item ? (item.strandId ? [item.strandId, ...also] : []) : null);
  }
  const strands = service.store.db.prepare("SELECT * FROM strands WHERE thread_id = ? AND merged_into IS NULL").all(threadId) as { id: string; parent_id?: string | null; kind?: string | null }[];
  const trunk = new Set(strands.filter((strand) => strand.kind === "trunk").map((strand) => strand.id));
  const parents = new Map(strands.filter((strand) => strand.parent_id).map((strand) => [strand.id, strand.parent_id!]));
  const askedTurns = new Set<number>();
  for (const reply of service.store.replies(threadId, 0)) {
    const seq = reply.tag === "needs-you" && reply.turnId ? turnOf.get(reply.turnId) : undefined;
    if (seq !== undefined) askedTurns.add(seq);
  }
  const openAsks = new Set<number>();
  for (const reply of service.store.openReplies(threadId, 0)) {
    const seq = reply.turnId ? turnOf.get(reply.turnId) : undefined;
    if (seq !== undefined) openAsks.add(seq);
  }
  void seqByRequest;
  return { service, threadId, bySeq, trunk, parents, askedTurns, openAsks, jevCalls, modelCalls };
}
