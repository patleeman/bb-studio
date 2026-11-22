// The strand filter on a conversation (a strand picked in the box, a tag or
// the Strands tab), shared by the box above the composer, the message tags
// and the tab, which render in separate slots of one app.
//
// On a BB with `slots.experimental_timelineFilter` (the fork's timeline
// filter), BB's timeline shows only the strand's turns, expanded, and pages
// back to its first message. On a BB without it, the tags dim the other
// strands' messages instead.
import { useSyncExternalStore, type ComponentType } from "react";
import { foldOfSeq, statusRunFolds, type StatusRunFold, type Tags } from "./model";

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
const DIM_STYLE_ID = "studio-strand-dim-style-3";
let hostFilters = false;

const notify = () => { for (const listener of listeners) listener(); };

export function select(threadId: string, value: Selection | null): void {
  const before = selected.get(threadId);
  // Filtering starts: remember where the conversation was scrolled; it clears: go back there exactly.
  if (!before && value) rememberScroll(threadId);
  if (value) selected.set(threadId, value); else selected.delete(threadId);
  filters.delete(threadId);
  notify();
  if (before && !value) restoreScroll(threadId);
}

// ---- the scroll position before filtering ----

interface ScrollMark { scroller: HTMLElement; rowId: string | null; offset: number; top: number }
const marks = new Map<string, ScrollMark>();
const ROW = "[data-timeline-row-id]";

/** The timeline's scrolling element: the nearest ancestor of its rows that scrolls. */
export function timelineScroller(doc: Document = document): HTMLElement | null {
  let node = doc.querySelector(ROW)?.parentElement ?? null;
  while (node && node !== doc.body) {
    const overflow = doc.defaultView?.getComputedStyle(node).overflowY ?? "";
    if (/(auto|scroll|overlay)/.test(overflow)) return node;
    node = node.parentElement;
  }
  return null;
}

/** Notes the first row in view and how far it sits from the top, and the scroll offset as a fallback. */
export function rememberScroll(threadId: string, doc: Document | undefined = typeof document === "undefined" ? undefined : document): void {
  if (!doc) return;
  const scroller = timelineScroller(doc);
  if (!scroller) return;
  const top = scroller.getBoundingClientRect().top;
  const row = [...scroller.querySelectorAll<HTMLElement>(ROW)].find((each) => each.getBoundingClientRect().bottom > top + 1) ?? null;
  marks.set(threadId, { scroller, rowId: row?.getAttribute("data-timeline-row-id") ?? null, offset: row ? row.getBoundingClientRect().top - top : 0, top: scroller.scrollTop });
}

/** Puts that row back at the same distance from the top (rows above it may have loaded meanwhile); the scroll offset when it's gone. */
export function applyScroll(mark: ScrollMark): void {
  const { scroller } = mark;
  const row = mark.rowId ? scroller.querySelector<HTMLElement>(`[data-timeline-row-id="${mark.rowId.replace(/"/g, '\\"')}"]`) : null;
  if (row) scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - mark.offset;
  else scroller.scrollTop = mark.top;
}

/** Restores the remembered position once the rows are back, and again as late rows settle. */
function restoreScroll(threadId: string): void {
  const mark = marks.get(threadId);
  marks.delete(threadId);
  if (!mark || !mark.scroller.isConnected) return;
  const again = () => { if (mark.scroller.isConnected) applyScroll(mark); };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(again)); else again();
  setTimeout(again, 250);
  setTimeout(again, 800);
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

/** What a zoomed-out conversation draws in the timeline's place (BB's `zoom.View`). */
export type ZoomViewComponent = ComponentType<{ threadId: string; level: number; anchorSeq: number | null }>;

interface TimelineFilterSlots {
  experimental_timelineFilter?: (registration: {
    id: string; get(threadId: string): TimelineFilter | null; subscribe(listener: () => void): () => void;
    folds?(threadId: string): readonly StatusRunFold[] | null; expandFold?(threadId: string, id: string): void;
    zoom?: { level(threadId: string): number; View: ZoomViewComponent };
  }) => void;
}

