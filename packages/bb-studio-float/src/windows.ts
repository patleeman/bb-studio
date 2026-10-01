// The open windows, as plain data and the changes that can happen to them.
// The store (store.ts) keeps one list per browser window; these functions
// don't touch it, so they're easy to test.
import type { FloatOpenOptions, FloatTarget } from "@bb-studio/kit/app";

export interface FloatWindow {
  key: string;
  target: FloatTarget;
  minimized: boolean;
  /** The caller's tag from `openFloat`, if any. */
  tag?: string;
}

export interface FloatState {
  /** Oldest first; the newest sits nearest the right edge. */
  windows: FloatWindow[];
  /** Mod+Shift+J puts every window away and brings them back. */
  hidden: boolean;
}

export const EMPTY: FloatState = { windows: [], hidden: false };

/** More than this and the oldest closes; the overflow menu can't usefully list more. */
export const MAX_WINDOWS = 12;

export const windowKey = (target: FloatTarget): string =>
  target.kind === "thread" ? `thread:${target.threadId}` : `path:${target.path}`;

function isTarget(value: unknown): value is FloatTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  if (target.title !== undefined && typeof target.title !== "string") return false;
  if (target.kind === "thread") return typeof target.threadId === "string" && target.threadId !== "";
  if (target.kind === "path") return typeof target.path === "string" && target.path.startsWith("/");
  return false;
}

/** A saved state, dropping anything malformed. */
export function parseState(raw: unknown): FloatState {
  if (!raw || typeof raw !== "object") return EMPTY;
  const saved = raw as { windows?: unknown; hidden?: unknown };
  const seen = new Set<string>();
  const windows: FloatWindow[] = [];
  for (const entry of Array.isArray(saved.windows) ? saved.windows : []) {
    const target = (entry as { target?: unknown })?.target;
    if (!isTarget(target)) continue;
    const key = windowKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    const tag = (entry as { tag?: unknown }).tag;
    windows.push({ key, target, minimized: (entry as { minimized?: unknown }).minimized === true, ...(typeof tag === "string" ? { tag } : {}) });
  }
  return { windows: windows.slice(-MAX_WINDOWS), hidden: saved.hidden === true };
}

/**
 * Opens `target`: a window already showing it comes up where it is, anything
 * else joins at the right. With a tag, a still-minimized window opened under
 * that tag gives its place to the new one.
 */
export function openWindow(state: FloatState, target: FloatTarget, options: FloatOpenOptions = {}): FloatState {
  const key = windowKey(target);
  const minimized = options.minimized === true;
  const existing = state.windows.find((window) => window.key === key);
  let windows: FloatWindow[];
  if (existing) {
    windows = state.windows.map((window) => {
      if (window.key === key) {
        return {
          ...window,
          target: { ...window.target, ...target },
          // Asking for a minimized window never folds one that's open.
          minimized: minimized && window.minimized,
          ...(options.tag ? { tag: options.tag } : {}),
        };
      }
      // A tag follows the window it was last given to.
      return options.tag && window.tag === options.tag ? withoutTag(window) : window;
    });
  } else {
    const next: FloatWindow = { key, target, minimized, ...(options.tag ? { tag: options.tag } : {}) };
    const replaced = options.tag ? state.windows.findIndex((window) => window.tag === options.tag) : -1;
    if (replaced >= 0 && state.windows[replaced]!.minimized) {
      windows = state.windows.map((window, index) => (index === replaced ? next : window));
    } else {
      windows = [...state.windows.map((window) => (options.tag && window.tag === options.tag ? withoutTag(window) : window)), next];
    }
  }
  // Something minimized can wait for the user to show the windows again.
  return { windows: windows.slice(-MAX_WINDOWS), hidden: minimized ? state.hidden : false };
}

function withoutTag(window: FloatWindow): FloatWindow {
  const { tag: _tag, ...rest } = window;
  return rest;
}

export const closeWindow = (state: FloatState, key: string): FloatState => ({
  ...state,
  windows: state.windows.filter((window) => window.key !== key),
});

export const setMinimized = (state: FloatState, key: string, minimized: boolean): FloatState => ({
  ...state,
  windows: state.windows.map((window) => (window.key === key ? { ...window, minimized } : window)),
});

/** Moves a window to the right end, where it's sure to be shown, and opens it. */
export function bringForward(state: FloatState, key: string): FloatState {
  const window = state.windows.find((entry) => entry.key === key);
  if (!window) return state;
  return {
    hidden: false,
    windows: [...state.windows.filter((entry) => entry.key !== key), { ...window, minimized: false }],
  };
}

export const toggleHidden = (state: FloatState): FloatState =>
  state.windows.length ? { ...state, hidden: !state.hidden } : state;

export const EXPANDED_WIDTH = 400;
export const MINIMIZED_WIDTH = 240;
export const GAP = 8;

/**
 * How many windows, counted from the newest, fit in `room` pixels. The newest
 * always shows; the rest go in the overflow menu, which takes a slot itself.
 */
export function fitCount(widths: readonly number[], room: number, overflowWidth: number): number {
  let used = 0;
  for (let count = 0; count < widths.length; count += 1) {
    const width = widths[widths.length - 1 - count]! + (count ? GAP : 0);
    const left = widths.length - count - 1;
    // While windows remain beyond this one, keep room for the menu.
    const reserve = left ? GAP + overflowWidth : 0;
    if (count && used + width + reserve > room) return count;
    used += width;
  }
  return widths.length;
}
