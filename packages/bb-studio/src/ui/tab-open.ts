// Opens anything the tab kinds registry knows (src/tab-kinds.ts) as a tab in
// a workbench: the one path a New Tab row, a drop on the workbench and a
// picker take. Where the running BB has the fork's workbench API
// (`useBbNavigate().experimental_workbench`), it opens there, in a pane and
// at a place in its tab strip when given one; elsewhere the thread (or the
// Studio page) is asked to open it in its own side panel, as before.
// Another plugin's tab (a Visual Chat board, a workflow run) opens through
// the workbench API's `tab.pluginId`, which bb allows for tabs registered with
// `experimental_openableByPlugins`. On a BB from before that, Studio asks
// Visual Chat over a window event (PLUGIN_TAB_EVENT), which Visual Chat's own
// overlay answers (packages/bb-studio-visual-chat/src/board-tab.tsx).
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { workbenchOf } from "../kit/app/host-sdk";
import { requestThreadTab } from "../kit/app/thread-panel";
import { STUDIO_PLUGIN, tabOpenFor, type StudioTabOpen, type TabRef } from "../tab-kinds";
import { noteOpenedTab } from "./opened-tabs";
import { requestPageTab } from "./page-tab-requests";

/** Where a workbench drop or the agent asks a tab to go: a pane (the second is made by "new") and a place in its strip. */
export type PanePlace = 1 | 2 | "new";

export interface OpenPlace {
  /** The conversation whose workbench takes it; null for the Studio page's own side panel. */
  threadId: string | null;
  pane?: PanePlace;
  index?: number;
  /** False opens it behind the selected tab. Default true. */
  focus?: boolean;
}

/** The window event Studio asks another of BB Studio's plugins to open one of its own tabs with. */
export const PLUGIN_TAB_EVENT = "bb-studio:open-plugin-tab";
const PLUGIN_TAB_TIMEOUT_MS = 3_500;

export interface PluginTabRequest {
  pluginId: string;
  tabId: string;
  params: JsonValue | null;
  title: string;
  threadId: string | null;
  options: { focus: boolean; pane?: PanePlace; index?: number };
  /** Set by the plugin that takes the request, at once. */
  taken: boolean;
  /** The opened tab's key, or null when it didn't open. */
  reply(key: string | null): void;
}

let navigator: object | null = null;

/** BB's navigation for opens from outside React (a drop, a New Tab row); set by an always-mounted bridge. */
export function setTabNavigator(next: object | null): () => void {
  navigator = next;
  return () => { if (navigator === next) navigator = null; };
}

/** Asks the plugin that owns `open` to open it. Null when no plugin took it or it didn't open. */
export function requestPluginTab(open: StudioTabOpen, place: OpenPlace, target: EventTarget | null = typeof window === "undefined" ? null : window): Promise<string | null> {
  if (!target) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (key: string | null) => { if (!done) { done = true; clearTimeout(timer); resolve(key); } };
    const timer = setTimeout(() => finish(null), PLUGIN_TAB_TIMEOUT_MS);
    const detail: PluginTabRequest = {
      pluginId: open.pluginId, tabId: open.tabId, params: open.params, title: open.title, threadId: place.threadId,
      options: { focus: place.focus !== false, ...(place.pane !== undefined ? { pane: place.pane } : {}), ...(place.index !== undefined ? { index: place.index } : {}) },
      taken: false, reply: finish,
    };
    target.dispatchEvent(new CustomEvent(PLUGIN_TAB_EVENT, { detail }));
    if (!detail.taken) finish(null);
  });
}

export interface OpenDeps {
  /** The conversation's workbench API, or null where BB has none or the thread isn't on screen. */
  workbench(threadId: string): { open(spec: unknown, options: object): Promise<string | null> } | null;
  /** The workbench of the Studio page on screen, where BB has one for a plugin's page. */
  pageWorkbench?(): { open(spec: unknown, options: object): Promise<string | null> } | null;
  requestThreadTab: typeof requestThreadTab;
  requestPageTab: typeof requestPageTab;
  requestPluginTab: typeof requestPluginTab;
  noteOpened(ref: TabRef): void;
}

const PAGE_PANEL = /^\/plugins\/studio\/(studio|automations)(?:\/|$)/;

/** BB's key for the workbench of the Studio page at `pathname` (the fork's `experimental_workbench("page:<plugin>/<panel>")`); null elsewhere. */
export function pageWorkbenchKey(pathname: string = typeof window === "undefined" ? "" : window.location.pathname): string | null {
  const panel = PAGE_PANEL.exec(pathname)?.[1];
  return panel ? `page:${STUDIO_PLUGIN}/${panel}` : null;
}

export function pageWorkbenchOf(navigate: object, pathname?: string) {
  const key = pageWorkbenchKey(pathname);
  return key ? workbenchOf(navigate, key) : null;
}

const defaultDeps = (): OpenDeps => ({
  workbench: (threadId) => (navigator ? workbenchOf(navigator, threadId) : null),
  pageWorkbench: () => (navigator ? pageWorkbenchOf(navigator) : null),
  requestThreadTab, requestPageTab, requestPluginTab, noteOpened: (ref) => noteOpenedTab(ref),
});

/**
 * Opens `ref` as a tab where `place` says. True when it opened. False for
 * bb's own kinds (the agent opens those through the workbench API's own
 * specs), a ref that names nothing, and a workbench that declined.
 */
export async function openTabRef(ref: TabRef, title: string | null | undefined, place: OpenPlace, deps: OpenDeps = defaultDeps()): Promise<boolean> {
  const open = tabOpenFor(ref, title);
  if (!open) return false;
  const opened = await openStudioTab(open, place, deps);
  if (opened) deps.noteOpened(ref);
  return opened;
}

export async function openStudioTab(open: StudioTabOpen, place: OpenPlace, deps: OpenDeps = defaultDeps()): Promise<boolean> {
  const focus = place.focus !== false;
  const wb = place.threadId ? deps.workbench(place.threadId) : null;
  const where = { ...(place.pane !== undefined ? { pane: place.pane } : {}), ...(place.index !== undefined ? { index: place.index } : {}) };
  if (open.pluginId !== STUDIO_PLUGIN) {
    const spec = { kind: "tab", tab: { id: open.tabId, pluginId: open.pluginId }, ...(open.params !== null ? { params: open.params } : {}), title: open.title };
    return (wb && ((await wb.open(spec, { focus, ...where })) !== null || (Object.keys(where).length > 0 && (await wb.open(spec, { focus })) !== null)))
      || (await deps.requestPluginTab(open, place)) !== null;
  }
  const spec = { kind: "tab", tab: { id: open.tabId }, ...(open.params !== null ? { params: open.params } : {}), title: open.title };
  // BB declines a place it can't make (pane 2 of one, a narrow window's drawer): then it opens where tabs open.
  if (wb) return (await wb.open(spec, { focus, ...where })) !== null || (Object.keys(where).length > 0 && (await wb.open(spec, { focus })) !== null);
  if (place.threadId) return deps.requestThreadTab(place.threadId, { actionId: open.tabId, title: open.title, ...(open.params !== null ? { params: open.params } : {}) });
  // A place beside a Studio page (the second pane) needs the page's own workbench; without one, or when it declines, the tab opens where the page opens tabs.
  if (Object.keys(where).length > 0 && (await deps.pageWorkbench?.()?.open(spec, { focus, ...where }).catch(() => null)) != null) return true;
  return deps.requestPageTab({ tabId: open.tabId, params: open.params, title: open.title });
}
