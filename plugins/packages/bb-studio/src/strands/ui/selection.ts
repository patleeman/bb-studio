// The strand filter on a conversation (a strand picked in the box, a tag or
// the Strands tab), shared by the box above the composer, the message tags
// and the tab, which render in separate slots of one app.
//
// On a BB with `slots.experimental_timelineFilter` (the fork's timeline
// filter), BB's timeline shows only the strand's turns, expanded, and pages
// back to its first message. On a BB without it, the tags dim the other
// strands' messages instead.
import { useSyncExternalStore } from "react";

export interface Selection {
  strandId: string;
  /** The message the filter last opened (stepping moves it). */
  seq: number | null;
  /** The strand's first message: the timeline pages back to it. */
  firstSeq?: number | null;
  /** The strand's turns, from the conversation's tags; the filter applies once they are known. */
  turnIds?: readonly string[];
}

export interface TimelineFilter { turnIds: readonly string[]; firstSeq: number | null }

const selected = new Map<string, Selection>();
const filters = new Map<string, TimelineFilter>();
const listeners = new Set<() => void>();
const DIM_STYLE_ID = "studio-strand-dim-style";
let hostFilters = false;

const notify = () => { for (const listener of listeners) listener(); };

export function select(threadId: string, value: Selection | null): void {
  if (value) selected.set(threadId, value); else selected.delete(threadId);
  filters.delete(threadId);
  notify();
}

/** The strand's turns and first message, as the tags give them; a no-op when unchanged. */
export function setStrandTurns(threadId: string, strandId: string, turnIds: readonly string[], firstSeq: number | null): void {
  const current = selected.get(threadId);
  if (!current || current.strandId !== strandId) return;
  const same = !!current.turnIds && current.turnIds.length === turnIds.length && current.turnIds.every((id, index) => id === turnIds[index]) && (current.firstSeq ?? null) === firstSeq;
  if (same) return;
  selected.set(threadId, { ...current, turnIds: [...turnIds], firstSeq });
  filters.delete(threadId);
  notify();
}

export function selectionOf(threadId: string): Selection | null { return selected.get(threadId) ?? null; }

/** The thread's timeline filter for BB: the same object while it is unchanged; null with no strand picked or its turns not known yet. */
export function timelineFilterOf(threadId: string): TimelineFilter | null {
  const selection = selected.get(threadId);
  if (!selection?.turnIds?.length) return null;
  let filter = filters.get(threadId);
  if (!filter) { filter = { turnIds: selection.turnIds, firstSeq: selection.firstSeq ?? null }; filters.set(threadId, filter); }
  return filter;
}

export const subscribeSelection = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useSelection(threadId: string): Selection | null {
  return useSyncExternalStore(subscribeSelection, () => selected.get(threadId) ?? null, () => null);
}

interface TimelineFilterSlots {
  experimental_timelineFilter?: (registration: { id: string; get(threadId: string): TimelineFilter | null; subscribe(listener: () => void): () => void }) => void;
}

/** Hands the filter to BB's timeline (`slots.experimental_timelineFilter`). False on a BB without it, where the tags dim instead. */
export function registerTimelineFilter(slots: object): boolean {
  const target = slots as TimelineFilterSlots;
  if (typeof target.experimental_timelineFilter !== "function") return false;
  target.experimental_timelineFilter({ id: "strands", get: timelineFilterOf, subscribe: subscribeSelection });
  hostFilters = true;
  return true;
}

/** Whether BB's timeline hides the other strands' messages itself. */
export const timelineFiltersInHost = () => hostFilters;

/** Test hook: a fresh app (no host filter, nothing picked). */
export function resetSelectionForTests(): void { hostFilters = false; selected.clear(); filters.clear(); }

/** The rule that dims the other strands' messages (where BB can't hide them), once per document. */
export function ensureDimStyle(doc: Document = document): void {
  if (doc.getElementById(DIM_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = DIM_STYLE_ID;
  // Dimmed rows; and a tag's "Move to…" shows while its message is hovered or the menu is open.
  style.textContent = "[data-studio-strand-dim]{opacity:.3;transition:opacity .2s}@media (prefers-reduced-motion:reduce){[data-studio-strand-dim]{transition:none}}"
    + "[data-strand-move]{opacity:0}[data-timeline-row-id]:hover [data-strand-move],[data-strand-move]:focus-visible,[data-strand-move][data-state=open]{opacity:1}";
  doc.head.appendChild(style);
}
