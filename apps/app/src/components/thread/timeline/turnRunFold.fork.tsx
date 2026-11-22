// Runs of a thread's timeline a plugin folds into one line each (Studio's
// runs of status replies): slots.experimental_timelineFilter's `folds`. The
// rows of a fold's turns, and the rows between them that are neither a
// message the user typed nor another turn's reply, give way to one line where
// the run's first such row was. The line opens the run (`expandFold`). Off
// while a timeline filter is on: the filter unfolds everything.
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
}

const NO_MARKERS: ReadonlyMap<string, TurnRunMarker> = new Map();

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
  isRelayed: (row: ThreadTimelineViewRow) => boolean = () => false,
): TurnRunFold {
  if (folds.length === 0) return { rows, markers: NO_MARKERS };
  const hidden = new Set<string>();
  const markers = new Map<string, TurnRunMarker>();
  for (const fold of folds) {
    const turns = new Set(fold.turnIds);
    let first = -1;
    let last = -1;
    rows.forEach((row, index) => {
      if (row.turnId === null || !turns.has(row.turnId)) return;
      if (first < 0) first = index;
      last = index;
    });
    if (first < 0) continue;
    const folding: ThreadTimelineViewRow[] = [];
    for (let index = first; index <= last; index += 1) {
      const row = rows[index]!;
      const member = row.turnId !== null && turns.has(row.turnId);
      if (typedByUser(row) && !isRelayed(row)) continue;
      // Another turn's own reply inside the span stays (the plugin's run should never hold one).
      if (!member && row.kind === "conversation" && row.role === "assistant")
        continue;
      folding.push(row);
    }
    // The line takes the place of the run's first message (a conversation row: the timeline draws those through the fold).
    const marker = folding.find((row) => row.kind === "conversation");
    if (!marker) continue;
    markers.set(marker.id, {
      foldId: fold.id,
      threadId: marker.threadId,
      label: fold.label,
    });
    for (const row of folding) if (row !== marker) hidden.add(row.id);
  }
  if (markers.size === 0) return { rows, markers: NO_MARKERS };
  return { rows: rows.filter((row) => !hidden.has(row.id)), markers };
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
