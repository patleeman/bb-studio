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

/** Cuts to `max` characters (code points, so an emoji is never split), with "…". */
export function clip(text: string, max = 90): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text;
}

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

// ---- level 2: the tree (design "Strands as shape", screen 7c) ----

/** A node only for what matters: the open ask (filled amber), an ask (amber ring), the user's message (◆), a worker's result (□). */
export type TreeNodeKind = "open" | "ask" | "dec" | "res";

export interface TreeNode {
  /** The message the node zooms in to. */
  seq: number;
  /** Its turn's first message. */
  turnSeq: number;
  kind: TreeNodeKind;
  /** The line drawn (clipped), and the whole first line, which the search reads. */
  label: string;
  text: string;
  at: number | null;
  strandId: string | null;
  column: number;
  y: number;
  /** The strand's name, on its first node (at the fork). */
  name: string | null;
}

export interface TreeLane {
  strandId: string;
  name: string;
  column: number;
  /** The lane it branches from (0: the trunk). */
  parentColumn: number;
  startY: number;
  /** Where it ends (done), or null: it runs on. */
  endY: number | null;
  current: boolean;
  done: boolean;
}

export interface ZoomTree {
  lanes: TreeLane[];
  nodes: TreeNode[];
  gaps: { y: number; hours: number }[];
  height: number;
  /** Columns in use at once (the trunk is 0): a done strand's column is reused by a later one. */
  columns: number;
  /** Each strand's name, for the search. */
  names: ReadonlyMap<string, string>;
}

/** Vertical space for a turn with a node, and for one without. */
export const TREE_STEP = 22;
const TREE_QUIET = 4;
const TREE_TOP = 22;
const TREE_BOTTOM = 40;

const stripRelay = (text: string) => text.replace(/^\[bb [^\]\n]*\]\s*/u, "").trim();

/** The conversation as a tree on one vertical time axis: the trunk, a lane per strand branching from its parent, and its nodes. */
export function zoomTree(tags: Tags | null | undefined): ZoomTree {
  const turns = (tags?.tags ?? []) as readonly Turn[];
  const empty: ZoomTree = { lanes: [], nodes: [], gaps: [], height: TREE_TOP + TREE_BOTTOM, columns: 1, names: new Map() };
  if (!turns.length) return empty;
  const replies = new Map<string, Reply>();
  for (const reply of tags?.replies ?? []) replies.set(reply.turnId, reply);
  const strands = new Map((tags?.strands ?? []).map((strand) => [strand.id, strand]));
  // A column per strand while it runs; once a done strand has ended, a later strand takes its column.
  const firstAt = new Map<string, number>();
  const lastAt = new Map<string, number>();
  turns.forEach((turn, index) => {
    if (!turn.strandId) return;
    if (!firstAt.has(turn.strandId)) firstAt.set(turn.strandId, index);
    lastAt.set(turn.strandId, index);
  });
  const columns = new Map<string, number>();
  const busyUntil: number[] = [Number.POSITIVE_INFINITY];
  for (const [strandId, start] of firstAt) {
    let column = busyUntil.findIndex((until, at) => at > 0 && until < start);
    if (column < 0) { column = busyUntil.length; busyUntil.push(0); }
    busyUntil[column] = strands.get(strandId)?.done ? lastAt.get(strandId)! : Number.POSITIVE_INFINITY;
    columns.set(strandId, column);
  }
  const open = turns.find((turn) => { const reply = replies.get(turn.turnId); return reply?.tag === "needs-you" && !reply.resolved; });
  const currentStrand = open ? open.strandId : turns.at(-1)!.strandId;

  const nodes: TreeNode[] = [];
  const gaps: ZoomTree["gaps"] = [];
  const ys = new Map<string, number>();
  const named = new Set<string>();
  let y = TREE_TOP;
  turns.forEach((turn, index) => {
    const node = nodeOf(turn, replies.get(turn.turnId));
    if (index > 0) {
      const previous = turns[index - 1]!;
      const pause = previous.at != null && turn.at != null ? turn.at - previous.at : 0;
      if (pause >= GAP_MS) {
        gaps.push({ y: y + TREE_STEP / 2 + 4, hours: Math.round(pause / 3_600_000) });
        y += TREE_STEP;
      }
      y += node ? TREE_STEP : TREE_QUIET;
    }
    ys.set(turn.turnId, y);
    if (!node) return;
    const strandId = turn.strandId;
    const title = strandId && !named.has(strandId) ? strands.get(strandId)?.title ?? null : null;
    const name = title === null ? null : clip(title, 32);
    if (strandId) named.add(strandId);
    nodes.push({ ...node, at: turn.at ?? null, strandId, column: strandId ? columns.get(strandId)! : 0, y, name });
  });
  const height = y + TREE_BOTTOM;
  const lanes: TreeLane[] = [...columns].map(([strandId, column]) => {
    const own = turns.filter((turn) => turn.strandId === strandId);
    const strand = strands.get(strandId);
    const parent = strand?.parentId ? columns.get(strand.parentId) : undefined;
    const done = !!strand?.done;
    return {
      strandId,
      name: strand?.title ?? "Strand",
      column,
      parentColumn: parent !== undefined && parent < column ? parent : 0,
      startY: ys.get(own[0]!.turnId)!,
      endY: done ? ys.get(own.at(-1)!.turnId)! : null,
      current: strandId === currentStrand,
      done,
    };
  });
  const names = new Map([...columns.keys()].map((strandId) => [strandId, strands.get(strandId)?.title ?? "Strand"]));
  return { lanes, nodes, gaps, height, columns: busyUntil.length, names };
}

