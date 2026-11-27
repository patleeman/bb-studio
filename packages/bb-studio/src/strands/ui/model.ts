// What the strands UI shows, as pure functions (design dsn_398fde78c3b1f6b8,
// screen 4a): text only, neutral marks, amber only for "needs you".
import type { ReplyTagView, StrandAsk, StrandList, StrandView } from "../contract";

type TagReply = Omit<ReplyTagView, "line"> & { line?: string | null };
export type Tags = { tags: readonly { turnId: string; seq: number; strandId: string | null; kind?: "user" | "report"; at?: number | null; line?: string | null }[]; strands: readonly { id: string; title: string; done?: boolean; parentId?: string | null }[]; replies?: readonly TagReply[]; opening?: { seq: number; replySeq: number | null } | null };

/** A run of status replies shorter than this stays open. */
export const RUN_MIN = 3;

/** One run of status replies folded into one line (BB's timeline folds, slots.experimental_timelineFilter's `folds`). */
export interface StatusRunFold {
  id: string;
  turnIds: string[];
  label: string;
  /** The line when BB folds only some of the run's turns (it cut the run short): their count and the last one's line. */
  labelFor(turnIds: readonly string[]): string;
}

const runLabel = (count: number, last: string | null) => `${count} updates${last ? ` · last: ${last}` : ""}`;

/**
 * The conversation's runs of status replies to fold: consecutive turns whose
 * replies Jev tagged status, with no message the user typed between them (a
 * turn the user started may open a run: its message stays, its reply folds).
 * A reply that needs the user, or one with no tag, ends a run; runs shorter
 * than RUN_MIN stay open; the newest turn never folds, so the newest reply
 * always shows. `openTurns`: the turns of the runs the user opened; a run
 * holding any of them stays open, even when a late tag moves where it starts.
 */
export function statusRunFolds(tags: Tags | null | undefined, openTurns: ReadonlySet<string> = new Set()): StatusRunFold[] {
  if (!tags?.replies?.length) return [];
  const replies = new Map(tags.replies.map((reply) => [reply.turnId, reply]));
  const runs: { turnId: string; line: string | null }[][] = [];
  let run: { turnId: string; line: string | null }[] = [];
  const close = () => { if (run.length >= RUN_MIN) runs.push(run); run = []; };
  for (const turn of tags.tags.slice(0, -1)) {
    if ((turn.kind ?? "user") === "user") close();
    const reply = replies.get(turn.turnId);
    if (reply?.tag === "status") run.push({ turnId: turn.turnId, line: reply.line ?? null });
    else close();
  }
  close();
  return runs
    .map((each): StatusRunFold => {
      const lines = new Map(each.map((turn) => [turn.turnId, turn.line]));
      return {
        id: `run:${each[0]!.turnId}`,
        turnIds: each.map((turn) => turn.turnId),
        label: runLabel(each.length, each.at(-1)!.line),
        labelFor: (turnIds) => runLabel(turnIds.length, lines.get(turnIds.at(-1) ?? "") ?? null),
      };
    })
    .filter((fold) => !fold.turnIds.some((turnId) => openTurns.has(turnId)));
}

/** The fold that holds message `seq` (a message's or a reply's seq: the turn it falls in), or null. */
export function foldOfSeq(tags: Tags | null | undefined, folds: readonly StatusRunFold[], seq: number): StatusRunFold | null {
  let turnId: string | null = null;
  for (const turn of tags?.tags ?? []) { if (turn.seq <= seq) turnId = turn.turnId; else break; }
  return turnId ? folds.find((fold) => fold.turnIds.includes(turnId!)) ?? null : null;
}

/** A turn's reply tag: needs-you (still open, or answered) or status; null when it has none. */
export function replyOf(tags: Tags | null | undefined, turnId: string | null): TagReply | null {
  if (!tags?.replies || !turnId) return null;
  for (let index = tags.replies.length - 1; index >= 0; index--) if (tags.replies[index]!.turnId === turnId) return tags.replies[index]!;
  return null;
}

/** A needs-you strand's reply ask, when that's what it waits on first: its message is where picking it goes. */
export function replyAskOf(strand: Pick<StrandView, "state" | "asks">): (StrandAsk & { seq: number }) | null {
  const ask = strand.state === "needs-you" ? strand.asks[0] : undefined;
  return ask?.kind === "reply" && ask.seq !== null ? ask as StrandAsk & { seq: number } : null;
}

