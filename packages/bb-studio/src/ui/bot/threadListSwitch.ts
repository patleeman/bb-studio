// Which list BB's sidebar shows. Studio switches the global UI preference
// `sidebar.threadListProvider` between its Bots list (BotSidebar, `studio/bot`),
// its Studio list (StudioSidebar, `studio/studio-items`, on the Studio panel
// /plugins/studio/studio), and BB's list or the list the user picked before
// Studio switched.
//
// Each window keeps a sticky mode in sessionStorage (it survives a reload):
// "bots" once the user goes to the Bot page or opens anything from the Bots
// list (useOpenThread), kept on every thread route after that (a runner, a
// worker, a thread in another project, an archived one) until the user goes
// to another rail destination (any route that is neither a thread nor the Bot
// page: another plugin, settings, extensions), or clicks Home on the rail
// (BB counts thread pages as Home, so that click is watched itself). Opening a thread from
// BB's list in "native" mode keeps "native". The decision is nextListMode, a
// pure function of (previous mode, route, how it was reached). Only a window
// with no mode yet, opened straight on a thread, asks `bot_thread_owner`,
// once, and keeps the answer; until it comes the sidebar stays as it is.
// "__automatic__" would pick a Studio list everywhere (it picks the first
// non-bundled one), so off Studio's lists it becomes BB's bundled list.
//
// Windows: the preference is global, so the focused window decides. A window
// re-applies its mode when its route changes and when it gains focus.
//
// A BB without the preference (an older or newer build) has nothing to switch:
// the sidebar keeps BB's own. BB's "New thread" row can't be hidden (BB always
// shows it), so Studio doesn't touch `sidebar.visiblePluginPanels`.
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

/** The plugin RPC client, untyped (live.ts useCall). */
type Call = (method: string, input?: unknown) => Promise<unknown>;

export const PREFERENCE_KEY = "sidebar.threadListProvider";
/** Where this window remembers the user's own choice while a Studio list shows. */
export const SAVED_KEY = "studio.bot.previousThreadList";

/** Studio's lists: `<plugin id>/<list id>`. */
export const BOT_LIST_ID = "bot";
export const BOT_LIST_PROVIDER = `studio/${BOT_LIST_ID}`;
export const STUDIO_LIST_ID = "studio-items";
export const STUDIO_LIST_PROVIDER = `studio/${STUDIO_LIST_ID}`;
const STUDIO_LISTS = new Set([BOT_LIST_PROVIDER, STUDIO_LIST_PROVIDER]);
/** BB's bundled thread list. */
export const NATIVE_LIST_PROVIDER = "thread-list/thread-list";
export const AUTOMATIC_PROVIDER = "__automatic__";

/** True on the Bot page (/plugins/studio/bot and anything under it). */
export const isBotPath = (pathname: string) => /^\/plugins\/studio\/bot(\/|$)/.test(pathname);
/** True on the Studio panel (/plugins/studio/studio and anything under it). */
export const isStudioPath = (pathname: string) => /^\/plugins\/studio\/studio(\/|$)/.test(pathname);

/**
 * The thread a BB thread page shows, or null. BB routes a Personal thread at
 * /threads/<id> and any other at /projects/<project>/threads/<id>
 * (getThreadRoutePath), and matches anything under either (useRouteState).
 */
