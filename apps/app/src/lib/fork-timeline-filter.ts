import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import type {
  ExperimentalTimelineFilter,
  ExperimentalTimelineFold,
  ExperimentalTimelineZoomViewProps,
} from "@get-bb/plugin-sdk";
import {
  getPluginSlotSnapshot,
  subscribePluginSlots,
} from "./plugin-slots";
import type { PluginTimelineFilterSlot } from "./fork-slots";

export const TimelineFilterExpandContext = createContext(false);

export function useTimelineFilterExpanded(): boolean {
  return useContext(TimelineFilterExpandContext);
}

export function useTimelineFilterExpandsRow(row: { kind: string }): boolean {
  const expanded = useContext(TimelineFilterExpandContext);
  return expanded && (row.kind === "bundle-summary" || row.kind === "step-summary");
}

const warned = new Set<string>();

function warnOnce(slot: PluginTimelineFilterSlot, what: string, error: unknown): void {
  const key = `${slot.pluginId}/${slot.id}/${what}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`Timeline filter ${slot.pluginId}/${slot.id}: ${what} failed`, error);
}

function wellFormed(value: unknown): value is ExperimentalTimelineFilter {
  if (typeof value !== "object" || value === null) return false;
  const { turnIds, firstSeq } = value as Record<string, unknown>;
  return (
    Array.isArray(turnIds) &&
    turnIds.every((id) => typeof id === "string") &&
    (firstSeq === null || (typeof firstSeq === "number" && Number.isFinite(firstSeq)))
  );
}

export function timelineFilterOf(
  slots: readonly PluginTimelineFilterSlot[],
  threadId: string,
): ExperimentalTimelineFilter | null {
  for (const slot of slots) {
    try {
      const filter = slot.get(threadId);
      if (filter === null || filter === undefined) continue;
      if (wellFormed(filter)) return filter;
      warnOnce(slot, "get (not a filter)", filter);
    } catch (error) {
      warnOnce(slot, "get", error);
    }
  }
  return null;
}

/** Checked folds arrays: a plugin returns the same array while its folds are unchanged, so each is checked once. */
const checkedFolds = new WeakMap<object, boolean>();

function wellFormedFolds(value: unknown): value is readonly ExperimentalTimelineFold[] {
  if (!Array.isArray(value)) return false;
  const known = checkedFolds.get(value);
  if (known !== undefined) return known;
  const ok = shapedAsFolds(value);
  checkedFolds.set(value, ok);
  return ok;
}

function shapedAsFolds(value: unknown[]): boolean {
  return (
    value.every(
      (fold) =>
        typeof fold === "object" &&
        fold !== null &&
        typeof (fold as ExperimentalTimelineFold).id === "string" &&
        typeof (fold as ExperimentalTimelineFold).label === "string" &&
        Array.isArray((fold as ExperimentalTimelineFold).turnIds) &&
        (fold as ExperimentalTimelineFold).turnIds.every((id) => typeof id === "string") &&
        ((fold as ExperimentalTimelineFold).labelFor === undefined ||
          typeof (fold as ExperimentalTimelineFold).labelFor === "function"),
    )
  );
}

const NO_FOLDS: readonly ExperimentalTimelineFold[] = [];

/** The folds the first registration that has any gives for a thread; none when no registration folds. */
export function timelineFoldsOf(
  slots: readonly PluginTimelineFilterSlot[],
  threadId: string,
): readonly ExperimentalTimelineFold[] {
  for (const slot of slots) {
    if (typeof slot.folds !== "function") continue;
    try {
      const folds = slot.folds(threadId);
      if (folds === null || folds === undefined || folds.length === 0) continue;
      if (wellFormedFolds(folds)) return folds;
      warnOnce(slot, "folds (not folds)", folds);
    } catch (error) {
      warnOnce(slot, "folds", error);
    }
  }
  return NO_FOLDS;
}

/** Tells the registration that gave a thread's folds that the user opened one. */
export function expandTimelineFold(threadId: string, id: string): void {
  for (const slot of getPluginSlotSnapshot().timelineFilters) {
    if (typeof slot.folds !== "function") continue;
    try {
      const folds = slot.folds(threadId);
      if (!folds?.some((fold) => fold.id === id)) continue;
      slot.expandFold?.(threadId, id);
      return;
    } catch (error) {
      warnOnce(slot, "expandFold", error);
    }
  }
}

const NO_ZOOM: TimelineZoom = { level: 0, View: null, pluginId: null, slotId: null };

export interface TimelineZoom {
  level: number;
  View: ComponentType<ExperimentalTimelineZoomViewProps> | null;
  /** The registration's plugin and id, to mount `View` as that plugin's slot. */
  pluginId: string | null;
  slotId: string | null;
}

/** A thread's zoom: the first registration with `zoom` decides; level 0 (bb's timeline) when none, or when it throws. */
export function timelineZoomOf(
  slots: readonly PluginTimelineFilterSlot[],
  threadId: string,
): TimelineZoom {
  for (const slot of slots) {
    const zoom = slot.zoom;
    if (zoom === undefined) continue;
    try {
      const level = zoom.level(threadId);
      return typeof level === "number" && level > 0
        ? { level, View: zoom.View, pluginId: slot.pluginId, slotId: slot.id }
        : NO_ZOOM;
    } catch (error) {
      warnOnce(slot, "zoom.level", error);
      return NO_ZOOM;
    }
  }
  return NO_ZOOM;
}

export function useTimelineZoomOf(threadId: string): TimelineZoom {
  const slots = useSyncExternalStore(
    subscribePluginSlots,
    () => getPluginSlotSnapshot().timelineFilters,
    () => getPluginSlotSnapshot().timelineFilters,
  );
  const subscribe = useSlotsSubscribe(slots);
  const read = useCallback(() => timelineZoomOf(slots, threadId), [slots, threadId]);
  const zoom = useSyncExternalStore(subscribe, () => read().level, () => read().level);
  return useMemo(() => (zoom > 0 ? timelineZoomOf(slots, threadId) : NO_ZOOM), [zoom, slots, threadId]);
}

export function useTimelineFoldsOf(threadId: string | null): readonly ExperimentalTimelineFold[] {
  const slots = useSyncExternalStore(
    subscribePluginSlots,
    () => getPluginSlotSnapshot().timelineFilters,
    () => getPluginSlotSnapshot().timelineFilters,
  );
  const subscribe = useSlotsSubscribe(slots);
  const read = useCallback(() => (threadId === null ? NO_FOLDS : timelineFoldsOf(slots, threadId)), [slots, threadId]);
  return useSyncExternalStore(subscribe, read, read);
}

function useSlotsSubscribe(slots: readonly PluginTimelineFilterSlot[]) {
  return useCallback(
    (listener: () => void) => subscribeTimelineSlots(slots, listener),
    [slots],
  );
}

/** Listens to every registration's changes (filters, folds, zoom); answers the unsubscribe. */
export function subscribeTimelineSlots(
  slots: readonly PluginTimelineFilterSlot[],
  listener: () => void,
): () => void {
  const offs = slots.map((slot) => {
    try {
      return slot.subscribe(listener);
    } catch (error) {
      warnOnce(slot, "subscribe", error);
      return null;
    }
  });
  return () => {
    for (const off of offs) {
      try {
        if (typeof off === "function") off();
      } catch {
      }
    }
  };
}

export function useTimelineFilterOf(
  threadId: string,
): ExperimentalTimelineFilter | null {
  const slots = useSyncExternalStore(
    subscribePluginSlots,
    () => getPluginSlotSnapshot().timelineFilters,
    () => getPluginSlotSnapshot().timelineFilters,
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      const offs = slots.map((slot) => {
        try {
          return slot.subscribe(listener);
        } catch (error) {
          warnOnce(slot, "subscribe", error);
          return null;
        }
      });
      return () => {
        for (const off of offs) {
          try {
            if (typeof off === "function") off();
          } catch {
          }
        }
      };
    },
    [slots],
  );
  const read = useCallback(() => timelineFilterOf(slots, threadId), [slots, threadId]);
  return useSyncExternalStore(subscribe, read, read);
}