function nodeOf(turn: Turn, reply: Reply | undefined): Pick<TreeNode, "seq" | "turnSeq" | "kind" | "label" | "text"> | null {
  const node = (seq: number, kind: TreeNodeKind, text: string) => ({ seq, turnSeq: turn.seq, kind, label: clip(text, 60), text });
  if (reply?.tag === "needs-you") return node(reply.seq, reply.resolved ? "ask" : "open", reply.ask ?? reply.line ?? "Asked you");
  if (turn.kind === "user") return node(turn.seq, "dec", turn.line ?? "Your message");
  if (turn.kind === "report") return node(reply?.seq ?? turn.seq, "res", reply?.line ?? (stripRelay(turn.line ?? "") || "A result"));
  return null;
}

/** The node nearest message `seq` (by its turn), or null. */
export function nodeAt(tree: ZoomTree, seq: number | null): TreeNode | null {
  if (seq === null || !tree.nodes.length) return null;
  let found: TreeNode | null = null;
  for (const node of tree.nodes) { if (node.turnSeq <= seq) found = node; else break; }
  return found ?? tree.nodes[0]!;
}

/** Whether a node matches the keyboard search (its whole first line or its strand's name). */
export function nodeMatches(node: TreeNode, tree: ZoomTree, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const strand = node.strandId ? tree.names.get(node.strandId) ?? "" : "";
  return node.text.toLowerCase().includes(needle) || strand.toLowerCase().includes(needle);
}

/** The nodes (seqs) and strands the search matches, once per query; null when nothing is typed. */
export function treeMatches(tree: ZoomTree, query: string): { seqs: ReadonlySet<number>; strands: ReadonlySet<string> } | null {
  if (!query.trim()) return null;
  const seqs = new Set<number>();
  const strands = new Set<string>();
  for (const node of tree.nodes) {
    if (!nodeMatches(node, tree, query)) continue;
    seqs.add(node.seq);
    if (node.strandId) strands.add(node.strandId);
  }
  return { seqs, strands };
}

/** Keyboard mode: the node a key moves to from `from` (↑↓ through the matches, ←→ to the nearest node on the neighbouring lane). */
export function stepNode(tree: ZoomTree, from: TreeNode | null, key: "up" | "down" | "left" | "right", query = ""): TreeNode | null {
  const shown = tree.nodes.filter((node) => nodeMatches(node, tree, query));
  if (!shown.length) return from;
  if (!from) return shown.at(-1)!;
  if (key === "up" || key === "down") {
    const at = shown.findIndex((node) => node.seq === from.seq);
    if (at >= 0) return shown[Math.max(0, Math.min(shown.length - 1, at + (key === "down" ? 1 : -1)))]!;
    // From a node the search hides: the nearest match that way.
    return key === "down"
      ? shown.find((node) => node.y > from.y) ?? shown.at(-1)!
      : [...shown].reverse().find((node) => node.y < from.y) ?? shown[0]!;
  }
  const column = from.column + (key === "right" ? 1 : -1);
  const lane = shown.filter((node) => node.column === column);
  if (!lane.length) return from;
  return lane.reduce((best, node) => (Math.abs(node.y - from.y) < Math.abs(best.y - from.y) ? node : best));
}
