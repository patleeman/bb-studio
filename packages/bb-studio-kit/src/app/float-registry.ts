// Where floating tabs meet the plugins that fill them.
//
// The Float plugin draws the panel of floated tabs, and threads, which BB's
// ThreadChat renders anywhere. Any other content belongs to another plugin,
// and BB has no way to embed one plugin's view in another's. So each plugin
// registers the panel paths it can show, the Float plugin publishes an empty
// element for the tab showing, and the plugin that owns the tab's path
// portals its panel into it. Every plugin bundles its own copy of the kit, so
// the registry lives on `window` under a versioned key and every copy uses
// the same shape. ("Window" in the names below means a floated tab.)

/** What a window shows: a thread, or an in-app path such as an item's href. */
export type FloatTarget =
  | { kind: "thread"; threadId: string; title?: string }
  | { kind: "path"; path: string; title?: string; icon?: string };

export interface FloatOpenOptions {
  /** Native companion placement when supported. Legacy callers still request Float. */
  placement?: "floating" | "workbench" | "main";
  /** Open as a tab behind the one showing (folded, if it's the only one). */
  minimized?: boolean;
  /**
   * Stands in for whichever tab a caller opened last under the same tag,
   * unless you're looking at it: e.g. Studio Chat bringing back the chat of
   * each item you look at without adding a tab per item.
   */
  tag?: string;
}

export interface FloatHost {
  open(target: FloatTarget, options?: FloatOpenOptions): void;
  /** Shows `target` in the tab with `windowKey` instead of what it showed. Missing in older Float builds. */
  navigate?(windowKey: string, target: FloatTarget): void;
}

/** A plugin's panel that can show in a window: paths under /plugins/<pluginId>/<path>. */
export interface FloatPanelInfo {
  pluginId: string;
  path: string;
}

/** A window's body waiting for its content. */
export interface FloatAnchor {
  windowKey: string;
  target: FloatTarget;
  element: HTMLElement;
  placement?: "floating" | "workbench" | "main";
}

/** A nav pane that can lend its existing view to a companion. */
export interface MainAnchor {
  id: string;
  target: Extract<FloatTarget, { kind: "path" }>;
  element: HTMLElement;
  setMoved(moved: boolean): void;
  focusOrder?: number;
}

interface Registry {
  host: FloatHost | null;
  panels: Map<string, FloatPanelInfo>;
  /** Window bodies by window key. */
  anchors: Map<string, FloatAnchor>;
  main?: Map<string, MainAnchor>;
  focusOrder?: number;
  transfers?: Map<string, { target: FloatTarget; timer: ReturnType<typeof setTimeout> }>;
  /** Room above each thread window's messages, by window key. */
  leading: Map<string, FloatAnchor>;
  /** The dock's own corner, right of the windows. */
  dock: HTMLElement | null;
  revision: number;
}

const REGISTRY_KEY = "__bbStudioFloat_v1";
export const FLOAT_CHANGE_EVENT = "bb-studio-float-change";
export const MAIN_REMOVING_EVENT = "bb-studio-main-removing";

function registry(): Registry {
  const scope = window as unknown as Record<string, Registry | undefined>;
  scope[REGISTRY_KEY] ??= { host: null, panels: new Map(), anchors: new Map(), leading: new Map(), dock: null, revision: 0 };
  return scope[REGISTRY_KEY];
}

function changed(): void {
  registry().revision += 1;
  window.dispatchEvent(new Event(FLOAT_CHANGE_EVENT));
}

export const floatRevision = (): number => registry().revision;

export function subscribeFloat(listener: () => void): () => void {
  window.addEventListener(FLOAT_CHANGE_EVENT, listener);
  return () => window.removeEventListener(FLOAT_CHANGE_EVENT, listener);
}

export const floatWindowKey = (target: FloatTarget): string =>
  target.kind === "thread" ? `thread:${target.threadId}` : `path:${target.path}`;

// Host side -------------------------------------------------------------------

export function setFloatHost(host: FloatHost | null): void {
  registry().host = host;
  if (!host) {
    registry().transfers?.forEach(entry => clearTimeout(entry.timer));
    registry().transfers?.clear();
  }
  changed();
}

export const floatHost = (): FloatHost | null => registry().host;

