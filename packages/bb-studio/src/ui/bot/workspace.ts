// The Bot's workspace: its right-panel tabs (Info, and Threads holding any
// number of opened sub-threads), the sub-thread strip's saved state, and how
// its sidebar groups the threads it started. No React components here, so
// app.tsx, the page and the tabs can share it without import cycles.
import { experimental_useAppPanel, type JsonValue } from "@get-bb/plugin-sdk/app";
import { useCallback, useSyncExternalStore } from "react";
import type { BotActivityView, BotScheduledView, BotThreadView } from "../../contract";

/** The Bot's nav panel id (also BOT_PANEL in BotHome). */
const PANEL = "bot";

export type ThreadsTarget = { threadId: string };
const isThreadsTarget = (value: JsonValue): value is ThreadsTarget =>
  !!value && typeof value === "object" && !Array.isArray(value)
  && typeof (value as Record<string, unknown>).threadId === "string"
  && /^[\w-]{1,128}$/.test((value as Record<string, string>).threadId);

/** Info: the Bot's profile, controls, check-ins and activity. */
export const INFO_TAB = { panelId: PANEL, id: "info" } as const;
/** Threads: sub-threads the user opened, one strip of them; a target adds and focuses one. */
export const THREADS_TAB = { panelId: PANEL, id: "threads", experimental_target: { validate: isThreadsTarget } } as const;

// --- The Threads tab's strip of opened sub-threads -------------------------

export interface Strip { open: string[]; active: string | null }
export const EMPTY_STRIP: Strip = { open: [], active: null };
/** At most this many stay open; the oldest unfocused one closes first. */
export const STRIP_LIMIT = 12;

/** Opens a thread (or focuses it when already open). */
export function stripOpen(strip: Strip, threadId: string): Strip {
  if (strip.open.includes(threadId)) return strip.active === threadId ? strip : { ...strip, active: threadId };
  let open = [...strip.open, threadId];
  while (open.length > STRIP_LIMIT) {
    const drop = open.find((id) => id !== threadId && id !== strip.active) ?? open[0]!;
    open = open.filter((id) => id !== drop);
  }
  return { open, active: threadId };
}

/** Closes a thread; focus moves to its right-hand neighbor, else its left. */
export function stripClose(strip: Strip, threadId: string): Strip {
  const index = strip.open.indexOf(threadId);
  if (index < 0) return strip;
  const open = strip.open.filter((id) => id !== threadId);
  const active = strip.active !== threadId ? strip.active : open[index] ?? open[index - 1] ?? null;
  return { open, active };
}

/** Moves a thread to `to` (clamped). */
export function stripMove(strip: Strip, threadId: string, to: number): Strip {
  const from = strip.open.indexOf(threadId);
  if (from < 0) return strip;
  const open = strip.open.filter((id) => id !== threadId);
  open.splice(Math.max(0, Math.min(to, open.length)), 0, threadId);
  return { ...strip, open };
}

export function stripFocus(strip: Strip, threadId: string): Strip {
  return strip.open.includes(threadId) ? { ...strip, active: threadId } : strip;
}

const stripKey = (botId: string) => `studio.bot.${botId}.threads`;

export function readStrip(botId: string): Strip {
  try { return parseStrip(localStorage.getItem(stripKey(botId)) ?? ""); } catch { return EMPTY_STRIP; }
}

const parsed = new Map<string, Strip>();
/** A saved strip; the same object for the same text, as useSyncExternalStore wants. */
export function parseStrip(text: string): Strip {
  const hit = parsed.get(text);
  if (hit) return hit;
  let strip = EMPTY_STRIP;
  try {
    const raw = JSON.parse(text || "null") as Partial<Strip> | null;
    const open = Array.isArray(raw?.open) ? raw.open.filter((id): id is string => typeof id === "string").slice(-STRIP_LIMIT) : [];
    const active = typeof raw?.active === "string" && open.includes(raw.active) ? raw.active : open.at(-1) ?? null;
    strip = open.length ? { open, active } : EMPTY_STRIP;
  } catch { /* unreadable: start empty */ }
  if (parsed.size > 50) parsed.clear();
  parsed.set(text, strip);
  return strip;
}

