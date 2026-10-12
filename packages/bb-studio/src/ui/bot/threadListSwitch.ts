// Which list BB's sidebar shows, by page. Studio switches the global UI
// preference `sidebar.threadListProvider`: the Studio panel
// (/plugins/studio/studio and below) shows the Studio list (StudioSidebar,
// `studio/studio-items`), the Bot page (/plugins/studio/bot) the Bots list
// (BotSidebar, `studio/bot`), and every other page BB's list, or the list the
// user picked before Studio switched. "__automatic__" would pick a Studio list
// everywhere (it picks the first non-bundled one), so off Studio's pages it
// becomes BB's bundled list.
//
// Windows: the preference is global, so the focused window decides. A window
// re-checks when its route changes and when it gains focus; with the Bot page
// in one window and a thread in another, the sidebar follows the last one used.
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

/** True on the Bot page (/plugins/studio/bot and anything under it). */
export const isBotPath = (pathname: string) => /^\/plugins\/studio\/bot(\/|$)/.test(pathname);
/** True on the Studio panel (/plugins/studio/studio and anything under it). */
export const isStudioPath = (pathname: string) => /^\/plugins\/studio\/studio(\/|$)/.test(pathname);

/** The Studio list a page shows, or null for BB's (or the user's) list. */
export function providerForPath(pathname: string): string | null {
  if (isBotPath(pathname)) return BOT_LIST_PROVIDER;
  if (isStudioPath(pathname)) return STUDIO_LIST_PROVIDER;
  return null;
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
let again: { path: string } | null = null;

/**
 * Brings the preference in line with this route. Serialized: a call while one
 * runs is folded into one more pass with the latest route.
 */
export function syncThreadList(sdk: PluginBrowserBbSdk, pathname: string): Promise<void> {
  if (running) { again = { path: pathname }; return running; }
  const next = (async () => {
    let path: string | undefined = pathname;
    while (path !== undefined) {
      again = null;
      try { await apply(sdk, providerForPath(path)); } catch { /* next route change or focus tries again */ }
      path = (again as { path: string } | null)?.path;
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
