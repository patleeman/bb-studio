// The Bot's workspace: how its threads open (as BB threads, in the main
// pane, its chat included), where its Info opens, and how its sidebar groups
// the threads it started. No React components here, so app.tsx, the page and
// the tabs can share it without import cycles.
import { openAppPath } from "../../kit/app/index";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect } from "react";
import type { BotActivityView, BotScheduledView, BotThreadView } from "../../contract";
import { botPath } from "./selection";
import { LOOPS_PANE } from "../../loops/ui/hooks";
import { INFO_TAB, requestThreadTab, type ThreadTabOpen } from "../../kit/app/thread-panel";

/** The thread tab that shows a Bot thread's Info (app.tsx). */
/** Bot info is BB's own Info tab, whose top is the Bot's section (src/ui/thread-context.tsx). */
export const BOT_INFO_ACTION = INFO_TAB;

/**
 * Opens one of the Bot's threads the way BB's own thread list does: as the
 * thread, in the main pane. This window's sidebar switches to the Bots list
 * first, and keeps it on any thread until the user leaves (threadListSwitch.ts).
 */
export function useOpenThread(): (threadId: string) => void {
  const navigate = useBbNavigate();
  return useCallback((threadId: string) => { navigate.toThread(threadId); }, [navigate]);
}

/** Drops the strips the removed Threads tab saved (`studio.bot.<botId>.threads`). */
export function forgetThreadStrips(storage: Pick<Storage, "length" | "key" | "removeItem"> = localStorage): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && /^studio\.bot\.[^.]+\.threads$/.test(key)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch { /* private mode */ }
}

/**
 * Opens a Bot's Info: beside the chat (the Bot info tab) when one of its
 * threads is open, else its Bot page, which is its Info. The sidebar isn't
 * inside the thread view, so it asks the open thread (requestThreadTab), and
 * opens the Bot page when the tab couldn't open.
 */
export function useOpenBotInfo(): (bot: { id: string; primary?: boolean }, onBotsThread: boolean) => void {
  return useCallback((bot, onBotsThread) => {
    const threadId = visit.threadId;
    if (!onBotsThread || !threadId) { openAppPath(botPath(bot.id)); return; }
    void requestThreadTab(threadId, BOT_INFO_PANEL).then((opened) => { if (!opened) openAppPath(botPath(bot.id)); });
  }, []);
}

/** A tab beside the Bot's chat: Bot info, or the Todos pane (src/loops/ui/LoopsPane.tsx). */
export type ChatPanel = ThreadTabOpen & { title: string };
export const BOT_INFO_PANEL: ChatPanel = { actionId: BOT_INFO_ACTION, title: "Info" };
export const LOOPS_PANEL: ChatPanel = { actionId: LOOPS_PANE, title: "Todos" };

/** The thread open in the main pane, and whether a panel was opened beside it yet. */
let visit: { threadId: string | null; infoOpened: boolean } = { threadId: null, infoOpened: false };
/** Notes the thread now open (null: none); a different one starts a new visit. */
export function noteOpenThread(threadId: string | null): void {
  if (threadId !== visit.threadId) visit = { threadId, infoOpened: false };
}

/**
 * Opens a panel beside a Bot's own chat (`chatIds`: its chain) once each
 * time that thread opens: `panel` (Bot info unless the caller says, e.g. the
 * Todos pane while something needs the user). Closing it sticks until the
 * user opens the thread again. The chat's view opens it once when it's on
 * screen.
 */
export function useOpenBotInfoOnChat(activeThreadId: string | null, chatIds: readonly string[], panel: ChatPanel = BOT_INFO_PANEL): void {
  const onChat = !!activeThreadId && chatIds.includes(activeThreadId);
  useEffect(() => {
    noteOpenThread(activeThreadId);
    if (!activeThreadId || !onChat) return;
    if (visit.infoOpened) return;
    visit.infoOpened = true;
    // A background open leaves a tab the user already opened alone.
    void requestThreadTab(activeThreadId, { ...panel, background: true });
    // The panel is chosen when the chat opens; a later change waits for the next visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, onChat]);
}

// --- The Bot's sidebar -----------------------------------------------------

export interface TreeNode { thread: BotThreadView; children: TreeNode[] }
export interface SidebarGroups {
  /** Started threads that are running, or have a running thread below them. */
  running: TreeNode[];
  /** Started threads queued to start (none running in their tree). */
  waiting: TreeNode[];
  /** Automations that wake the Bot, other than its check-in. */
  recurring: BotScheduledView[];
  /** The rest of the threads it started, newest first. */
  recent: TreeNode[];
}

/**
 * Groups the Bot's threads for its sidebar. Running, Waiting to start and
 * Recent are trees, a thread under the thread that started it at any depth,
 * placed by its root. A thread waiting on an answer is under Running: the
 * Bot owns it, and the Bot's row says when something needs the user.
 */
export function sidebarGroups(activity: BotActivityView | null | undefined): SidebarGroups {
  if (!activity) return { running: [], waiting: [], recurring: [], recent: [] };
  const started = (list: readonly BotThreadView[]) => list.filter((thread) => thread.relation === "started");
  const working = new Set(activity.inProgress.map((thread) => thread.id));
  const queued = new Set((activity.waiting ?? []).map((thread) => thread.id));
  const all = new Map<string, BotThreadView>();
  for (const thread of started([...activity.inProgress, ...(activity.waiting ?? []), ...activity.completed])) {
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
  const hasRunning = (node: TreeNode): boolean => working.has(node.thread.id) || node.children.some(hasRunning);
  const hasQueued = (node: TreeNode): boolean => queued.has(node.thread.id) || node.children.some(hasQueued);
  const roots = (children.get(null) ?? []).sort(newest).map((thread) => build(thread, new Set()));
  return {
    running: roots.filter(hasRunning),
    waiting: roots.filter((node) => !hasRunning(node) && hasQueued(node)),
    recurring: activity.scheduled.filter((item) => item.kind === "automation"),
    recent: roots.filter((node) => !hasRunning(node) && !hasQueued(node)),
  };
}