const listeners = new Set<() => void>();
/** Saves the strip and tells every mounted strip (both split panes, the sidebar). */
export function writeStrip(botId: string, strip: Strip) {
  try { localStorage.setItem(stripKey(botId), JSON.stringify(strip)); } catch { /* private mode */ }
  for (const listener of listeners) listener();
}
export function subscribeStrip(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key?.startsWith("studio.bot.")) listener(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

/** The strip, live: every mounted reader updates when any writer saves. */
export function useStrip(botId: string): [Strip, (next: (strip: Strip) => Strip) => void] {
  const raw = useSyncExternalStore(subscribeStrip, () => { try { return localStorage.getItem(stripKey(botId)) ?? ""; } catch { return ""; } });
  const strip = parseStrip(raw);
  const update = useCallback((next: (strip: Strip) => Strip) => writeStrip(botId, next(readStrip(botId))), [botId]);
  return [strip, update];
}

/**
 * Opens a sub-thread in the right panel's Threads tab: saves it into the
 * strip (so it's there however the tab mounts) and selects the tab with it
 * as the target. Falls back to BB's thread page when the host declines.
 */
export function useOpenSubThread(botId: string, fallback: (threadId: string) => void): (threadId: string) => void {
  const panel = experimental_useAppPanel();
  return useCallback((threadId: string) => {
    writeStrip(botId, stripOpen(readStrip(botId), threadId));
    if (!panel.openFixedTab({ surface: { kind: "current" }, tab: THREADS_TAB, target: { threadId } })) fallback(threadId);
  }, [botId, panel, fallback]);
}

/** Selects the Info tab. */
export function useOpenInfo(): () => boolean {
  const panel = experimental_useAppPanel();
  return useCallback(() => panel.openFixedTab({ surface: { kind: "current" }, tab: INFO_TAB }), [panel]);
}

// --- The Bot's sidebar -----------------------------------------------------

export interface TreeNode { thread: BotThreadView; children: TreeNode[] }
export interface SidebarGroups {
  needsYou: BotThreadView[];
  /** Started threads that are running or queued, or have such a thread below them. */
  running: TreeNode[];
  /** Automations that wake the Bot, other than its check-in. */
  recurring: BotScheduledView[];
  /** The rest of the threads it started, newest first. */
  recent: TreeNode[];
}

/**
 * Groups the Bot's threads for its sidebar. Needs you is flat (each one is a
 * thing to do); Running and Recent are trees, a thread under the thread that
 * started it at any depth, placed by its root.
 */
export function sidebarGroups(activity: BotActivityView | null | undefined): SidebarGroups {
  if (!activity) return { needsYou: [], running: [], recurring: [], recent: [] };
  const started = (list: readonly BotThreadView[]) => list.filter((thread) => thread.relation === "started");
  const busy = new Set([...activity.inProgress, ...(activity.waiting ?? [])].map((thread) => thread.id));
  const all = new Map<string, BotThreadView>();
  for (const thread of started([...activity.needsYou, ...activity.inProgress, ...(activity.waiting ?? []), ...activity.completed])) {
    if (!all.has(thread.id)) all.set(thread.id, thread);
  }
  const children = new Map<string | null, BotThreadView[]>();
  for (const thread of all.values()) {
    const parent = thread.parentId && all.has(thread.parentId) && thread.parentId !== thread.id ? thread.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), thread]);
  }
  const newest = (a: BotThreadView, b: BotThreadView) => b.updatedAt - a.updatedAt;
  const build = (thread: BotThreadView, seen: Set<string>): TreeNode => {
    seen.add(thread.id);
    const kids = (children.get(thread.id) ?? []).filter((kid) => !seen.has(kid.id)).sort(newest);
    return { thread, children: kids.map((kid) => build(kid, seen)) };
  };
  const hasBusy = (node: TreeNode): boolean => busy.has(node.thread.id) || node.children.some(hasBusy);
  const roots = (children.get(null) ?? []).sort(newest).map((thread) => build(thread, new Set()));
  return {
    needsYou: started(activity.needsYou),
    running: roots.filter(hasBusy),
    recurring: activity.scheduled.filter((item) => item.kind === "automation"),
    recent: roots.filter((node) => !hasBusy(node)),
  };
}