export function threadIdForPath(pathname: string): string | null {
  const match = /^\/(?:projects\/[^/?#]+\/)?threads\/([^/?#]+)(?:\/|$)/.exec(pathname);
  if (!match) return null;
  try { return decodeURIComponent(match[1]!); } catch { return match[1]!; }
}

// --- This window's mode ------------------------------------------------------

/** The list a window wants: Studio's Bots list, Studio's items list, or BB's (or the user's own). */
export type ListMode = "bots" | "studio" | "native";
/**
 * How the route was reached: from a Bots list entry; Home on BB's rail (BB
 * counts thread pages as Home, so Home on a thread doesn't navigate, and from
 * elsewhere it returns to the last Home route, often a thread); or any other
 * way (another rail item, BB's list, a link, a reload, focus).
 */
export type ListNavigation = "bots-list" | "home" | "route";
/** Where this window keeps its mode, over a reload. */
export const MODE_KEY = "studio.sidebar.listMode";

/**
 * The mode after reaching `pathname`, or "detect" when only the thread's
 * owner can say (a window with no mode yet, opened on a thread). Pure.
 *
 * - Home on the rail: "native", wherever it lands.
 * - Opening anything from the Bots list, or the Bot page: "bots".
 * - The Studio panel: "studio".
 * - A thread route (any project, archived, sub-paths) keeps "bots" or
 *   "native"; Studio's list never shows on a thread, so "studio" becomes
 *   "native".
 * - Any other route is a different rail destination: "native".
 */
export function nextListMode(previous: ListMode | null, pathname: string, via: ListNavigation): ListMode | "detect" {
  if (via === "home") return "native";
  if (via === "bots-list" || isBotPath(pathname)) return "bots";
  if (isStudioPath(pathname)) return "studio";
  if (threadIdForPath(pathname) !== null) {
    if (previous === null) return "detect";
    return previous === "studio" ? "native" : previous;
  }
  return "native";
}

/** The list a mode shows: a Studio list, or null for BB's (or the user's). */
export function providerForMode(mode: ListMode): string | null {
  return mode === "bots" ? BOT_LIST_PROVIDER : mode === "studio" ? STUDIO_LIST_PROVIDER : null;
}

const MODES = new Set<string>(["bots", "studio", "native"]);
const listeners = new Set<() => void>();

/** This window's mode, or null before it has one. */
export function readListMode(): ListMode | null {
  try {
    const value = sessionStorage.getItem(MODE_KEY);
    return value && MODES.has(value) ? (value as ListMode) : null;
  } catch { return null; }
}

function writeListMode(mode: ListMode): void {
  if (readListMode() === mode) return;
  try { sessionStorage.setItem(MODE_KEY, mode); } catch { /* private mode */ }
  for (const listener of [...listeners]) listener();
}

/** Calls `listener` when this window's mode changes (useSyncExternalStore). */
export function subscribeListMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Records that the user opened something from the Bots list (or the Bot page's lists): this window shows the Bots list until they leave. */
export function openedFromBotsList(): void {
  writeListMode(nextListMode(readListMode(), "", "bots-list") as ListMode);
}

/** BB's rail Home button (AppNavRail). */
export const HOME_RAIL_SELECTOR = 'nav[aria-label="Primary navigation"] button[aria-label="Home"]';

/** Records that the user clicked Home on BB's rail: this window leaves the Bots list. */
export function clickedHome(pathname: string): void {
  writeListMode(nextListMode(readListMode(), pathname, "home") as ListMode);
}

/** Forgets this window's mode (tests: a fresh window). */
export function forgetListMode(): void {
  try { sessionStorage.removeItem(MODE_KEY); } catch { /* private mode */ }
  for (const listener of [...listeners]) listener();
}

export interface ListSwitch {
  /** The value to write, if any. */
  set?: string;
  /** The previous choice to remember (string), forget (null), or leave (undefined). */
  save?: string | null;
}

/**
 * What to write for the current value, the list this page wants (null: not a
 * Studio list), and the remembered previous choice. Pure, so the rules are
 * tested directly.
 */
export function listSwitch(current: string, want: string | null, saved: string | null): ListSwitch {
  if (want) {
    if (current === want) return {};
    // From one Studio list to the other, keep the user's choice remembered.
    return STUDIO_LISTS.has(current) ? { set: want } : { set: want, save: current };
  }
  if (STUDIO_LISTS.has(current)) {
    const back = saved && saved !== AUTOMATIC_PROVIDER && !STUDIO_LISTS.has(saved) ? saved : NATIVE_LIST_PROVIDER;
    return { set: back, save: null };
  }
  // Automatic would choose a Studio list once Studio registers it.
  if (current === AUTOMATIC_PROVIDER) return { set: NATIVE_LIST_PROVIDER };
  return {};
}

function readSaved(): string | null {
  try { return localStorage.getItem(SAVED_KEY); } catch { return null; }
}
function writeSaved(value: string | null) {
  try {
    if (value === null) localStorage.removeItem(SAVED_KEY);
    else localStorage.setItem(SAVED_KEY, value);
  } catch { /* private mode */ }
}

let running: Promise<void> | null = null;
let again: { path: string; call?: Call } | null = null;

/**
 * Brings this window's mode and the preference in line with this route.
 * Serialized: a call while one runs is folded into one more pass with the
 * latest route. `call` asks the server who owns a thread, used only when
 * this window has no mode yet; without it, or while it's asked, or if it
 * fails, the sidebar stays as it is.
 */
export function syncThreadList(sdk: PluginBrowserBbSdk, pathname: string, call?: Call): Promise<void> {
  if (running) { again = { path: pathname, call }; return running; }
  const next = (async () => {
    let next: { path: string; call?: Call } | null = { path: pathname, call };
    while (next) {
      again = null;
      try {
        const mode = await modeFor(next.path, next.call);
        if (mode) { writeListMode(mode); await apply(sdk, providerForMode(mode)); }
      } catch { /* next route change or focus tries again */ }
      next = again as { path: string; call?: Call } | null;
    }
  })().finally(() => { running = null; });
  running = next;
  return next;
}

/** The mode for a route; null when it can't be known yet. */
async function modeFor(pathname: string, call?: Call): Promise<ListMode | null> {
  const mode = nextListMode(readListMode(), pathname, "route");
  if (mode !== "detect") return mode;
  const threadId = threadIdForPath(pathname)!;
  if (!call) return null;
  let owned: boolean;
  try {
    const result = await call("bot_thread_owner", { threadId }) as { botId?: string | null } | null;
    owned = !!result?.botId;
  } catch { return null; }
  // A Bots list open while this was asked decides instead.
  const now = nextListMode(readListMode(), pathname, "route");
  return now !== "detect" ? now : owned ? "bots" : "native";
}

async function apply(sdk: PluginBrowserBbSdk, want: string | null) {
  // Another window can write between our read and write; a stale revision fails, so read again once.
  for (let attempt = 0; ; attempt++) {
    const { preferences } = await sdk.system.uiPreferences.list();
    const pref = (preferences as Record<string, { value: unknown; revision: number } | undefined>)[PREFERENCE_KEY];
    if (!pref) return;
    const step = listSwitch(String(pref.value), want, readSaved());
    if (step.set === undefined) { if (step.save !== undefined) writeSaved(step.save); return; }
    try {
      await sdk.system.uiPreferences.set({ key: PREFERENCE_KEY, value: step.set, expectedRevision: pref.revision } as never);
      if (step.save !== undefined) writeSaved(step.save);
      return;
    } catch (error) {
      if (attempt > 0) throw error;
    }
  }
}
