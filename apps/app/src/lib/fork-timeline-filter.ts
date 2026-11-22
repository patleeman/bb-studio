import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import type { ExperimentalTimelineFilter, ExperimentalTimelineFold } from "@get-bb/plugin-sdk";
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

function wellFormedFolds(value: unknown): value is readonly ExperimentalTimelineFold[] {
  return (
    Array.isArray(value) &&
    value.every(
      (fold) =>
        typeof fold === "object" &&
        fold !== null &&
        typeof (fold as ExperimentalTimelineFold).id === "string" &&
        typeof (fold as ExperimentalTimelineFold).label === "string" &&
        Array.isArray((fold as ExperimentalTimelineFold).turnIds) &&
        (fold as ExperimentalTimelineFold).turnIds.every((id) => typeof id === "string"),
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
