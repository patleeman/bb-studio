// The stack of floated things, as plain data and the changes that can happen
// to it. Everything floated is a tab in one panel, and one tab shows at a
// time. The store (store.ts) keeps one stack per browser window; these
// functions don't touch it, so they're easy to test.
import type { CompanionPlacement, FloatOpenOptions, FloatTarget } from "@bb-studio/kit/app";

export interface FloatTab {
  /** Missing in older sessions: the tab lives in Float. */
  placement?: CompanionPlacement;
  /** An explicit focus request, independent of title or context changes. */
  activation?: number;
  key: string;
  target: FloatTarget;
  pinned: boolean;
  /** Once shown, a tab can hold a draft or an editor and must stay until closed. */
  opened: boolean;
  /** The caller's tag from `openFloat`, if any. */
  tag?: string;
  /** What the tab showed before following links inside it, newest last. */
  back?: FloatTarget[];
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
  /** Closing the panel blocks background opens until an explicit Float action. */
  dismissed: boolean;
  place: FloatPlace;
  /** The size the panel was resized to; null for the default. */
  size: Size | null;
}

const DOCK: FloatPlace = { kind: "dock" };

export const EMPTY: FloatState = { tabs: [], active: null, collapsed: false, hidden: false, dismissed: false, place: DOCK, size: null };

/** A soft limit for unopened background tabs; user work is never evicted. */
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

function parseSize(raw: unknown): Size | null {
  const size = raw as { width?: unknown; height?: unknown } | null;
  if (Number.isFinite(size?.width) && Number.isFinite(size?.height)) return { width: size!.width as number, height: size!.height as number };
  return null;
}

/** A saved state, dropping anything malformed. */
export function parseState(raw: unknown): FloatState {
  if (!raw || typeof raw !== "object") return EMPTY;
  const saved = raw as { tabs?: unknown; active?: unknown; collapsed?: unknown; hidden?: unknown; dismissed?: unknown; place?: unknown; size?: unknown };
  const seen = new Set<string>();
  const tabs: FloatTab[] = [];
  for (const entry of Array.isArray(saved.tabs) ? saved.tabs : []) {
    const target = (entry as { target?: unknown })?.target;
    if (!isTarget(target)) continue;
    const key = tabKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    const tag = (entry as { tag?: unknown }).tag;
    const pinned = (entry as { pinned?: unknown }).pinned === true;
    const opened = (entry as { opened?: unknown }).opened !== false;
    const placement = (entry as { placement?: unknown }).placement;
    const activation = (entry as { activation?: unknown }).activation;
    const back = (entry as { back?: unknown }).back;
    tabs.push({
      key, target, pinned, opened,
      ...(placement === "main" || placement === "workbench" || placement === "floating" ? { placement } : {}),
      ...(typeof activation === "number" && Number.isSafeInteger(activation) && activation >= 0 ? { activation } : {}),
      ...(typeof tag === "string" ? { tag } : {}),
      ...(Array.isArray(back) ? { back: back.filter(isTarget).slice(-MAX_BACK) } : {}),
    });
  }
  const kept = trim(tabs, typeof saved.active === "string" ? saved.active : null);
  const active = kept.find((tab) => tab.key === saved.active)?.key ?? kept.at(-1)?.key ?? null;
  return {
    tabs: kept,
    active,
    collapsed: saved.collapsed === true,
    hidden: saved.hidden === true,
    dismissed: saved.dismissed === true,
    place: parsePlace(saved.place),
    size: parseSize(saved.size),
  };
}

function withoutTag(tab: FloatTab): FloatTab {
  const { tag: _tag, ...rest } = tab;
  return rest;
}

/** Past the soft limit, discard only unopened background tabs. */
function trim(tabs: FloatTab[], active: string | null): FloatTab[] {
  const extra = tabs.length - MAX_TABS;
  if (extra <= 0) return tabs;
  const dropped = new Set(tabs.filter((tab) => !tab.pinned && !tab.opened && tab.key !== active).slice(0, extra).map((tab) => tab.key));
  return tabs.filter((tab) => !dropped.has(tab.key));
}

