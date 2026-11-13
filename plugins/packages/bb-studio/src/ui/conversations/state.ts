// The Bot sidebar's window state, outside React because the sidebar, the
// shortcuts and the launcher bridge all read and set it:
// - which Bot the sidebar shows (per window in sessionStorage; a new window
//   starts on the one used last, in localStorage);
// - each Bot's last-open conversation or worker (localStorage), where a
//   switch to that Bot lands.
import { useSyncExternalStore } from "react";

const BOT_KEY = "studio.sidebar.bot";
const LAST_KEY = "studio.sidebar.last-conversation";

const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function read(key: string, session = true): string | null {
  try { return (session ? sessionStorage.getItem(key) : null) ?? localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string, session = true): void {
  try { if (session) sessionStorage.setItem(key, value); localStorage.setItem(key, value); } catch { /* private mode */ }
}

let bot: string | null | undefined;
let onFocus: ((botId: string) => void) | null = null;
let landed = false;
let threadOpener: ((threadId: string) => void) | null = null;

/**
 * The main view's first landing in this window: on BB's empty new-thread
 * page at launch, the sidebar opens the Bot's last conversation (Main by
 * default) once. "＋ New conversation" and "Studio: Show the Bot" count as
 * landed, so the new-thread page stays when the user asked for it.
 */
export function hasLanded(): boolean {
  return landed;
}

export function markLanded(): void {
  landed = true;
}

/** BB's new-thread page with nothing chosen: the address the app opens on. */
export function isLaunchPage(pathname: string): boolean {
  return pathname === "/" || pathname === "";
}

interface EntryEvents {
  addEventListener(type: "currententrychange", listener: () => void): void;
  removeEventListener(type: "currententrychange", listener: () => void): void;
}

let arrivedAsking: boolean | null = null;
let lastPathname: string | null = null;

export function asksForNewThread(state: unknown): boolean {
  const usr = typeof state === "object" && state !== null ? (state as { usr?: unknown }).usr : null;
  return typeof usr === "object" && usr !== null && (usr as { focusPrompt?: unknown }).focusPrompt === true;
}

export function watchNewThreadArrivals(): () => void {
  const note = () => {
    const pathname = window.location.pathname;
    if (isLaunchPage(pathname) && (lastPathname === null || !isLaunchPage(lastPathname))) arrivedAsking = asksForNewThread(window.history.state);
    lastPathname = pathname;
  };
  note();
  const navigation = (window as { navigation?: EntryEvents }).navigation;
  navigation?.addEventListener("currententrychange", note);
  window.addEventListener("popstate", note);
  return () => {
    navigation?.removeEventListener("currententrychange", note);
    window.removeEventListener("popstate", note);
  };
}

export function newThreadAsked(): boolean {
  return arrivedAsking ?? asksForNewThread(window.history.state);
}

/** How "Studio: Show the Bot" opens a thread: the sidebar's BB navigation while it is mounted. */
export function setThreadOpener(open: ((threadId: string) => void) | null): void {
  threadOpener = open;
}

export function openThreadVia(fallback: (threadId: string) => void): (threadId: string) => void {
  return (threadId) => (threadOpener ?? fallback)(threadId);
}

/** "Studio: Show Bot <n>" (app.tsx): the sidebar's switch while it is mounted, with how many Bots it shows. */
let switcher: { count: number; show(index: number): void } | null = null;

export function setBotSwitcher(next: { count: number; show(index: number): void } | null): void {
  switcher = next;
}

/** Whether "Show Bot <n>" can run: the sidebar is mounted and has an nth Bot (from 1). */
export function canShowBot(index: number): boolean {
  return !!switcher && index >= 1 && index <= switcher.count;
}

export function showBotNumber(index: number): boolean {
  if (!switcher || !canShowBot(index)) return false;
  switcher.show(index);
  return true;
}

/** The Bot the sidebar shows in this window; null until one is chosen (the sidebar then shows the current Bot the server knows). */
export function currentBot(): string | null {
  if (bot === undefined) bot = read(BOT_KEY);
  return bot;
}

/** Shows another Bot. The server learns it too (bot_focus), so the user's next thread is that Bot's conversation. */
export function setCurrentBot(next: string): void {
  if (currentBot() === next) { onFocus?.(next); return; }
  bot = next;
  write(BOT_KEY, next);
  onFocus?.(next);
  emit();
}

/** Who tells the server: the sidebar, while it is mounted. */
export function setFocusHandler(handler: ((botId: string) => void) | null): void {
  onFocus = handler;
}

export function useCurrentBot(): string | null {
  return useSyncExternalStore(subscribe, currentBot, () => null);
}

function lastMap(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
  } catch { return {}; }
}

/** The conversation or worker last open for a Bot. */
export function lastConversation(botId: string): string | null {
  return lastMap()[botId] ?? null;
}

export type Land = (input: { botId: string; last: string | null }) => Promise<{ threadId: string | null }>;

export async function landingFor(botId: string, land: Land): Promise<string | null> {
  return (await land({ botId, last: lastConversation(botId) }).catch(() => null))?.threadId ?? null;
}

export function rememberConversation(botId: string, threadId: string): void {
  const map = lastMap();
  if (map[botId] === threadId) return;
  map[botId] = threadId;
  try { localStorage.setItem(LAST_KEY, JSON.stringify(map)); } catch { /* private mode */ }
}

/**
 * Opens BB's sidebar if it is folded. BB's plugin API has no call for it, so
 * this presses BB's own sidebar button (`data-sidebar="trigger"`) when that
 * says the sidebar is shut. Answers whether it pressed.
 */
export function expandHostSidebar(root: ParentNode = document): boolean {
  const trigger = root.querySelector<HTMLElement>('[data-sidebar="trigger"][aria-expanded="false"]');
  if (!trigger) return false;
  trigger.click();
  return true;
}

/** For tests. */
export function resetSidebarState(): void {
  bot = undefined;
  onFocus = null;
  landed = false;
  arrivedAsking = null;
  lastPathname = null;
  threadOpener = null;
  switcher = null;
  try { for (const key of [BOT_KEY, LAST_KEY]) { sessionStorage.removeItem(key); localStorage.removeItem(key); } } catch { /* private mode */ }
  emit();
}
