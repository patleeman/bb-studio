// The stack of floated things, as plain data and the changes that can happen
// to it. Everything floated is a tab in one panel, and one tab shows at a
// time. The store (store.ts) keeps one stack per browser window; these
// functions don't touch it, so they're easy to test.
import type { FloatOpenOptions, FloatTarget } from "@bb-studio/kit/app";

export interface FloatTab {
  key: string;
  target: FloatTarget;
  /** The caller's tag from `openFloat`, if any. */
  tag?: string;
}

/**
 * Where the panel sits: docked at the bottom right, or wherever it was
 * dropped. A free panel is placed by its left edge and its gap above the
 * bottom of the screen, so opening it grows it upward, as it does docked.
 */
export type FloatPlace = { kind: "dock" } | { kind: "free"; left: number; bottom: number };

export interface FloatState {
  /** In the order the tab strip shows them. */
  tabs: FloatTab[];
  active: string | null;
  /** Folded to its tab strip. */
  collapsed: boolean;
  /** Mod+Shift+J puts the panel away and brings it back. */
  hidden: boolean;
  place: FloatPlace;
}

const DOCK: FloatPlace = { kind: "dock" };

export const EMPTY: FloatState = { tabs: [], active: null, collapsed: false, hidden: false, place: DOCK };

/** More than this and the oldest closes; the tab menu can't usefully list more. */
export const MAX_TABS = 12;

export const tabKey = (target: FloatTarget): string =>
  target.kind === "thread" ? `thread:${target.threadId}` : `path:${target.path}`;

function isTarget(value: unknown): value is FloatTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  if (target.title !== undefined && typeof target.title !== "string") return false;
  if (target.kind === "thread") return typeof target.threadId === "string" && target.threadId !== "";
  if (target.kind === "path") return typeof target.path === "string" && target.path.startsWith("/");
  return false;
}

function parsePlace(raw: unknown): FloatPlace {
  const place = raw as { kind?: unknown; left?: unknown; bottom?: unknown } | null;
  if (place?.kind === "free" && Number.isFinite(place.left) && Number.isFinite(place.bottom)) {
    return { kind: "free", left: place.left as number, bottom: place.bottom as number };
  }
  return DOCK;
}

/** A saved state, dropping anything malformed. */
export function parseState(raw: unknown): FloatState {
  if (!raw || typeof raw !== "object") return EMPTY;
  const saved = raw as { tabs?: unknown; active?: unknown; collapsed?: unknown; hidden?: unknown; place?: unknown };
  const seen = new Set<string>();
  const tabs: FloatTab[] = [];
  for (const entry of Array.isArray(saved.tabs) ? saved.tabs : []) {
    const target = (entry as { target?: unknown })?.target;
    if (!isTarget(target)) continue;
    const key = tabKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    const tag = (entry as { tag?: unknown }).tag;
    tabs.push({ key, target, ...(typeof tag === "string" ? { tag } : {}) });
  }
  const kept = tabs.slice(-MAX_TABS);
  const active = kept.find((tab) => tab.key === saved.active)?.key ?? kept.at(-1)?.key ?? null;
  return {
    tabs: kept,
    active,
    collapsed: saved.collapsed === true,
    hidden: saved.hidden === true,
    place: parsePlace(saved.place),
  };
}

function withoutTag(tab: FloatTab): FloatTab {
  const { tag: _tag, ...rest } = tab;
  return rest;
}

/** Past the limit, the oldest tabs close, never the one showing. */
function trim(tabs: FloatTab[], active: string | null): FloatTab[] {
  const extra = tabs.length - MAX_TABS;
  if (extra <= 0) return tabs;
  const dropped = new Set(tabs.filter((tab) => tab.key !== active).slice(0, extra).map((tab) => tab.key));
  return tabs.filter((tab) => !dropped.has(tab.key));
}

/**
 * Opens `target` as a tab and shows it. A tab already showing it is reused
 * where it is; anything else joins at the end. With `minimized`, the tab
 * opens behind the one showing (or, in an empty stack, folded). With a tag,
 * a tab opened under that tag gives its place to the new one, unless you're
 * looking at it.
 */
