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
  }) => { zoom?: boolean } | void;
}

/** Hands the filter to BB's timeline (`slots.experimental_timelineFilter`). False on a BB without it, where the tags dim instead. */
export function registerTimelineFilter(slots: object, zoomView?: ZoomViewComponent): boolean {
  const target = slots as TimelineFilterSlots;
  if (typeof target.experimental_timelineFilter !== "function") return false;
  // A BB whose timeline folds runs (the fork's seam) asks foldsOf; an older one ignores it and folds nothing.
  // One that zooms (the fork's zoom seam) draws zoomView while a conversation is zoomed out; an older one never zooms.
  const host = target.experimental_timelineFilter({
    id: "strands", get: timelineFilterOf, subscribe: subscribeSelection, folds: foldsOf, expandFold: openFold,
    ...(zoomView ? { zoom: { level: shownZoomOf, View: zoomView } } : {}),
  });
  hostFilters = true;
  // Only a BB that says it draws `zoom` zooms; one that takes the registration and drops `zoom` answers nothing.
  hostZooms = !!zoomView && !!host && typeof host === "object" && host.zoom === true;
  return true;
}

// ---- semantic zoom: 0 messages (BB's timeline), 1 strands, 2 the tree ----

/** The furthest out a conversation zooms (2: the tree). */
export const ZOOM_MAX = 2;
const zoomLevels = new Map<string, number>();
let hostZooms = false;

/** Whether BB draws a zoomed-out conversation (the fork's zoom seam). */
export const zoomInHost = () => hostZooms;

/** Conversations whose strands run (a header's switch is up, counted per header): only they zoom. */
const zoomable = new Map<string, number>();

/** A conversation's zoom level: 0 shows its messages. */
export function zoomOf(threadId: string): number {
  return zoomLevels.get(threadId) ?? 0;
}

/** The level BB draws: 0 unless the conversation's strands run, so turning them off gives the messages back. */
export function shownZoomOf(threadId: string): number {
  return zoomable.has(threadId) ? zoomOf(threadId) : 0;
}

/** A header shows the conversation's switch (its strands run): it can zoom until every such header lets go. */
export function holdZoomable(threadId: string): () => void {
  const count = zoomable.get(threadId) ?? 0;
  zoomable.set(threadId, count + 1);
  if (count === 0) notify();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const left = (zoomable.get(threadId) ?? 1) - 1;
    if (left > 0) { zoomable.set(threadId, left); return; }
    zoomable.delete(threadId);
    notify();
  };
}

/** Sets a conversation's zoom level (0…ZOOM_MAX). */
export function setZoom(threadId: string, level: number): void {
  const next = Math.max(0, Math.min(ZOOM_MAX, Math.round(level)));
  if (zoomOf(threadId) === next) return;
  if (next === 0) zoomLevels.delete(threadId); else zoomLevels.set(threadId, next);
  // Keyboard mode lives on the tree only.
  if (next < ZOOM_MAX) keyboardModes.delete(threadId);
  notify();
}

/**
 * The owner sent a message in this conversation: show its messages, unfiltered
 * and zoomed in, so the new message is drawn at once. A strand filter shows
 * only turns strands already tagged, and the new turn is tagged later. The
 * scroll position from before filtering is dropped: BB scrolls to the new message.
 */
export function showSent(threadId: string): void {
  const filtered = selected.has(threadId);
  const zoomed = zoomLevels.has(threadId) || keyboardModes.has(threadId);
  if (!filtered && !zoomed) return;
  marks.delete(threadId);
  selected.delete(threadId);
  filters.delete(threadId);
  zoomLevels.delete(threadId);
  keyboardModes.delete(threadId);
  notify();
}

/** Keyboard mode (Esc Esc): the tree with a search, ↑↓ ←→ and Enter. */
const keyboardModes = new Set<string>();

export function keyboardModeOf(threadId: string): boolean {
  return keyboardModes.has(threadId);
}

/** Turns keyboard mode on (at the tree) or off (staying where it is). */
export function setKeyboardMode(threadId: string, on: boolean): void {
  if (keyboardModes.has(threadId) === on) return;
  if (on) { keyboardModes.add(threadId); zoomLevels.set(threadId, ZOOM_MAX); } else keyboardModes.delete(threadId);
  notify();
}

export function useKeyboardMode(threadId: string): boolean {
  return useSyncExternalStore(subscribeSelection, () => keyboardModes.has(threadId), () => false);
}

export function useZoom(threadId: string): number {
  return useSyncExternalStore(subscribeSelection, () => shownZoomOf(threadId), () => 0);
}

/** Whether BB's timeline hides the other strands' messages itself. */
export const timelineFiltersInHost = () => hostFilters;

/** Test hook: a fresh app (no host filter, nothing picked). */
export function resetSelectionForTests(): void { hostFilters = false; hostZooms = false; zoomLevels.clear(); zoomable.clear(); keyboardModes.clear(); selected.clear(); filters.clear(); marks.clear(); foldTags.clear(); openFolds.clear(); foldCache.clear(); }

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
  // Dimmed rows. (A tag's "Move to…" sits in BB's message footer, which shows on hover or focus.)
  style.textContent = "[data-studio-strand-dim]{opacity:.3;transition:opacity .2s}@media (prefers-reduced-motion:reduce){[data-studio-strand-dim]{transition:none}}";
  doc.head.appendChild(style);
}