/** Hands the filter to BB's timeline (`slots.experimental_timelineFilter`). False on a BB without it, where the tags dim instead. */
export function registerTimelineFilter(slots: object, zoomView?: ZoomViewComponent): boolean {
  const target = slots as TimelineFilterSlots;
  if (typeof target.experimental_timelineFilter !== "function") return false;
  // A BB whose timeline folds runs (the fork's seam) asks foldsOf; an older one ignores it and folds nothing.
  // One that zooms (the fork's zoom seam) draws zoomView while a conversation is zoomed out; an older one never zooms.
  target.experimental_timelineFilter({
    id: "strands", get: timelineFilterOf, subscribe: subscribeSelection, folds: foldsOf, expandFold: openFold,
    ...(zoomView ? { zoom: { level: zoomOf, View: zoomView } } : {}),
  });
  hostFilters = true;
  hostZooms = !!zoomView;
  return true;
}

// ---- semantic zoom: 0 messages (BB's timeline), 1 strands ----

/** The furthest out a conversation zooms (1: strands; the tree comes later). */
export const ZOOM_MAX = 1;
const zoomLevels = new Map<string, number>();
let hostZooms = false;

/** Whether BB draws a zoomed-out conversation (the fork's zoom seam). */
export const zoomInHost = () => hostZooms;

/** A conversation's zoom level: 0 shows its messages. */
export function zoomOf(threadId: string): number {
  return zoomLevels.get(threadId) ?? 0;
}

/** Sets a conversation's zoom level (0…ZOOM_MAX). */
export function setZoom(threadId: string, level: number): void {
  const next = Math.max(0, Math.min(ZOOM_MAX, Math.round(level)));
  if (zoomOf(threadId) === next) return;
  if (next === 0) zoomLevels.delete(threadId); else zoomLevels.set(threadId, next);
  notify();
}

export function useZoom(threadId: string): number {
  return useSyncExternalStore(subscribeSelection, () => zoomOf(threadId), () => 0);
}

/** Whether BB's timeline hides the other strands' messages itself. */
export const timelineFiltersInHost = () => hostFilters;

/** Test hook: a fresh app (no host filter, nothing picked). */
export function resetSelectionForTests(): void { hostFilters = false; hostZooms = false; zoomLevels.clear(); selected.clear(); filters.clear(); marks.clear(); foldTags.clear(); openFolds.clear(); foldCache.clear(); }

// ---- runs of status replies, folded in BB's timeline ----

const foldTags = new Map<string, Tags>();
/** The turns of the runs the user opened, per conversation. */
const openFolds = new Map<string, Set<string>>();
const foldCache = new Map<string, { tags: Tags; open: number; folds: readonly StatusRunFold[] }>();
let openVersion = 0;

/** A conversation's tags, as its messages' tags read them: the folds follow. */
export function setFoldTags(threadId: string, tags: Tags | null | undefined): void {
  if (!tags || foldTags.get(threadId) === tags) return;
  foldTags.set(threadId, tags);
  notify();
}

/** The runs BB folds in a conversation's timeline: the same array while nothing changed. */
export function foldsOf(threadId: string): readonly StatusRunFold[] | null {
  const tags = foldTags.get(threadId);
  if (!tags) return null;
  const cached = foldCache.get(threadId);
  if (cached && cached.tags === tags && cached.open === openVersion) return cached.folds;
  const folds = statusRunFolds(tags, openFolds.get(threadId));
  foldCache.set(threadId, { tags, open: openVersion, folds });
  return folds;
}

/** The user opened a fold: it stays open (by its turns, so a late tag that moves the run's start keeps it open). */
export function openFold(threadId: string, id: string): void {
  const fold = foldsOf(threadId)?.find((each) => each.id === id);
  if (fold) openTurns(threadId, fold.turnIds);
}

/** Opens the fold that holds message `seq`, before a jump to it. */
export function openFoldOf(threadId: string, seq: number): void {
  const fold = foldOfSeq(foldTags.get(threadId), foldsOf(threadId) ?? [], seq);
  if (fold) openTurns(threadId, fold.turnIds);
}

function openTurns(threadId: string, turnIds: readonly string[]): void {
  const open = openFolds.get(threadId) ?? new Set<string>();
  const before = open.size;
  for (const turnId of turnIds) open.add(turnId);
  if (open.size === before) return;
  openFolds.set(threadId, open);
  openVersion++;
  notify();
}

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
