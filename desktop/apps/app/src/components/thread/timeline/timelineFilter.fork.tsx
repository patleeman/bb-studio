import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import type { TimelineRow } from "@bb/server-contract";
import type { ExperimentalTimelineFilter } from "@get-bb/plugin-sdk";
import {
  TimelineFilterExpandContext,
  useTimelineFilterOf,
} from "@/lib/fork-timeline-filter";


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
    return (
      <TimelineFilterExpandContext.Provider value={filtered.expandAll}>
        <Surface {...surfaceProps} />
      </TimelineFilterExpandContext.Provider>
    );
  }
  return FilteredTimelineSurface;
}