/** A message's tag: its turn's strand, and whether a divider goes above it (the strand changed since the last sorted turn). */
export function tagOf(tags: Tags | null | undefined, turnId: string | null): { strandId: string; title: string; divider: boolean; seq: number } | null {
  if (!tags || !turnId) return null;
  const at = tags.tags.findIndex((tag) => tag.turnId === turnId);
  const tag = at >= 0 ? tags.tags[at] : undefined;
  if (!tag?.strandId) return null;
  const title = tags.strands.find((strand) => strand.id === tag.strandId)?.title;
  if (!title) return null;
  let before: string | null = null;
  for (let index = at - 1; index >= 0; index--) { const strandId = tags.tags[index]!.strandId; if (strandId) { before = strandId; break; } }
  return { strandId: tag.strandId, title, divider: before !== tag.strandId, seq: tag.seq };
}

/** The strand's messages (each sorted turn's first seq), oldest first, for stepping through it. */
export function seqsOf(tags: Tags | null | undefined, strandId: string): number[] {
  return (tags?.tags ?? []).filter((tag) => tag.strandId === strandId).map((tag) => tag.seq);
}

/** One message on from `current` (a seq) in `seqs`: -1 older, 1 newer; from nothing, the newest. */
export function stepSeq(seqs: readonly number[], current: number | null, by: -1 | 1): number | null {
  if (!seqs.length) return null;
  if (current === null) return seqs.at(-1)!;
  const at = seqs.indexOf(current);
  if (at < 0) return by < 0 ? [...seqs].reverse().find((seq) => seq < current) ?? seqs[0]! : seqs.find((seq) => seq > current) ?? seqs.at(-1)!;
  return seqs[Math.max(0, Math.min(seqs.length - 1, at + by))]!;
}

/** How many strands are in each live state, for the line's counts. */
export function countsOf(list: StrandList | null | undefined): { needs: number; running: number; finished: number; waiting: number; open: number; quiet: number } {
  const counts = { needs: 0, running: 0, finished: 0, waiting: 0, open: 0, quiet: 0 };
  for (const strand of list?.strands ?? []) {
    if (strand.state === "needs-you") counts.needs++;
    else if (strand.state === "running") counts.running++;
    else if (strand.state === "done-unseen") counts.finished++;
    else if (strand.state === "waiting") counts.waiting++;
    else if (strand.state === "quiet") counts.quiet++;
    else counts.open++;
  }
  return counts;
}

/** Whether anything is open: a strand that isn't quiet. With none, the line takes no space. */
export const hasOpen = (list: StrandList | null | undefined) => (list?.strands ?? []).some((strand) => strand.state !== "quiet") || !!list?.strayWorkers?.length;

/** Done workers stay on their strand's row this long, failed ones this long (as the sidebar lists them). */
export const ROW_DONE_MS = 2 * 24 * 60 * 60 * 1000;
export const ROW_FAILED_MS = 7 * 24 * 60 * 60 * 1000;

const WORKER_RANK: Record<StrandView["workers"][number]["status"], number> = { "needs-you": 0, running: 1, failed: 2, done: 3 };

/** A strand's workers for its row in the box: waiting on you and running ones always, failed ones for 7 days, finished ones for 2; in that order, newest first. */
export function rowWorkersOf(strand: Pick<StrandView, "workers">, now: number): StrandView["workers"] {
  return strand.workers
    .filter((worker) => worker.status === "running" || worker.status === "needs-you"
      || (worker.status === "done" && (worker.endedAt === null || now - worker.endedAt < ROW_DONE_MS))
      || (worker.status === "failed" && (worker.endedAt === null || now - worker.endedAt < ROW_FAILED_MS)))
    .sort((a, b) => WORKER_RANK[a.status] - WORKER_RANK[b.status] || (b.endedAt ?? 0) - (a.endedAt ?? 0));
}

/** The workers no strand holds, counted for the line: waiting on you, running, failed. */
export function strayCountsOf(list: StrandList | null | undefined): { needs: number; running: number; failed: number } {
  const counts = { needs: 0, running: 0, failed: 0 };
  for (const worker of list?.strayWorkers ?? []) {
    if (worker.status === "needs-you") counts.needs++;
    else if (worker.status === "running") counts.running++;
    else if (worker.status === "failed") counts.failed++;
  }
  return counts;
}

