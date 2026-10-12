// What BB's sidebar shows on the Bot page. Two global UI preferences switch:
// `sidebar.threadListProvider` (the Bots list, BotThreadList, instead of BB's
// thread list) and `sidebar.visiblePluginPanels` (the navigation rows: BB's
// "New thread" row, `__bb__/new-thread`, is hidden there; + next to Bots makes
// a new bot). This window sets each when it shows the Bot page and puts the
// user's choice back when it leaves. "__automatic__" would pick Studio's list
// everywhere (it picks the first non-bundled one), so outside the Bot page it
// becomes BB's bundled list.
//
// Windows: the preferences are global, so the focused window decides. A window
// re-checks when its route changes and when it gains focus; with the Bot page
// in one window and a thread in another, the sidebar follows the last one used.
//
// A BB without a preference (an older or newer build) has nothing to switch:
// the step is skipped and the sidebar keeps BB's own.
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

/** The provider preference Studio switches on the Bot page. */
export interface SidebarSwitch {
  kind?: "provider";
  key: "sidebar.threadListProvider";
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
export const AUTOMATIC_PROVIDER = "__automatic__";

export const THREAD_LIST_SWITCH: SidebarSwitch = { key: "sidebar.threadListProvider", studio: BOT_LIST_PROVIDER, native: NATIVE_LIST_PROVIDER, savedKey: "studio.bot.previousThreadList" };
/** BB's built-in "New thread" navigation item. */
export const NEW_THREAD_ITEM = "__bb__/new-thread";

/** A list preference Studio edits on the Bot page: hides one item, then puts it back. */
export interface HideItemSwitch {
  kind: "hide";
  key: "sidebar.visiblePluginPanels";
  item: string;
  /** Where this window remembers that Studio hid the item, and its index. */
  savedKey: string;
}
export const NEW_THREAD_SWITCH: HideItemSwitch = { kind: "hide", key: "sidebar.visiblePluginPanels", item: NEW_THREAD_ITEM, savedKey: "studio.bot.hiddenNewThreadIndex" };

export type AnySwitch = SidebarSwitch | HideItemSwitch;

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

export interface ItemSwitch {
  /** The list to write, if any. */
  set?: string[];
  /** The index to remember (Studio hid the item), forget (null), or leave (undefined). */
  save?: number | null;
}

/**
 * Hide `item` on the Bot page, put it back elsewhere. `current` null (BB's
 * default set, which Studio can't read) or not a list: do nothing. `saved` is
 * the index Studio removed it from, or null when Studio didn't hide it; an item
 * the user hid stays hidden.
 */
export function hideItemSwitch(item: string, current: unknown, onBotPage: boolean, saved: number | null): ItemSwitch {
  if (!Array.isArray(current)) return {};
  const list = current.map(String);
  const at = list.indexOf(item);
  if (onBotPage) return at < 0 ? {} : { set: list.filter((each) => each !== item), save: at };
  if (saved === null) return {};
  if (at >= 0) return { save: null };
  const index = Math.max(0, Math.min(saved, list.length));
  return { set: [...list.slice(0, index), item, ...list.slice(index)], save: null };
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
export function syncSidebar(sdk: PluginBrowserBbSdk, spec: AnySwitch, onBotPage: boolean): Promise<void> {
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

/** Both switches: the Bots list and no "New thread" on the Bot page, BB's elsewhere. */
export function syncThreadList(sdk: PluginBrowserBbSdk, onBotPage: boolean): Promise<void> {
  return Promise.all([syncSidebar(sdk, THREAD_LIST_SWITCH, onBotPage), syncSidebar(sdk, NEW_THREAD_SWITCH, onBotPage)]).then(() => {});
}

function readIndex(key: string): number | null {
  const raw = readSaved(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

async function apply(sdk: PluginBrowserBbSdk, spec: AnySwitch, onBotPage: boolean) {
  // Another window can write between our read and write; a stale revision fails, so read again once.
  for (let attempt = 0; ; attempt++) {
    const { preferences } = await sdk.system.uiPreferences.list();
    const pref = (preferences as Record<string, { value: unknown; revision: number } | undefined>)[spec.key];
    if (!pref) return;
    const step = spec.kind === "hide"
      ? hideItemSwitch(spec.item, pref.value, onBotPage, readIndex(spec.savedKey))
      : sidebarSwitch(spec, String(pref.value), onBotPage, readSaved(spec.savedKey));
    const save = step.save === undefined || step.save === null ? step.save : String(step.save);
    if (step.set === undefined) { if (save !== undefined) writeSaved(spec.savedKey, save); return; }
    try {
      await sdk.system.uiPreferences.set({ key: spec.key, value: step.set, expectedRevision: pref.revision } as never);
      if (save !== undefined) writeSaved(spec.savedKey, save);
      return;
    } catch (error) {
      if (attempt > 0) throw error;
    }
  }
}
