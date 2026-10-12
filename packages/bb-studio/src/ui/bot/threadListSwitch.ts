// What BB's sidebar shows on the Bot page. Two global UI preferences switch:
// `sidebar.threadListProvider` (the Bots list, BotThreadList, instead of BB's
// thread list) and `sidebar.navigationProvider` (Studio's navigation, whose
// top row is "New bot", instead of BB's bundled Navigation and its "New
// thread"). This window sets each when it shows the Bot page and puts the
// user's choice back when it leaves. "__automatic__" would pick Studio's
// provider everywhere (it picks the first non-bundled one), so outside the
// Bot page it becomes BB's bundled provider.
//
// Windows: the preferences are global, so the focused window decides. A window
// re-checks when its route changes and when it gains focus; with the Bot page
// in one window and a thread in another, the sidebar follows the last one used.
//
// A BB without a preference (an older or newer build) has nothing to switch:
// the step is skipped and the sidebar keeps BB's own.
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

/** One preference Studio switches on the Bot page. */
export interface SidebarSwitch {
  key: "sidebar.threadListProvider" | "sidebar.navigationProvider";
  /** Studio's provider: `<plugin id>/<provider id>`. */
  studio: string;
  /** BB's bundled provider, restored when nothing else was chosen. */
  native: string;
  /** Where this window remembers the user's previous choice. */
  savedKey: string;
}

/** This plugin's list: `<plugin id>/<list id>`. */
export const BOT_LIST_ID = "bot";
export const BOT_LIST_PROVIDER = `studio/${BOT_LIST_ID}`;
/** BB's bundled thread list. */
export const NATIVE_LIST_PROVIDER = "thread-list/thread-list";
/** This plugin's sidebar navigation ("New bot" on top). */
export const BOT_NAVIGATION_ID = "bot-navigation";
export const BOT_NAVIGATION_PROVIDER = `studio/${BOT_NAVIGATION_ID}`;
/** BB's bundled Navigation plugin ("New thread" on top). */
export const NATIVE_NAVIGATION_PROVIDER = "navigation/navigation";
export const AUTOMATIC_PROVIDER = "__automatic__";

export const THREAD_LIST_SWITCH: SidebarSwitch = { key: "sidebar.threadListProvider", studio: BOT_LIST_PROVIDER, native: NATIVE_LIST_PROVIDER, savedKey: "studio.bot.previousThreadList" };
export const NAVIGATION_SWITCH: SidebarSwitch = { key: "sidebar.navigationProvider", studio: BOT_NAVIGATION_PROVIDER, native: NATIVE_NAVIGATION_PROVIDER, savedKey: "studio.bot.previousNavigation" };

/** True on the Bot page (/plugins/studio/bot and anything under it). */
export const isBotPath = (pathname: string) => /^\/plugins\/studio\/bot(\/|$)/.test(pathname);

export interface ListSwitch {
  /** The value to write, if any. */
  set?: string;
  /** The previous choice to remember (string), forget (null), or leave (undefined). */
  save?: string | null;
}

/**
 * What to do for one preference's current value, the route, and the
 * remembered previous choice. Pure, so the rules are tested directly.
 */
export function sidebarSwitch(spec: Pick<SidebarSwitch, "studio" | "native">, current: string, onBotPage: boolean, saved: string | null): ListSwitch {
  if (onBotPage) return current === spec.studio ? {} : { set: spec.studio, save: current };
  if (current === spec.studio) {
    const back = saved && saved !== AUTOMATIC_PROVIDER && saved !== spec.studio ? saved : spec.native;
    return { set: back, save: null };
  }
  // Automatic would choose Studio's provider once Studio registers it.
  if (current === AUTOMATIC_PROVIDER) return { set: spec.native };
  return {};
}

/** sidebarSwitch for the thread list. */
export const listSwitch = (current: string, onBotPage: boolean, saved: string | null) => sidebarSwitch(THREAD_LIST_SWITCH, current, onBotPage, saved);

function readSaved(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeSaved(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode */ }
}

const running = new Map<string, Promise<void>>();
const again = new Map<string, boolean>();

/**
 * Brings one preference in line with this window's route. Serialized per
 * preference: a call while one runs is folded into one more pass with the
 * latest route.
 */
export function syncSidebar(sdk: PluginBrowserBbSdk, spec: SidebarSwitch, onBotPage: boolean): Promise<void> {
  const current = running.get(spec.key);
  if (current) { again.set(spec.key, onBotPage); return current; }
  const next = (async () => {
    let want: boolean | undefined = onBotPage;
    while (want !== undefined) {
      again.delete(spec.key);
      try { await apply(sdk, spec, want); } catch { /* next route change or focus tries again */ }
      want = again.get(spec.key);
    }
  })().finally(() => { running.delete(spec.key); });
  running.set(spec.key, next);
  return next;
}

/** Both switches: the Bots list and "New bot" on the Bot page, BB's elsewhere. */
export function syncThreadList(sdk: PluginBrowserBbSdk, onBotPage: boolean): Promise<void> {
  return Promise.all([syncSidebar(sdk, THREAD_LIST_SWITCH, onBotPage), syncSidebar(sdk, NAVIGATION_SWITCH, onBotPage)]).then(() => {});
}

async function apply(sdk: PluginBrowserBbSdk, spec: SidebarSwitch, onBotPage: boolean) {
  // Another window can write between our read and write; a stale revision fails, so read again once.
  for (let attempt = 0; ; attempt++) {
    const { preferences } = await sdk.system.uiPreferences.list();
    const pref = (preferences as Partial<typeof preferences>)[spec.key];
    if (!pref) return;
    const step = sidebarSwitch(spec, String(pref.value), onBotPage, readSaved(spec.savedKey));
    if (step.set === undefined) return;
    try {
      await sdk.system.uiPreferences.set({ key: spec.key, value: step.set, expectedRevision: pref.revision });
      if (step.save !== undefined) writeSaved(spec.savedKey, step.save);
      return;
    } catch (error) {
      if (attempt > 0) throw error;
    }
  }
}
