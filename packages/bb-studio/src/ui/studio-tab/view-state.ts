// The Studio tab's last view, kept outside React. BB unmounts a side-panel
// tab's component when another tab is selected, and SDK 0.6.104 gives an
// action tab no way to change its own params (only fixed tabs get a
// memory-only `experimental_target`), so what the tab showed lived only in
// component state and every return opened the list. This keeps it in
// localStorage per tab instance (the thread plus the params BB opened the
// instance with), so a tab switch, a Studio reload or an app restart comes
// back to the same page, artifact, design or list, scrolled where it was.
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { tabKind, type TabKindInfo, type TabTarget } from "./model";

/** Where a scrolled element sits under the tab's root (child indices) and how far down it was. */
export interface TabScroll {
  path: number[];
  top: number;
}

/** One Studio tab instance's view: what it shows, the list's kind filter, and its scroll. */
export interface TabViewState {
  target: TabTarget;
  filter: string | null;
  scroll: TabScroll | null;
  /** When it was saved, to keep only the most recent instances. */
  at: number;
}

export const VIEW_STORAGE_KEY = "bb-studio:studio-tab-views";
/** Tab instances remembered, most recent first. */
export const VIEW_LIMIT = 50;

/** The instance key: thread and params, as BB tells instances apart. */
export function viewKey(threadId: string, params: JsonValue | null | undefined): string {
  return `${threadId}|${JSON.stringify(params ?? null)}`;
}

type Store = Record<string, TabViewState>;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readStore(): Store {
  try {
    const raw = storage()?.getItem(VIEW_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  const kept = Object.entries(store).sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0)).slice(0, VIEW_LIMIT);
  try {
    storage()?.setItem(VIEW_STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Full or blocked storage: the tab still works, it just won't come back.
  }
}

const isScroll = (value: unknown): value is TabScroll => {
  const scroll = value as TabScroll | null;
  return Boolean(scroll) && Array.isArray(scroll!.path) && scroll!.path.every((each) => Number.isInteger(each) && each >= 0) && typeof scroll!.top === "number" && scroll!.top >= 0;
};

/**
 * A saved target the tab can still show: a kind that's on with an id of that
 * kind, the save picker while artifacts are on, or the list. Null otherwise.
 */
export function validTarget(value: unknown, enabled: readonly TabKindInfo[]): TabTarget | null {
  const target = value as Record<string, unknown> | null;
  if (!target || typeof target !== "object") return null;
  if (target.view === "list") return { view: "list" };
  const on = (kind: string) => enabled.some((each) => each.kind === kind);
  if (target.view === "save") {
    const seq = target.seq;
    return on("artifact") ? { view: "save", seq: typeof seq === "number" && Number.isInteger(seq) && seq >= 0 ? seq : null } : null;
  }
  if (target.view === "item" && typeof target.kind === "string" && typeof target.id === "string") {
    const info = tabKind(target.kind);
    return info && on(info.kind) && info.isId(target.id) ? { view: "item", kind: info.kind, id: target.id } : null;
  }
  return null;
}

/** The view saved for this instance, checked against the kinds still on; null when there's none to restore. */
export function loadView(key: string, enabled: readonly TabKindInfo[]): TabViewState | null {
  const saved = readStore()[key];
  if (!saved) return null;
  const target = validTarget(saved.target, enabled);
  if (!target) return null;
  return {
    target,
    filter: typeof saved.filter === "string" ? saved.filter : null,
    scroll: isScroll(saved.scroll) ? { path: [...saved.scroll.path], top: saved.scroll.top } : null,
    at: typeof saved.at === "number" ? saved.at : 0,
  };
}

/** Saves this instance's view. */
export function saveView(key: string, view: Omit<TabViewState, "at">, now = Date.now()): void {
  const store = readStore();
  store[key] = { ...view, at: now };
  writeStore(store);
}

/**
 * Forgets the view of every instance opened with `params`: a card that opens
 * the tab on its item should show that item, not where the tab was left.
 */
export function forgetView(params: JsonValue | null | undefined): void {
  const suffix = `|${JSON.stringify(params ?? null)}`;
  const store = readStore();
  let changed = false;
  for (const key of Object.keys(store)) {
    if (key.endsWith(suffix)) { delete store[key]; changed = true; }
  }
  if (changed) writeStore(store);
  // An instance on screen goes back to what it was opened on.
  for (const [key, listeners] of forgotten) {
    if (key.endsWith(suffix)) for (const listener of [...listeners]) listener();
  }
}

const forgotten = new Map<string, Set<() => void>>();

/** Calls `listener` when forgetView forgets instance `key`. Returns the unsubscribe. */
export function onViewForgotten(key: string, listener: () => void): () => void {
  const listeners = forgotten.get(key) ?? new Set();
  listeners.add(listener);
  forgotten.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) forgotten.delete(key);
  };
}

/** Two targets that show the same thing. */
export function sameTarget(a: TabTarget, b: TabTarget): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `element`'s child-index path under `root`; null when it isn't inside it. */
export function elementPath(root: Element, element: Element): number[] | null {
  const path: number[] = [];
  let node: Element | null = element;
  while (node && node !== root) {
    const parent: Element | null = node.parentElement;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.children, node) as number);
    node = parent;
  }
  return node === root ? path : null;
}

/** The element at `path` under `root`, or null while it isn't there. */
export function elementAt(root: Element, path: readonly number[]): Element | null {
  let node: Element | null = root;
  for (const index of path) {
    node = node?.children[index] ?? null;
    if (!node) return null;
  }
  return node;
}

/**
 * Scrolls the element at `scroll.path` back to `scroll.top`, once it exists
 * and has grown tall enough (views load their content after they mount).
 * True when it got there; call it again on the next frame otherwise.
 */
export function applyScroll(root: Element, scroll: TabScroll): boolean {
  const element = elementAt(root, scroll.path);
  if (!element) return false;
  const reachable = element.scrollHeight - element.clientHeight;
  if (reachable < scroll.top - 1) return false;
  element.scrollTop = scroll.top;
  return Math.abs(element.scrollTop - scroll.top) <= 1;
}
