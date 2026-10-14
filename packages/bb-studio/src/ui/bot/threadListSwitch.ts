// Which list BB's sidebar shows. Studio switches the global UI preference
// `sidebar.threadListProvider` to its Studio list (StudioSidebar,
// `studio/studio-items`) on the Studio panel /plugins/studio/studio, and to its
// Bots list (BotSidebar, `studio/bot`) everywhere else. The Bots list also
// lists every thread, so it stands in for BB's list. Each window keeps its
// mode in sessionStorage. "__automatic__" would pick a Studio list everywhere
// (it picks the first non-bundled one), so it is replaced too.
//
// The window also remembers the last thread it showed in "bots" mode; the
// rail's Bot item lands there (BotHome's useBotLanding).
//
// Windows: the preference is global, so the focused window decides. A window
// re-applies its mode when its route changes and when it gains focus.
//
// A BB without the preference (an older or newer build) has nothing to switch:
// the sidebar keeps BB's own. BB's "New thread" row can't be hidden (BB always
// shows it), so Studio doesn't touch `sidebar.visiblePluginPanels`.
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

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

/** True on the Bot page (/plugins/studio/studio/bot and anything under it). */
export const isBotPath = (pathname: string) => /^\/plugins\/studio\/studio\/bot(\/|$)/.test(pathname);
/** True on the Studio panel (/plugins/studio/studio and anything under it), except the Bot page, which keeps the Bots list. */
export const isStudioPath = (pathname: string) => /^\/plugins\/studio\/studio(\/|$)/.test(pathname) && !isBotPath(pathname);

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

/** The list a window wants: Studio's Bots list, or Studio's items list on the Studio panel. */
export type ListMode = "bots" | "studio";
/** Where this window keeps its mode, over a reload. */
export const MODE_KEY = "studio.sidebar.listMode";

/** The mode for `pathname`: Studio's items list on the Studio panel, the Bots list everywhere else. Pure. */
export function nextListMode(pathname: string): ListMode {
  return isStudioPath(pathname) ? "studio" : "bots";
}

/** The list a mode shows. */
export function providerForMode(mode: ListMode): string {
  return mode === "bots" ? BOT_LIST_PROVIDER : STUDIO_LIST_PROVIDER;
}

const MODES = new Set<string>(["bots", "studio"]);
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

// --- This window's last Bot thread -------------------------------------------
//
// The Bot rail item lands on the thread the user last had open in "bots" mode
// (the Bot's chat, a runner, a worker, any thread opened from the Bots list),
// kept per window beside the mode. BotHome redirects the bare Bot page there.

/** Where this window keeps the last thread it showed in "bots" mode. */
export const LAST_THREAD_KEY = "studio.sidebar.lastBotThread";

/** The thread to remember after showing `pathname` in `mode`, or null to keep the last one. Pure. */
export function botThreadVisit(mode: ListMode | null, pathname: string): string | null {
  return mode === "bots" ? threadIdForPath(pathname) : null;
}

/** This window's last Bot thread, or null. */
export function readLastBotThread(): string | null {
  try { return sessionStorage.getItem(LAST_THREAD_KEY) || null; } catch { return null; }
}

/** Notes the route just shown in `mode`: a thread in "bots" mode becomes the last Bot thread. */
export function noteBotThread(mode: ListMode | null, pathname: string): void {
  const threadId = botThreadVisit(mode, pathname);
  if (!threadId) return;
  try { sessionStorage.setItem(LAST_THREAD_KEY, threadId); } catch { /* private mode */ }
}

/** Forgets this window's last Bot thread (tests: a fresh window). */
export function forgetLastBotThread(): void {
  try { sessionStorage.removeItem(LAST_THREAD_KEY); } catch { /* private mode */ }
}

/** BB's Personal project: its threads route at /threads/<id>, others at /projects/<id>/threads/<id>. */
export const PERSONAL_PROJECT = "proj_personal";
/** A thread's route, as BB's getThreadRoutePath makes it. */
export const threadRoute = (threadId: string, projectId: string) =>
  projectId === PERSONAL_PROJECT ? `/threads/${encodeURIComponent(threadId)}` : `/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}`;

/**
 * Where the bare Bot page (the rail's Bot item) lands: the window's last Bot
 * thread while it exists, else the Bot's chat, else null (the page shows the
 * Bot's Info, or the create flow with no Bot). `locate` gives a thread's
 * route, or null when it's gone.
 */
export async function botLanding(last: string | null, chatId: string | null, locate: (threadId: string) => Promise<string | null>): Promise<{ threadId: string; path: string } | null> {
  for (const threadId of [...new Set([last, chatId])]) {
    if (!threadId) continue;
    const path = await locate(threadId);
    if (path) return { threadId, path };
  }
  return null;
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
let again: string | null = null;

/**
 * Brings this window's mode and the preference in line with this route.
 * Serialized: a call while one runs is folded into one more pass with the
 * latest route.
 */
export function syncThreadList(sdk: PluginBrowserBbSdk, pathname: string): Promise<void> {
  if (running) { again = pathname; return running; }
  const next = (async () => {
    let path: string | null = pathname;
    while (path !== null) {
      again = null;
      try {
        const mode = nextListMode(path);
        writeListMode(mode);
        noteBotThread(mode, path);
        await apply(sdk, providerForMode(mode));
      } catch { /* next route change or focus tries again */ }
      path = again as string | null;
    }
  })().finally(() => { running = null; });
  running = next;
  return next;
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
