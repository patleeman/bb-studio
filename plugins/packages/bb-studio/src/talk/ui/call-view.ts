// Pure helpers for a call's live transcript and the recording bar.
import type { CallLive, Segment, Speaker } from "../shared/contract";
import { NEW_CALL_EVENT, formatClock } from "../shared/format";

/** Opens the call source picker from anywhere: Studio's New menu, the command palette. */
export function openCallPicker(): void {
  window.dispatchEvent(new CustomEvent(NEW_CALL_EVENT));
}

export interface CallTurn {
  key: string;
  speaker: Speaker;
  /** Where the turn starts in the call, for the play button. */
  offsetMs: number;
  /** The first piece, to play from. */
  segmentId: string | null;
  text: string;
  /** Still being transcribed: a partial, or a piece waiting for its text. */
  pending: boolean;
  failed: boolean;
}

/**
 * The call as turns: consecutive pieces from one side joined, both sides in
 * time order, with the helper's partials at the end of their side's turn.
 * Echoes and silent pieces are left out.
 */
export function callTurns(
  segments: readonly Segment[],
  partials: CallLive["partials"] = [],
  startedAt: number | null = null,
): CallTurn[] {
  const first = segments[0]?.startedAt ?? startedAt ?? 0;
  type Piece = { at: number; offsetMs: number; speaker: Speaker; segmentId: string | null; text: string; pending: boolean; failed: boolean };
  const pieces: Piece[] = [];
  for (const segment of segments) {
    if (!segment.speaker || segment.echo || segment.status === "empty") continue;
    pieces.push({
      at: segment.startedAt,
      offsetMs: segment.offsetMs,
      speaker: segment.speaker,
      segmentId: segment.id,
      text: segment.status === "done" ? (segment.text ?? "").trim() : "",
      pending: segment.status === "pending",
      failed: segment.status === "failed",
    });
  }
  const stored = new Set(segments.map((segment) => segment.id));
  for (const partial of partials) {
    const id = `${partial.speaker}-${partial.index}`;
    const segment = segments.find((item) => item.id === id);
    if (segment && segment.status !== "pending") continue;
    const at = (startedAt ?? first) + partial.startMs;
    if (stored.has(id)) {
      // Its piece is stored and waiting: show the partial in its place.
      const piece = pieces.find((item) => item.segmentId === id);
      if (piece) piece.text = partial.text;
      continue;
    }
    pieces.push({ at, offsetMs: Math.max(0, at - first), speaker: partial.speaker, segmentId: null, text: partial.text, pending: true, failed: false });
  }
  pieces.sort((a, b) => a.at - b.at);
  const turns: CallTurn[] = [];
  for (const piece of pieces) {
    const last = turns.at(-1);
    if (last && last.speaker === piece.speaker) {
      if (piece.text) last.text = last.text ? `${last.text} ${piece.text}` : piece.text;
      last.pending ||= piece.pending;
      last.failed ||= piece.failed;
      continue;
    }
    turns.push({
      key: `${piece.speaker}:${piece.segmentId ?? `live-${piece.at}`}`,
      speaker: piece.speaker,
      offsetMs: piece.offsetMs,
      segmentId: piece.segmentId,
      text: piece.text,
      pending: piece.pending,
      failed: piece.failed,
    });
  }
  return turns;
}

/** "Recording call: zoom.us · 12:04" */
export function callBarLabel(live: Pick<CallLive, "app" | "phase" | "startedAt">, now: number): string {
  if (live.phase === "starting") return `Starting call recording: ${live.app}`;
  if (live.phase === "stopping") return `Stopping call recording: ${live.app}`;
  return `Recording call: ${live.app} · ${formatClock(now - live.startedAt)}`;
}

/** The copyable note for the others on the call. */
export const CONSENT_NOTE = "Heads up: I'm recording this call so I can transcribe it and take notes. Tell me if you'd rather I didn't.";

const LAST_SOURCE_KEY = "bb-plugin-talk:call-source";

export interface CallSourceChoice {
  /** A bundle id, or "all". */
  source: string;
  mic: boolean;
}

export function lastSource(storage: Pick<Storage, "getItem"> | null = safeStorage()): CallSourceChoice | null {
  try {
    const value = JSON.parse(storage?.getItem(LAST_SOURCE_KEY) ?? "null") as Partial<CallSourceChoice> | null;
    return value && typeof value.source === "string" ? { source: value.source, mic: value.mic !== false } : null;
  } catch {
    return null;
  }
}

export function rememberSource(choice: CallSourceChoice, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(LAST_SOURCE_KEY, JSON.stringify(choice));
  } catch {
    // The picker then starts from its default.
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
