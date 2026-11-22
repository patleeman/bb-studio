// Semantic zoom, level 1 (design "Strands as shape", screen 7b): the
// conversation as one line per stretch of one strand. Pure functions over the
// strands.tags data, so the view only draws.
import type { Tags } from "./model";

/** "|\" where a strand starts, "|" where it goes on, a dot where it ends; the trunk for turns of no strand. */
export type ZoomGlyph = "fork" | "cont" | "end" | "trunk";

export interface ZoomLine {
  kind: "line";
  /** The stretch's first turn's seq: its key. */
  key: number;
  strandId: string | null;
  name: string;
  glyph: ZoomGlyph;
  /** Turns in the stretch. */
  count: number;
  /** Each turn's first message (seq), oldest first. */
  seqs: number[];
  /** Where clicking the line zooms in to: its key moment's message. */
  go: number;
  /** The key moment: the open ask, an answered ask, the user's message, else the newest status line. */
  moment: string;
  /** "open": it holds the ask still waiting on the user (amber); "ask": an ask the user is past. */
  mark: "open" | "ask" | null;
  /** The strand the conversation is on now (the open ask's, else the newest turn's): its glyph is heavier. */
  current: boolean;
  from: number | null;
  to: number | null;
}

export interface ZoomGap {
  kind: "gap";
  key: string;
  hours: number;
}

export type ZoomRow = ZoomLine | ZoomGap;

/** A pause this long between two turns shows as "N hours later". */
export const GAP_MS = 2 * 60 * 60 * 1000;
export const WHOLE = "Whole conversation";

type Turn = Tags["tags"][number];
type Reply = NonNullable<Tags["replies"]>[number];

const clip = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The conversation's stretches of one strand, oldest first, with "N hours later" between long pauses. */
export function zoomLines(tags: Tags | null | undefined): ZoomRow[] {
  const turns = (tags?.tags ?? []) as readonly Turn[];
  if (turns.length === 0) return [];
  const replies = new Map<string, Reply>();
  for (const reply of tags?.replies ?? []) replies.set(reply.turnId, reply);
  const strands = new Map((tags?.strands ?? []).map((strand) => [strand.id, strand]));
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  turns.forEach((turn, index) => {
    if (!turn.strandId) return;
    if (!first.has(turn.strandId)) first.set(turn.strandId, index);
    last.set(turn.strandId, index);
  });
  const open = turns.find((turn) => { const reply = replies.get(turn.turnId); return reply?.tag === "needs-you" && !reply.resolved; });
  const currentStrand = open ? open.strandId : turns.at(-1)!.strandId;

  const rows: ZoomRow[] = [];
  let stretch: { turn: Turn; index: number }[] = [];
  const flush = () => {
    if (stretch.length) rows.push(lineOf(stretch, replies, strands, first, last, currentStrand));
    stretch = [];
  };
  turns.forEach((turn, index) => {
    const previous = stretch.at(-1)?.turn ?? (index > 0 ? turns[index - 1] : undefined);
    const pause = previous?.at != null && turn.at != null ? turn.at - previous.at : 0;
    if (pause >= GAP_MS) {
      flush();
      rows.push({ kind: "gap", key: `gap:${turn.seq}`, hours: Math.round(pause / 3_600_000) });
    } else if (stretch.length && stretch[0]!.turn.strandId !== turn.strandId) flush();
    stretch.push({ turn, index });
  });
  flush();
  return rows;
}

function lineOf(
  stretch: { turn: Turn; index: number }[],
  replies: ReadonlyMap<string, Reply>,
  strands: ReadonlyMap<string, { id: string; title: string; done?: boolean }>,
  first: ReadonlyMap<string, number>,
  last: ReadonlyMap<string, number>,
  currentStrand: string | null,
): ZoomLine {
  const strandId = stretch[0]!.turn.strandId;
  const strand = strandId ? strands.get(strandId) : undefined;
  const indexes = stretch.map((each) => each.index);
  const glyph: ZoomGlyph = !strandId
    ? "trunk"
    : indexes.includes(first.get(strandId)!)
      ? "fork"
      : strand?.done && indexes.includes(last.get(strandId)!)
        ? "end"
        : "cont";
  const moment = keyMoment(stretch.map((each) => each.turn), replies);
  const times = stretch.map((each) => each.turn.at).filter((at): at is number => at != null);
  return {
    kind: "line",
    key: stretch[0]!.turn.seq,
    strandId,
    name: strandId ? strand?.title ?? "Strand" : WHOLE,
    glyph,
    count: stretch.length,
    seqs: stretch.map((each) => each.turn.seq),
    go: moment.seq,
    moment: clip(moment.text),
    mark: moment.mark,
    current: strandId !== null && strandId === currentStrand,
    from: times[0] ?? null,
    to: times.at(-1) ?? null,
  };
}

/** The stretch's key moment: the open ask, else an answered ask, else the user's own message, else the newest status line. */
function keyMoment(turns: readonly Turn[], replies: ReadonlyMap<string, Reply>): { seq: number; text: string; mark: ZoomLine["mark"] } {
  const asks = turns.map((turn) => replies.get(turn.turnId)).filter((reply): reply is Reply => reply?.tag === "needs-you");
  const open = asks.find((reply) => !reply.resolved);
  if (open) return { seq: open.seq, text: open.ask ?? open.line ?? "Needs you", mark: "open" };
  const asked = asks.at(-1);
  if (asked) return { seq: asked.seq, text: asked.ask ?? asked.line ?? "Asked you", mark: "ask" };
  const yours = [...turns].reverse().find((turn) => turn.kind === "user" && turn.line);
  if (yours) return { seq: yours.seq, text: yours.line!, mark: null };
  const status = [...turns].reverse().map((turn) => replies.get(turn.turnId)).find((reply) => reply?.line);
  if (status) return { seq: status.seq, text: status.line!, mark: null };
  const any = [...turns].reverse().find((turn) => turn.line);
  return { seq: (any ?? turns.at(-1)!).seq, text: any?.line ?? "", mark: null };
}

/** The line holding message `seq` (a turn's message or anything after it in the turn), or null. */
export function lineAt(rows: readonly ZoomRow[], seq: number | null): ZoomLine | null {
  if (seq === null) return null;
  let found: ZoomLine | null = null;
  for (const row of rows) {
    if (row.kind !== "line") continue;
    if (row.seqs[0]! <= seq) found = row;
    else break;
  }
  return found ?? (rows.find((row): row is ZoomLine => row.kind === "line") ?? null);
}

/** "11:33 AM", or "11:33 AM–12:05 PM" for a stretch over time. */
export function timeRange(from: number | null, to: number | null, format: (at: number) => string = clock): string {
  if (from === null) return "";
  const start = format(from);
  const end = to === null ? start : format(to);
  return start === end ? start : `${start}–${end}`;
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
