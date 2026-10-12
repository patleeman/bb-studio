// Which list BB's sidebar shows, by page. Studio switches the global UI
// preference `sidebar.threadListProvider`: the Studio panel
// (/plugins/studio/studio and below) shows the Studio list (StudioSidebar,
// `studio/studio-items`), the Bot page (/plugins/studio/bot) and a Bot-owned
// thread (/threads/<id>: a Bot's chat or handoff chain, a runner, a thread it
// spawned, an automation's run) the Bots list (BotSidebar, `studio/bot`), and
// every other page BB's list, or the list the user picked before Studio
// switched. Bot-owned threads are hidden from BB's list, so one opened from
// the Bots list keeps it.
//
// Ownership: a thread opened from the Bot's lists (useOpenThread) is known at
// once; any other comes from `bot_thread_owner`, cached here. Until the answer
// comes the sidebar stays as it is, so it doesn't flicker to BB's list. "__automatic__" would pick a Studio list
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

/** The Studio list a page shows, or null for BB's (or the user's) list. */
export function providerForPath(pathname: string): string | null {
  if (isBotPath(pathname)) return BOT_LIST_PROVIDER;
  if (isStudioPath(pathname)) return STUDIO_LIST_PROVIDER;
  return null;
}

/** The thread a BB thread page shows (/threads/<id>), or null. */
export function threadIdForPath(pathname: string): string | null {
  const match = /^\/threads\/([^/?#]+)\/?$/.exec(pathname);
  if (!match) return null;
  try { return decodeURIComponent(match[1]!); } catch { return match[1]!; }
}

// --- Bot-owned threads -----------------------------------------------------

/** A "not the Bot's" answer is rechecked after this: an automation's run is linked to its thread a little after BB makes it. */
export const NOT_OWNED_TTL_MS = 30_000;
const ownership = new Map<string, { owned: boolean; at: number }>();
const asking = new Map<string, Promise<boolean>>();

/** Records that a thread is a Bot's (the Bots list, Activity and Needs you open only those). */
export function markBotOwned(threadId: string): void {
  ownership.set(threadId, { owned: true, at: Date.now() });
}

/** What's known about a thread: true or false, or undefined while unknown (or a stale "no"). */
export function knownBotOwned(threadId: string, now = Date.now()): boolean | undefined {
  const known = ownership.get(threadId);
  if (!known) return undefined;
  return known.owned || now - known.at < NOT_OWNED_TTL_MS ? known.owned : undefined;
}

/** Whether a Bot owns the thread: from the cache, or asked once (concurrent asks share it). A failed ask is "no", not cached. */
export function botOwnsThread(threadId: string, call: Call): Promise<boolean> {
  const known = knownBotOwned(threadId);
  if (known !== undefined) return Promise.resolve(known);
  let pending = asking.get(threadId);
  if (!pending) {
    pending = call("bot_thread_owner", { threadId })
      .then((result) => {
        const owned = !!(result as { botId?: string | null } | null)?.botId;
        // A thread opened from the Bots list while this was asked stays the Bot's.
        if (!ownership.get(threadId)?.owned) ownership.set(threadId, { owned, at: Date.now() });
        return knownBotOwned(threadId) ?? owned;
      }, () => false)
      .finally(() => asking.delete(threadId));
    asking.set(threadId, pending);
  }
  return pending;
}

/** Forgets what's known (tests). */
export function forgetBotOwnership(): void {
  ownership.clear();
  asking.clear();
}

/** The list a page wants: providerForPath, or the Bots list on a Bot-owned thread. */
export async function wantedProvider(pathname: string, call?: Call): Promise<string | null> {
  const page = providerForPath(pathname);
  if (page) return page;
  const threadId = threadIdForPath(pathname);
  if (!threadId) return null;
  const owned = call ? await botOwnsThread(threadId, call) : knownBotOwned(threadId) === true;
  return owned ? BOT_LIST_PROVIDER : null;
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
 * Brings the preference in line with this route. Serialized: a call while one
 * runs is folded into one more pass with the latest route. `call` asks the
 * server whether a thread is a Bot's; without it only threads already known
 * to be one keep the Bots list.
 */
export function syncThreadList(sdk: PluginBrowserBbSdk, pathname: string, call?: Call): Promise<void> {
  if (running) { again = { path: pathname, call }; return running; }
  const next = (async () => {
    let next: { path: string; call?: Call } | null = { path: pathname, call };
    while (next) {
      again = null;
      try {
        // Ownership first: while it loads the sidebar stays as it is.
        await apply(sdk, await wantedProvider(next.path, next.call));
      } catch { /* next route change or focus tries again */ }
      next = again as { path: string; call?: Call } | null;
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
