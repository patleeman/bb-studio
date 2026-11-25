// A conversation's turns, read from its events: the message that started
// each turn (from the user, or a report such as a runner's), the reply's
// start, and the turn id BB gives its rows. Strands sort turns, not events;
// the rest of a turn inherits its strand.
import { isPingRequest, isUserRequest } from "../bot-cache";
import { messageText } from "../conversation-text";

export const EVENT_TYPES = ["client/turn/requested", "turn/started", "item/completed", "turn/completed"] as const;

export type EventRow = { seq?: number; type?: string; createdAt?: number; scope?: { kind?: string; turnId?: string } | null; data?: unknown };

export interface Turn {
  /** The seq of the message that started it: the strand item's key. */
  seq: number;
  turnId: string | null;
  at: number;
  /** "user": the user wrote it. "report": something else (a runner's report, an alert) with text the user sees. */
  kind: "user" | "report";
  text: string;
  /** The reply's text so far (agent messages, in order). */
  reply: string;
  /** The reply's last agent message: what the turn ends on, tagged needs-you or status. */
  finalReply?: string;
  /** The seq of the reply's last agent message. */
  replySeq: number | null;
  /** The last seq that belongs to it. */
  lastSeq: number;
  done: boolean;
  /** Finished without its turn/completed: a later turn started, the thread went idle or failed, or it ran too long. */
  abandoned?: boolean;
}

/** A turn with no end after this long counts as finished, so one lost turn/completed can't hold the read position. */
export const UNFINISHED_MAX_MS = 2 * 60 * 60 * 1000;

const QUIET_REPLY = /^\s*(?:\[PASS\]|PASS|\[SILENT\])?\s*$/i;

/** A turn worth a strand: the user wrote it, or a report the reply says something about. */
export function sortable(turn: Turn): boolean {
  if (turn.kind === "user") return true;
  // A turn with no message but a reply the user reads (a background task finished, and the assistant reports on it) is sorted by its reply.
  return !QUIET_REPLY.test(turn.reply);
}

/** A report the reply passes over quietly, but with something in it (a worker's plan, a relayed note): it still belongs somewhere in the tree. */
export function quietReport(turn: Turn): boolean {
  return turn.kind === "report" && !!turn.text.trim() && QUIET_REPLY.test(turn.reply);
}

interface Open { request: { seq: number; at: number; kind: "user" | "report" | "hidden"; text: string }; turn: Turn | null }

/**
 * The turns among `rows` (in seq order). A request with no turn yet waits
 * for the next turn to start; a steer (a second message in a running turn)
 * joins that turn. Turns not finished in `rows` come back with done false.
 * `restFrom`: the first seq of what isn't finished (a running turn, a
 * request BB hasn't started), where the next read starts again; null when
 * everything read is finished.
 *
 * A turn that never got its turn/completed (a crash, a host lost mid-turn)
 * counts as finished, marked abandoned, once a later turn starts, once the
 * thread is known to be settled (idle or failed: `settled`, which also
 * drops requests BB never started), or once it is older than `staleBefore`.
 */
export function turnsOf(rows: readonly EventRow[], options: { settled?: boolean; staleBefore?: number } = {}): { turns: Turn[]; restFrom: number | null } {
  const turns: Turn[] = [];
  const byId = new Map<string, Turn>();
  let waiting: Open["request"][] = [];
  let current: Turn | null = null;
  const abandon = (turn: Turn | null) => { if (turn && !turn.done) { turn.done = true; turn.abandoned = true; } };
  const start = (turnId: string | null, at: number, seq: number): Turn => {
    // A new turn: the one before it is over, whether or not its end was recorded.
    abandon(turns.at(-1) ?? null);
    const request = waiting.shift();
    const rest = waiting;
    waiting = [];
    const visible = [request, ...rest].filter((each): each is Open["request"] => !!each && each.kind !== "hidden");
    const kind = visible.some((each) => each.kind === "user") ? "user" : "report";
    const turn: Turn = {
      seq: request?.seq ?? seq, turnId, at: request?.at ?? at, kind,
      text: visible.map((each) => each.text).join("\n\n"), reply: "", replySeq: null, lastSeq: seq, done: false,
    };
    turns.push(turn);
    if (turnId) byId.set(turnId, turn);
    return turn;
  };
  for (const row of rows) {
    const seq = row.seq ?? 0;
    const at = row.createdAt ?? 0;
    const scopeTurn = row.scope?.kind === "turn" ? row.scope.turnId ?? null : null;
    if (row.type === "client/turn/requested") {
      const data = row.data as { target?: { kind?: string } } | undefined;
      const message = messageText(row);
      const hidden = !message || isPingRequest(row.data);
      const request = { seq, at, kind: hidden ? "hidden" as const : isUserRequest(row.data) ? "user" as const : "report" as const, text: message?.text ?? "" };
      // A steer joins the running turn.
      if (current && !current.done && data?.target?.kind === "steer") {
        if (request.kind !== "hidden") {
          current.text = [current.text, request.text].filter(Boolean).join("\n\n");
          if (request.kind === "user") current.kind = "user";
        }
        current.lastSeq = seq;
        continue;
      }
      waiting.push(request);
      continue;
    }
    let turn = scopeTurn ? byId.get(scopeTurn) ?? null : null;
    if (!turn && (row.type === "turn/started" || (scopeTurn && waiting.length))) turn = start(scopeTurn, at, seq);
    if (!turn && !scopeTurn) turn = current;
    if (!turn) continue;
    current = turn;
    turn.lastSeq = Math.max(turn.lastSeq, seq);
    if (row.type === "item/completed") {
      const message = messageText(row);
      if (message?.kind === "assistant") {
        turn.reply = [turn.reply, message.text].filter(Boolean).join("\n\n");
        turn.finalReply = message.text;
        turn.replySeq = seq;
      }
    } else if (row.type === "turn/completed") {
      turn.done = true;
    }
  }
  for (const turn of turns) if (options.settled || (options.staleBefore !== undefined && turn.at < options.staleBefore)) abandon(turn);
  const open = [...turns.filter((turn) => !turn.done).map((turn) => turn.seq), ...(options.settled ? [] : waiting.map((request) => request.seq))];
  return {
    // A turn whose start wasn't read (the read began inside it) has no message: not a turn to sort.
    turns: turns.filter((turn) => !(turn.kind === "report" && !turn.text && !turn.reply && !turn.done)),
    restFrom: open.length ? Math.min(...open) : null,
  };
}
