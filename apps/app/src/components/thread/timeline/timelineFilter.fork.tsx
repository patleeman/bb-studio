import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import type { TimelineRow } from "@bb/server-contract";
import type { ExperimentalTimelineFilter } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  subscribeTimelineSlots,
  TimelineFilterExpandContext,
  timelineZoomOf,
  useTimelineFilterOf,
  useTimelineZoomOf,
} from "@/lib/fork-timeline-filter";
import {
  getPluginSlotSnapshot,
  subscribePluginSlots,
} from "@/lib/plugin-slots";


export interface TimelineFilterOptions {
  hasOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: (() => Promise<void> | void) | undefined;
}

export interface TimelineFilterResult {
  rows: TimelineRow[];
  hasOlderTimelineRows: boolean;
  expandAll: boolean;
  active: boolean;
}

export function filterTimelineRows(
  rows: readonly TimelineRow[],
  turnIds: ReadonlySet<string>,
): TimelineRow[] {
  return rows.filter((row) => row.turnId !== null && turnIds.has(row.turnId));
}

export function oldestLoadedSeq(rows: readonly TimelineRow[]): number | null {
  let oldest: number | null = null;
  for (const row of rows) {
    if (oldest === null || row.sourceSeqStart < oldest) oldest = row.sourceSeqStart;
  }
  return oldest;
}

export function needsOlderRows(
  rows: readonly TimelineRow[],
  filter: Pick<ExperimentalTimelineFilter, "firstSeq">,
  hasOlder: boolean,
): boolean {
  if (filter.firstSeq === null || !hasOlder) return false;
  const oldest = oldestLoadedSeq(rows);
  return oldest === null || oldest > filter.firstSeq;
}

export function useForkTimelineFilter(
  threadId: string,
  rows: TimelineRow[],
  { hasOlder, isLoadingOlder, onLoadOlder }: TimelineFilterOptions,
): TimelineFilterResult {
  const filter = useTimelineFilterOf(threadId);
  const turnIds = useMemo(
    () => (filter ? new Set(filter.turnIds) : null),
    [filter],
  );
  const kept = useMemo(
    () => (turnIds ? filterTimelineRows(rows, turnIds) : rows),
    [rows, turnIds],
  );
  const needOlder = filter !== null && needsOlderRows(rows, filter, hasOlder);
  const oldest = oldestLoadedSeq(rows);
  const pending = useRef(false);
  const mounted = useRef(true);
  const lastLoad = useRef<string | null>(null);
  const [, setLoaded] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!filter || !needOlder || isLoadingOlder || pending.current || !onLoadOlder) return;
    const key = `${threadId}:${filter.firstSeq}:${oldest}`;
    if (lastLoad.current === key) return;
    lastLoad.current = key;
    pending.current = true;
    void Promise.resolve()
      .then(onLoadOlder)
      .catch(() => undefined)
      .finally(() => {
        pending.current = false;
        if (mounted.current) setLoaded((count) => count + 1);
      });
  });
  if (!filter) {
    return { rows, hasOlderTimelineRows: hasOlder, expandAll: false, active: false };
  }
  return {
    rows: kept,
    hasOlderTimelineRows: filter.firstSeq === null ? hasOlder : false,
    expandAll: true,
    active: true,
  };
}

interface FilterableSurfaceProps {
  threadId: string;
  timelineRows: TimelineRow[];
  leadingContent?: ReactNode;
  hasOlderTimelineRows?: boolean;
  isLoadingOlderTimelineRows?: boolean;
  onLoadOlderRows?: () => Promise<void> | void;
  isStopping?: boolean;
}