export function publishMainBody(anchor: MainAnchor): () => void {
  const state = registry();
  const main = state.main ??= new Map();
  const focused = () => { anchor.focusOrder = state.focusOrder = (state.focusOrder ?? 0) + 1; };
  anchor.element.addEventListener("focusin", focused);
  main.set(anchor.id, anchor);
  changed();
  return () => {
    anchor.element.dispatchEvent(new Event(MAIN_REMOVING_EVENT));
    anchor.element.removeEventListener("focusin", focused);
    if (main.get(anchor.id) !== anchor) return;
    queueMicrotask(() => {
      if (main.get(anchor.id) !== anchor) return;
      main.delete(anchor.id);
      changed();
    });
  };
}

export const mainBodies = (): MainAnchor[] => [...(registry().main?.values() ?? [])];

/** Keeps a main owner alive while its opener changes route before the body mounts. */
export function requestFloatTransfer(target: FloatTarget): void {
  if (registry().anchors.has(floatWindowKey(target))) return;
  const transfers = registry().transfers ??= new Map();
  const key = floatWindowKey(target);
  const current = transfers.get(key);
  if (current) clearTimeout(current.timer);
  const entry = { target, timer: setTimeout(() => {
    if (transfers.get(key) !== entry) return;
    transfers.delete(key);
    changed();
  }, 30_000) };
  transfers.set(key, entry);
  changed();
}

export const floatTransfers = (): FloatTarget[] => [...(registry().transfers?.values() ?? [])].map(entry => entry.target);

/** The attribute on a floating tab's body naming its window key. */
export const FLOAT_WINDOW_ATTRIBUTE = "data-float-window";

/**
 * Called while handling a click: when the click came from inside a floating
 * tab and the tab can show `target` (a thread, or a path a panel shows), that
 * tab goes there. True if it did.
 */
export function navigateFromFloat(target: FloatTarget): boolean {
  const host = registry().host;
  const origin = (globalThis as { event?: Event }).event?.target;
  const tab = origin instanceof Element ? origin.closest(`[${FLOAT_WINDOW_ATTRIBUTE}]`) : null;
  if (!host?.navigate || !tab) return false;
  if (target.kind === "path" && !floatPanelFor(target.path.split(/[?#]/)[0]!)) return false;
  host.navigate(tab.getAttribute(FLOAT_WINDOW_ATTRIBUTE)!, target);
  return true;
}

function publish(map: Map<string, FloatAnchor>, anchor: FloatAnchor | { windowKey: string; element: null }): void {
  const current = map.get(anchor.windowKey);
  if ((current?.element ?? null) === anchor.element && (!anchor.element || current?.placement === anchor.placement)) return;
  if (anchor.element) map.set(anchor.windowKey, anchor as FloatAnchor);
  else map.delete(anchor.windowKey);
  changed();
}

export function publishFloatBody(anchor: FloatAnchor | { windowKey: string; element: null }): void {
  const key = anchor.element ? floatWindowKey(anchor.target) : anchor.windowKey;
  const transfer = registry().transfers?.get(key);
  if (transfer) {
    clearTimeout(transfer.timer);
    registry().transfers!.delete(key);
  }
  publish(registry().anchors, anchor);
}
export const publishFloatLeading = (anchor: FloatAnchor | { windowKey: string; element: null }) => publish(registry().leading, anchor);

export function publishFloatDock(element: HTMLElement | null): void {
  if (registry().dock === element) return;
  registry().dock = element;
  changed();
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The panel that shows `path`, preferring the longest matching prefix. */
export function floatPanelFor(path: string): (FloatPanelInfo & { subPath: string }) | null {
  let best: (FloatPanelInfo & { subPath: string }) | null = null;
  for (const panel of registry().panels.values()) {
    const root = `/plugins/${panel.pluginId}/${panel.path}`;
    if (path !== root && !path.startsWith(`${root}/`)) continue;
    if (best && best.path.length >= panel.path.length) continue;
    best = { ...panel, subPath: safeDecode(path.slice(root.length + 1).replace(/\/$/, "")) };
  }
  return best;
}

// Content side ----------------------------------------------------------------

export function registerFloatPanel(info: FloatPanelInfo): () => void {
  const key = `${info.pluginId}/${info.path}`;
  const entry = { ...info };
  registry().panels.set(key, entry);
  changed();
  return () => {
    if (registry().panels.get(key) !== entry) return;
    registry().panels.delete(key);
    changed();
  };
}

export const floatBodies = (): FloatAnchor[] => [...registry().anchors.values()];
export const floatLeading = (): FloatAnchor[] => [...registry().leading.values()];
export const floatDock = (): HTMLElement | null => registry().dock;
