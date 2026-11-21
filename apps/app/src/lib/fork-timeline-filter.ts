import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import type { ExperimentalTimelineFilter } from "@get-bb/plugin-sdk";
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
