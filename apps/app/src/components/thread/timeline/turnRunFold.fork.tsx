// Runs of a thread's timeline a plugin folds into one line each (Studio's
// runs of status replies): slots.experimental_timelineFilter's `folds`. A
// fold hides its turns' rows, and the rows of no turn between two of them,
// behind one line where its first message was. It never hides another turn's
// rows, a message the user typed (which also ends the run there), or a row
// the caller keeps (errors, alerts, a turn still running). A fold holding the
// message a link points at stays open. The line opens the run (`expandFold`).
// Off while a timeline filter is on: the filter unfolds everything.
import type { ExperimentalTimelineFold } from "@get-bb/plugin-sdk";
import type { ThreadTimelineViewRow } from "@bb/thread-view";
import { Icon } from "@bb/shared-ui/icon";
import { expandTimelineFold } from "@/lib/fork-timeline-filter";

export interface TurnRunMarker {
  foldId: string;
  threadId: string;
  label: string;
}

export interface TurnRunFold {
  rows: readonly ThreadTimelineViewRow[];
  markers: ReadonlyMap<string, TurnRunMarker>;
  /** Folds left open because they hold the linked row. */
  opened: readonly string[];
}

export interface TurnRunFoldOptions {
  /** A message another thread or a plugin sent: it folds like the turn's other rows. */
  isRelayed?: (row: ThreadTimelineViewRow) => boolean;
  /** A row that never folds (an error, an alert, a row still running). */
  kept?: (row: ThreadTimelineViewRow) => boolean;
  /** A reply drawn as the quiet-turn mark: never the fold's line. */
  isQuiet?: (row: ThreadTimelineViewRow) => boolean;
  /** The row a link points at: its fold stays open. */
  targetRowId?: string | null;
}

const NO_MARKERS: ReadonlyMap<string, TurnRunMarker> = new Map();
const NO_OPENED: readonly string[] = [];
const never = () => false;

/** A message the user typed: it never folds. */
function typedByUser(row: ThreadTimelineViewRow): boolean {
  return (
    row.kind === "conversation" &&
    row.role === "user" &&
    row.initiator === "user"
  );
}

export function foldTurnRuns(
  rows: readonly ThreadTimelineViewRow[],
  folds: readonly ExperimentalTimelineFold[],
  {
    isRelayed = never,
    kept = never,
    isQuiet = never,
    targetRowId = null,
  }: TurnRunFoldOptions = {},
): TurnRunFold {
  if (folds.length === 0) return { rows, markers: NO_MARKERS, opened: NO_OPENED };
  const foldOfTurn = new Map<string, number>();
  folds.forEach((fold, index) => {
    for (const turnId of fold.turnIds) {
      if (!foldOfTurn.has(turnId)) foldOfTurn.set(turnId, index);
    }
  });
  const folding = folds.map((): ThreadTimelineViewRow[] => []);
  const closed = new Set<number>();
  let started: number[] = [];
  let open = -1;
  let between: ThreadTimelineViewRow[] = [];
  for (const row of rows) {
    if (typedByUser(row) && !isRelayed(row)) {
      // A message the user typed ends every run before it.
      for (const index of started) closed.add(index);
      started = [];
      open = -1;
      between = [];
      continue;
    }
    const index = row.turnId === null ? undefined : foldOfTurn.get(row.turnId);
    if (index === undefined) {
      if (row.turnId === null && open >= 0) between.push(row);
      else between = [];
      continue;
    }
    if (closed.has(index)) {
      open = -1;
      between = [];
      continue;
    }
    if (open === index) {
      for (const each of between) if (!kept(each)) folding[index]!.push(each);
    } else if (folding[index]!.length === 0) {
      started.push(index);
    }
    between = [];
    open = index;
    if (!kept(row)) folding[index]!.push(row);
  }
  const hidden = new Set<string>();
  const markers = new Map<string, TurnRunMarker>();
  const opened: string[] = [];
  folds.forEach((fold, index) => {
    const members = folding[index]!;
    if (targetRowId !== null && members.some((row) => row.id === targetRowId)) {
      opened.push(fold.id);
      return;
    }
    // The line takes the place of the run's first message (a conversation row: the timeline draws those through the fold).
    const marker = members.find((row) => row.kind === "conversation" && !isQuiet(row));
    if (!marker) return;
    markers.set(marker.id, {
      foldId: fold.id,
      threadId: marker.threadId,
      label: fold.label,
    });
    for (const row of members) if (row !== marker) hidden.add(row.id);
  });
  if (markers.size === 0) return { rows, markers: NO_MARKERS, opened: opened.length ? opened : NO_OPENED };
  return { rows: rows.filter((row) => !hidden.has(row.id)), markers, opened: opened.length ? opened : NO_OPENED };
}

interface SeqRow {
  id: string;
  messageSeq?: number;
  sourceSeqStart?: number;
  sourceSeqEnd?: number;
  childRows?: readonly SeqRow[] | null;
  children?: readonly SeqRow[] | null;
}

function holdsMessage(row: SeqRow, seq: number): boolean {
  if (row.messageSeq === seq) return true;
  const nested = row.childRows ?? row.children ?? null;
  return nested !== null && nested.some((child) => holdsMessage(child, seq));
}

/**
 * The top-level row a message link or search result points at, found as the
 * timeline's scroll-to-message finds it: the row holding message `seq`, or
 * (for a sequence match) the row whose span holds `seq`.
 */
export function linkedRowId(
  rows: readonly ThreadTimelineViewRow[],
  target: { seq: number; match: "message" | "sequence" } | null,
): string | null {
  if (target === null) return null;
  const seqRows = rows as readonly SeqRow[];
  const message = seqRows.find((row) => holdsMessage(row, target.seq));
  if (message !== undefined) return message.id;
  if (target.match === "message") return null;
  return (
    seqRows.find(
      (row) =>
        row.sourceSeqStart !== undefined &&
        row.sourceSeqEnd !== undefined &&
        row.sourceSeqStart <= target.seq &&
        target.seq <= row.sourceSeqEnd,
    )?.id ?? null
  );
}

/** The one line in a folded run's place; opening it unfolds the run. */
export function TurnRunMarkerLine({ marker }: { marker: TurnRunMarker }) {
  return (
    <button
      type="button"
      className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-subtle-foreground hover:bg-accent/40 hover:text-muted-foreground"
      data-turn-run-fold={marker.foldId}
      aria-expanded={false}
      onClick={() => expandTimelineFold(marker.threadId, marker.foldId)}
    >
      <Icon name="ChevronRight" className="size-3 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{marker.label}</span>
    </button>
  );
}