/** The line's strand: the selected one, else the one the newest sorted message is in. */
export function currentOf(list: StrandList | null | undefined, selection: { strandId: string } | null): StrandView | null {
  const strands = list?.strands ?? [];
  if (selection) { const chosen = [...strands, ...(list?.earlier ?? [])].find((strand) => strand.id === selection.strandId); if (chosen) return chosen; }
  return strands.reduce<StrandView | null>((best, strand) => (strand.latestSeq !== null && (best?.latestSeq ?? -1) < strand.latestSeq ? strand : best), null);
}

export const GROUPS: readonly { label: string; states: readonly StrandView["state"][] }[] = [
  { label: "Needs you", states: ["needs-you"] },
  { label: "Running", states: ["running"] },
  { label: "Finished", states: ["done-unseen"] },
  { label: "Waiting on someone else", states: ["waiting"] },
  { label: "Open", states: ["active"] },
  { label: "Quiet", states: ["quiet"] },
];

/** The workbench tab's groups, in order, empty ones left out. */
export function groupsOf(list: StrandList | null | undefined): { label: string; strands: StrandView[] }[] {
  return GROUPS.map((group) => ({ label: group.label, strands: (list?.strands ?? []).filter((strand) => group.states.includes(strand.state)) })).filter((group) => group.strands.length);
}

/** How long ago, in the strip's few characters: "5m", "3h", "2 days". */
export function ageOf(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/** An approval's buttons, in BB's words and order (Approve first). */
export function decisionButtons(ask: StrandAsk): { decision: StrandAsk["decisions"][number]; label: string; primary: boolean }[] {
  const label = { allow_once: "Approve", allow_for_session: "Always allow", deny: "Deny" } as const;
  const order = ["allow_once", "allow_for_session", "deny"] as const;
  return order.filter((decision) => ask.decisions.includes(decision)).map((decision) => ({ decision, label: label[decision], primary: decision === "allow_once" }));
}

/** Whether the strands strip takes the In flight strip's place in this conversation. */
export const stripShown = (list: StrandList | null | undefined) => !!list?.enabled && (list.strands.length > 0 || !!list.strayWorkers?.length);

/** A strand's turns and its first message, from the conversation's tags (the newest 2,000 sorted turns). */
export function turnsOfStrand(tags: Tags | null | undefined, strandId: string): { turnIds: string[]; firstSeq: number | null } {
  const mine = (tags?.tags ?? []).filter((tag) => tag.strandId === strandId);
  return { turnIds: mine.map((tag) => tag.turnId), firstSeq: mine.length ? mine[0]!.seq : null };
}

const fold = (text: string) => text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/** Whether every word of the query starts a word of the strand's name or summary. */
export function matchesStrand(strand: Pick<StrandView, "title" | "summary">, query: string): boolean {
  const words = fold(query).split(/[^\p{L}\p{N}#]+/u).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(`${strand.title} ${strand.summary ?? ""}`);
  return words.every((word) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(hay));
}

/** The box's list: needs you, active (running, finished, waiting, open), quiet; with a query, matches only, and Earlier's too. */
export function boxGroups(list: StrandList | null | undefined, query: string): { label: string; strands: StrandView[] }[] {
  const all = [...(list?.strands ?? []), ...(query.trim() ? list?.earlier ?? [] : [])].filter((strand) => matchesStrand(strand, query));
  return [
    { label: "Needs you", strands: all.filter((strand) => strand.state === "needs-you") },
    { label: "Active", strands: all.filter((strand) => strand.state !== "needs-you" && strand.state !== "quiet") },
    { label: "Quiet", strands: all.filter((strand) => strand.state === "quiet") },
  ].filter((group) => group.strands.length);
}

/**
 * A filter's turns: the strand's, plus each turn of this conversation still
 * waiting for the user's answer in another strand (a pending question,
 * approval or form stays in view, marked with its strand).
 */
export function filterTurnsOf(tags: Tags | null | undefined, list: StrandList | null | undefined, strandId: string, threadId: string): { turnIds: string[]; firstSeq: number | null } {
  const own = turnsOfStrand(tags, strandId);
  const waiting = (list?.strands ?? []).filter((strand) => strand.id !== strandId)
    .flatMap((strand) => strand.asks.filter((ask) => ask.threadId === threadId && ask.turnId).map((ask) => ask.turnId!));
  return { turnIds: [...new Set([...own.turnIds, ...waiting])], firstSeq: own.firstSeq };
}