/**
 * Opens `target` as a tab and shows it. A tab already showing it is reused
 * where it is; anything else joins at the end. With `minimized`, the tab
 * opens behind the one showing (or, in an empty stack, folded). With a tag,
 * an unopened, unpinned tab under that tag gives its place to the new one.
 */
export function openTab(state: FloatState, target: FloatTarget, options: FloatOpenOptions = {}): FloatState {
  const key = tabKey(target);
  const background = options.minimized === true;
  if (background && state.dismissed) return state;
  const tag = options.tag;
  const viewing = (candidate: string) => candidate === state.active && !state.collapsed && !state.hidden;
  const untag = (tab: FloatTab) => (tag && tab.tag === tag ? withoutTag(tab) : tab);
  let tabs: FloatTab[];
  let active = state.active;
  if (state.tabs.some((tab) => tab.key === key)) {
    tabs = state.tabs.map((tab) =>
      // A tag follows the tab it was last given to.
      tab.key === key ? { ...tab, activation: background ? (tab.activation ?? 0) : (tab.activation ?? 0) + 1, opened: tab.opened || !background, target: { ...tab.target, ...target }, ...(tag ? { tag } : {}) } : untag(tab),
    );
  } else {
    const next: FloatTab = { key, target, pinned: false, opened: !background, placement: options.placement ?? "floating", activation: background ? 0 : 1, ...(tag ? { tag } : {}) };
    const replaced = tag ? state.tabs.find((tab) => tab.tag === tag) : undefined;
    if (replaced && !replaced.pinned && !replaced.opened && !viewing(replaced.key)) {
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
  return { ...state, tabs: trim(tabs, key), active: key, collapsed: false, hidden: false, dismissed: false };
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

/** Closes every tab and blocks background opens. Keeps the panel's place and size. */
export const closeAll = (state: FloatState): FloatState => ({ ...EMPTY, dismissed: true, place: state.place, size: state.size });

/** Past this, a tab forgets the oldest place it can go back to. */
export const MAX_BACK = 20;

/** A pinned companion keeps its target when other items or links open. */
export function pinTab(state: FloatState, key: string, pinned: boolean): FloatState {
  if (!state.tabs.some((tab) => tab.key === key && tab.pinned !== pinned)) return state;
  return { ...state, tabs: state.tabs.map((tab) => tab.key === key ? { ...tab, pinned } : tab) };
}

/**
 * Follows a link inside a tab: the tab shows `target`, and can go back to
 * what it showed. If another tab already shows `target`, that tab shows and
 * this one closes, so nothing is open twice.
 */
export function navigateTab(state: FloatState, key: string, target: FloatTarget): FloatState {
  const tab = state.tabs.find((candidate) => candidate.key === key);
  if (!tab) return state;
  const nextKey = tabKey(target);
  if (nextKey === key) return state;
  if (tab.pinned) return openTab(state, target);
  if (state.tabs.some((candidate) => candidate.key === nextKey)) {
    const tabs = state.tabs.filter((candidate) => candidate.key !== key);
    return { ...state, tabs, active: nextKey, collapsed: false, hidden: false };
  }
  const back = [...(tab.back ?? []), tab.target].slice(-MAX_BACK);
  const next: FloatTab = { key: nextKey, target, pinned: false, opened: true, placement: tab.placement, activation: (tab.activation ?? 0) + 1, back };
  return {
    ...state,
    tabs: state.tabs.map((candidate) => (candidate.key === key ? next : candidate)),
    active: state.active === key ? nextKey : state.active,
  };
}

/** Takes a tab back to what it showed before its last link. */
export function goBack(state: FloatState, key: string): FloatState {
  const tab = state.tabs.find((candidate) => candidate.key === key);
  const previous = tab?.back?.at(-1);
  if (!tab || !previous) return state;
  const previousKey = tabKey(previous);
  if (state.tabs.some((candidate) => candidate.key === previousKey)) return selectTab(closeTab(state, key), previousKey);
  const next: FloatTab = { key: previousKey, target: previous, pinned: tab.pinned, opened: true, placement: tab.placement, activation: (tab.activation ?? 0) + 1, back: tab.back!.slice(0, -1) };
  return {
    ...state,
    tabs: state.tabs.map((candidate) => (candidate.key === key ? next : candidate)),
    active: state.active === key ? previousKey : state.active,
  };
}

/** Puts `target` in the tab instead of what it showed, for swapping with the main view. */
export function replaceTab(state: FloatState, key: string, target: FloatTarget): FloatState {
  const nextKey = tabKey(target);
  if (nextKey === key || state.tabs.some((candidate) => candidate.key === nextKey)) return state;
  const tabs = state.tabs.map((candidate) => (candidate.key === key ? { key: nextKey, target, pinned: candidate.pinned, opened: true } : candidate));
  return { ...state, tabs, active: state.active === key ? nextKey : state.active };
}

/** Shows a tab, opening the panel if it's folded or hidden. */
export function selectTab(state: FloatState, key: string): FloatState {
  if (!state.tabs.some((tab) => tab.key === key)) return state;
  return { ...state, tabs: state.tabs.map((tab) => tab.key === key ? { ...tab, opened: true, activation: (tab.activation ?? 0) + 1 } : tab), active: key, collapsed: false, hidden: false };
}

/** Move the existing tab without replacing its identity, target, history, or live view. */
export function moveCompanion(state: FloatState, key: string, placement: CompanionPlacement): FloatState {
  if (!state.tabs.some((tab) => tab.key === key)) return state;
  return { ...state, tabs: state.tabs.map((tab) => tab.key === key ? { ...tab, placement, opened: true, activation: (tab.activation ?? 0) + 1 } : tab), active: key, hidden: false, collapsed: false };
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

/** Resizes the panel, null for the default size, and moves it when given a place. */
export const resizeTo = (state: FloatState, size: Size | null, place: FloatPlace = state.place): FloatState => ({ ...state, size, place });

// Layout.

export const PANEL_WIDTH = 400;
export const PANEL_HEIGHT = 560;
/** Resized no smaller than this. */
export const MIN_SIZE: Size = { width: 300, height: 200 };
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

/** The panel's width and open height on `screen`: its own size, or the default. */
export function panelSize(size: Size | null, screen: Size): Size {
  return {
    width: Math.min(size?.width ?? PANEL_WIDTH, screen.width - MARGIN * 2),
    height: size ? Math.min(size.height, screen.height - MARGIN) : Math.min(PANEL_HEIGHT, screen.height - 96),
  };
}

/** A side or corner of the panel, as compass points. */
export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Docked, the panel's bottom and right stay put. */
export const DOCK_EDGES: readonly Edge[] = ["n", "w", "nw"];
export const FREE_EDGES: readonly Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const between = (value: number, low: number, high: number) => Math.round(Math.max(low, Math.min(value, high)));

/** The panel's rect after dragging `edge` by `dx`, `dy`: at least MIN_SIZE, and on the screen. */
export function resizeRect(start: Rect, edge: Edge, dx: number, dy: number, screen: Size): Rect {
  let left = start.left;
  let top = start.top;
  let right = start.left + start.width;
  let bottom = start.top + start.height;
  if (edge.includes("w")) left = between(left + dx, Math.min(MARGIN, left), right - MIN_SIZE.width);
  if (edge.includes("e")) right = between(right + dx, left + MIN_SIZE.width, Math.max(screen.width - MARGIN, right));
  if (edge.includes("n")) top = between(top + dy, Math.min(MARGIN, top), bottom - MIN_SIZE.height);
  if (edge.includes("s")) bottom = between(bottom + dy, top + MIN_SIZE.height, Math.max(screen.height, bottom));
  return { left, top, width: right - left, height: bottom - top };
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