export function openTab(state: FloatState, target: FloatTarget, options: FloatOpenOptions = {}): FloatState {
  const key = tabKey(target);
  const background = options.minimized === true;
  const tag = options.tag;
  const viewing = (candidate: string) => candidate === state.active && !state.collapsed && !state.hidden;
  const untag = (tab: FloatTab) => (tag && tab.tag === tag ? withoutTag(tab) : tab);
  let tabs: FloatTab[];
  let active = state.active;
  if (state.tabs.some((tab) => tab.key === key)) {
    tabs = state.tabs.map((tab) =>
      // A tag follows the tab it was last given to.
      tab.key === key ? { ...tab, target: { ...tab.target, ...target }, ...(tag ? { tag } : {}) } : untag(tab),
    );
  } else {
    const next: FloatTab = { key, target, ...(tag ? { tag } : {}) };
    const replaced = tag ? state.tabs.find((tab) => tab.tag === tag) : undefined;
    if (replaced && !viewing(replaced.key)) {
      tabs = state.tabs.map((tab) => (tab === replaced ? next : tab));
      if (active === replaced.key) active = key;
    } else {
      tabs = [...state.tabs.map(untag), next];
    }
  }
  if (background) {
    active ??= key;
    // Something opened behind can wait for the user to show the panel again.
    return { ...state, tabs: trim(tabs, active), active, collapsed: state.tabs.length ? state.collapsed : true };
  }
  return { ...state, tabs: trim(tabs, key), active: key, collapsed: false, hidden: false };
}

/** Closes a tab; closing the one showing shows its neighbour. */
export function closeTab(state: FloatState, key: string): FloatState {
  const index = state.tabs.findIndex((tab) => tab.key === key);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.key !== key);
  if (!tabs.length) return closeAll(state);
  const active = state.active === key ? tabs[Math.min(index, tabs.length - 1)]!.key : state.active;
  return { ...state, tabs, active };
}

/** Closes every tab. The panel keeps its place for next time. */
export const closeAll = (state: FloatState): FloatState => ({ ...EMPTY, place: state.place });

/** Shows a tab, opening the panel if it's folded or hidden. */
export function selectTab(state: FloatState, key: string): FloatState {
  if (!state.tabs.some((tab) => tab.key === key)) return state;
  return { ...state, active: key, collapsed: false, hidden: false };
}

/** Moves a tab to `index` in the strip. */
export function moveTab(state: FloatState, key: string, index: number): FloatState {
  const from = state.tabs.findIndex((tab) => tab.key === key);
  if (from < 0) return state;
  const to = Math.max(0, Math.min(index, state.tabs.length - 1));
  if (to === from) return state;
  const tabs = state.tabs.filter((tab) => tab.key !== key);
  tabs.splice(to, 0, state.tabs[from]!);
  return { ...state, tabs };
}

export const toggleCollapsed = (state: FloatState): FloatState =>
  state.tabs.length ? { ...state, collapsed: !state.collapsed } : state;

export const toggleHidden = (state: FloatState): FloatState =>
  state.tabs.length ? { ...state, hidden: !state.hidden } : state;

export const placeAt = (state: FloatState, place: FloatPlace): FloatState => ({ ...state, place });

// Layout.

export const PANEL_WIDTH = 400;
/** The tab strip's height, and all a folded panel shows. */
export const HEADER_HEIGHT = 40;
/** How far from the screen's edges a free panel stays. */
export const MARGIN = 8;
/** Dropped with its bottom this close to the screen's, the panel docks. */
export const DOCK_SNAP = 48;

export interface Size {
  width: number;
  height: number;
}

/** Keeps a free panel on screen, header included, however the screen changes. */
export function clampFree(left: number, bottom: number, panel: Size, screen: Size): { left: number; bottom: number } {
  const maxLeft = Math.max(MARGIN, screen.width - panel.width - MARGIN);
  const maxBottom = Math.max(0, screen.height - panel.height - MARGIN);
  return {
    left: Math.round(Math.min(Math.max(left, MARGIN), maxLeft)),
    bottom: Math.round(Math.min(Math.max(bottom, 0), maxBottom)),
  };
}

/** Where the panel lands when dropped with its bottom-left corner at `left`, `bottom`. */
export function dropPlace(left: number, bottom: number, panel: Size, screen: Size): FloatPlace {
  if (bottom < DOCK_SNAP) return DOCK;
  return { kind: "free", ...clampFree(left, bottom, panel, screen) };
}

export const LABELED_TAB_WIDTH = 96;
export const ICON_TAB_WIDTH = 32;
const ACTIVE_TAB_WIDTH = 140;

/**
 * How the strip fits `count` tabs in `width` pixels: every tab labeled while
 * they fit, else the active one labeled and the rest as icons, as many as fit
 * around the active one. The rest are in the tab menu.
 */
export function stripLayout(count: number, activeIndex: number, width: number): { labeled: boolean; start: number; end: number } {
  if (count * LABELED_TAB_WIDTH <= width) return { labeled: true, start: 0, end: count };
  const fits = Math.max(1, 1 + Math.floor((width - ACTIVE_TAB_WIDTH) / ICON_TAB_WIDTH));
  const shown = Math.min(count, fits);
  const active = Math.max(0, activeIndex);
  const start = Math.max(0, Math.min(active - Math.floor(shown / 2), count - shown));
  return { labeled: false, start, end: start + shown };
}