export function withTimelineFilter<P extends FilterableSurfaceProps>(
  Surface: ComponentType<P>,
): ComponentType<P> {
  function FilteredTimelineSurface(props: P) {
    const filtered = useForkTimelineFilter(props.threadId, props.timelineRows, {
      hasOlder: props.hasOlderTimelineRows ?? false,
      isLoadingOlder: props.isLoadingOlderTimelineRows ?? false,
      onLoadOlder: props.onLoadOlderRows,
    });
    const surfaceProps: P = filtered.active
      ? {
          ...props,
          timelineRows: filtered.rows,
          hasOlderTimelineRows: filtered.hasOlderTimelineRows,
          isStopping: false,
        }
      : props;
    const zoom = useTimelineZoomOf(props.threadId);
    const hostRef = useRef<HTMLDivElement>(null);
    const { anchorSeq, zoomOuts } = useZoomAnchor(props.threadId, hostRef, props.timelineRows);
    // A View that crashed gives the thread its timeline back until the next zoom-out.
    const [crashedAt, setCrashedAt] = useState<number | null>(null);
    const View = zoom.View;
    const zoomed =
      zoom.level > 0 &&
      crashedAt !== zoomOuts &&
      View !== null &&
      zoom.pluginId !== null &&
      zoom.slotId !== null;
    // Zoomed out, the surface draws no rows: the View leads, and the surface's
    // status (connection, load error, working, Stop requested, catch-up) stays under it.
    const shownProps: P = zoomed
      ? {
          ...surfaceProps,
          // A turn that fails while zoomed out still says so: its error rows draw under the View.
          timelineRows: errorsSinceUserOf(props.timelineRows),
          hasOlderTimelineRows: false,
          onLoadOlderRows: undefined,
          leadingContent: (
            <>
              {props.leadingContent}
              <PluginSlotMount
                pluginId={zoom.pluginId!}
                slotKind="timelineZoom"
                slotId={zoom.slotId!}
                instanceId={props.threadId}
                crashResetKey={String(zoomOuts)}
                crashFallback={<ZoomCrashed at={zoomOuts} onCrash={setCrashedAt} />}
              >
                <View
                  threadId={props.threadId}
                  level={zoom.level}
                  anchorSeq={anchorSeq}
                  latestUserSeq={latestUserSeqOf(props.timelineRows)}
                />
              </PluginSlotMount>
            </>
          ),
        }
      : surfaceProps;
    return (
      <div ref={hostRef} data-timeline-zoom-thread={props.threadId} className="contents">
        <TimelineFilterExpandContext.Provider value={zoomed ? false : filtered.expandAll}>
          <Surface {...shownProps} />
        </TimelineFilterExpandContext.Provider>
      </div>
    );
  }
  return FilteredTimelineSurface;
}

/**
 * The message at the middle of a thread's scroll viewport, as a seq: the
 * drawn timeline row nearest the middle that is one of `rows`. Null when
 * nothing is drawn.
 */
export function middleSeqOf(
  container: Element | null,
  rows: readonly TimelineRow[],
): number | null {
  if (container === null) return null;
  const drawn = [...container.querySelectorAll<HTMLElement>("[data-timeline-row-id]")];
  if (drawn.length === 0) return null;
  const viewport = drawn[0]!.closest("[data-page-scroll-viewport]") ?? container.parentElement;
  const box = viewport?.getBoundingClientRect();
  const middle = box ? box.top + box.height / 2 : window.innerHeight / 2;
  const seqOf = new Map(rows.map((row) => [row.id, row.sourceSeqStart]));
  let best: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const element of drawn) {
    const seq = seqOf.get(element.dataset.timelineRowId ?? "");
    if (seq === undefined) continue;
    const rect = element.getBoundingClientRect();
    const away = Math.abs((rect.top + rect.bottom) / 2 - middle);
    if (away < distance) {
      distance = away;
      best = seq;
    }
  }
  return best;
}

/** The message at the middle of the screen when the thread left level 0, kept while it stays zoomed out. */
function useZoomAnchor(
  threadId: string,
  hostRef: { readonly current: HTMLDivElement | null },
  rows: readonly TimelineRow[],
): { anchorSeq: number | null; zoomOuts: number } {
  const [anchor, setAnchor] = useState<{ anchorSeq: number | null; zoomOuts: number }>({ anchorSeq: null, zoomOuts: 0 });
  const rowsRef = useRef(rows);
  useLayoutEffect(() => {
    rowsRef.current = rows;
  });
  const slots = useSyncExternalStore(
    subscribePluginSlots,
    () => getPluginSlotSnapshot().timelineFilters,
    () => getPluginSlotSnapshot().timelineFilters,
  );
  useEffect(() => {
    let level = timelineZoomOf(slots, threadId).level;
    // Read when the level changes, before React redraws: the timeline is still on screen.
    return subscribeTimelineSlots(slots, () => {
      const next = timelineZoomOf(slots, threadId).level;
      if (level <= 0 && next > 0) {
        const anchorSeq = middleSeqOf(hostRef.current, rowsRef.current);
        // Unique across mounts: a crash remembered for one zoom-out never sticks to a later one.
        zoomOutSerial += 1;
        const zoomOuts = zoomOutSerial;
        setAnchor({ anchorSeq, zoomOuts });
      }
      level = next;
    });
  }, [slots, threadId, hostRef]);
  return anchor;
}

/** The newest message the user typed (its seq): a View can tell when the user sends. */
export function latestUserSeqOf(rows: readonly TimelineRow[]): number | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind === "conversation" && row.role === "user" && row.initiator === "user") {
      return row.sourceSeqStart;
    }
  }
  return null;
}

let zoomOutSerial = 0;

/** The error rows of the turns since the user's last message: a turn failing while zoomed out. */
export function errorsSinceUserOf(rows: readonly TimelineRow[]): TimelineRow[] {
  const out: TimelineRow[] = [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind === "conversation" && row.role === "user" && row.initiator === "user") break;
    if (row.kind === "system" && row.systemKind === "error") out.unshift(row);
  }
  return out;
}

function ZoomCrashed({ at, onCrash }: { at: number; onCrash(at: number): void }) {
  useEffect(() => {
    onCrash(at);
  }, [at, onCrash]);
  return null;
}
