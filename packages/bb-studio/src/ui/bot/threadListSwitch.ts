// Which list BB's sidebar shows. On the Bot page it's the Bots list (Studio's
// thread list provider, BotThreadList); everywhere else BB's own thread list.
// BB keeps one global preference, `sidebar.threadListProvider`, so this window
// sets it when it shows the Bot page and puts the user's choice back when it
// leaves. "__automatic__" would pick the Bots list everywhere (it picks the
// first non-bundled list), so outside the Bot page it becomes BB's list.
//
// Windows: the preference is global, so the focused window decides. A window
// re-checks when its route changes and when it gains focus; with the Bot page
// in one window and a thread in another, the sidebar follows the last one used.
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

/** This plugin's list: `<plugin id>/<list id>`. */
export const BOT_LIST_ID = "bot";
export const BOT_LIST_PROVIDER = `studio/${BOT_LIST_ID}`;
/** BB's bundled thread list. */
export const NATIVE_LIST_PROVIDER = "thread-list/thread-list";
export const AUTOMATIC_PROVIDER = "__automatic__";
const KEY = "sidebar.threadListProvider";
const SAVED_KEY = "studio.bot.previousThreadList";

/** True on the Bot page (/plugins/studio/bot and anything under it). */
export const isBotPath = (pathname: string) => /^\/plugins\/studio\/bot(\/|$)/.test(pathname);

export interface ListSwitch {
  /** The value to write, if any. */
  set?: string;
  /** The previous choice to remember (string), forget (null), or leave (undefined). */
  save?: string | null;
}

/**
 * What to do for the current preference, the route, and the remembered
 * previous choice. Pure, so the rules are tested directly.
 */
export function listSwitch(current: string, onBotPage: boolean, saved: string | null): ListSwitch {
  if (onBotPage) return current === BOT_LIST_PROVIDER ? {} : { set: BOT_LIST_PROVIDER, save: current };
  if (current === BOT_LIST_PROVIDER) {
    const back = saved && saved !== AUTOMATIC_PROVIDER && saved !== BOT_LIST_PROVIDER ? saved : NATIVE_LIST_PROVIDER;
    return { set: back, save: null };
  }
  // Automatic would choose the Bots list once Studio registers it.
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
let again: boolean | null = null;

/**
 * Brings the preference in line with this window's route. Serialized: a call
 * while one runs is folded into one more pass with the latest route.
 */
export function syncThreadList(sdk: PluginBrowserBbSdk, onBotPage: boolean): Promise<void> {
  if (running) { again = onBotPage; return running; }
  running = (async () => {
    let want: boolean | null = onBotPage;
    while (want !== null) {
      again = null;
      try { await apply(sdk, want); } catch { /* next route change or focus tries again */ }
      want = again;
    }
  })().finally(() => { running = null; });
  return running;
}

async function apply(sdk: PluginBrowserBbSdk, onBotPage: boolean) {
  // Another window can write between our read and write; a stale revision fails, so read again once.
  for (let attempt = 0; ; attempt++) {
    const { preferences } = await sdk.system.uiPreferences.list();
    const pref = preferences[KEY];
    const step = listSwitch(String(pref.value), onBotPage, readSaved());
    if (step.set === undefined) return;
    try {
      await sdk.system.uiPreferences.set({ key: KEY, value: step.set, expectedRevision: pref.revision });
      if (step.save !== undefined) writeSaved(step.save);
      return;
    } catch (error) {
      if (attempt > 0) throw error;
    }
  }
}
