// The Bot's workspace: its right-panel Info tab, how its threads open (as
// BB threads, in the main pane), and how its sidebar groups the threads it
// started. No React components here, so app.tsx, the page and the tabs can
// share it without import cycles.
import { experimental_useAppPanel, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useCallback } from "react";
import type { BotActivityView, BotScheduledView, BotThreadView } from "../../contract";

/** The Bot's nav panel id (also BOT_PANEL in BotHome). */
const PANEL = "bot";

/** Info: the Bot's profile, controls, check-ins and activity. */
export const INFO_TAB = { panelId: PANEL, id: "info" } as const;

/** Opens one of the Bot's threads the way BB's own thread list does: as the thread, in the main pane. */
export function useOpenThread(): (threadId: string) => void {
  const navigate = useBbNavigate();
  return useCallback((threadId: string) => navigate.toThread(threadId), [navigate]);
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
 * started it at any depth, placed by its root. A childless thread that
 * needs the user is only under Needs you.
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
  // A thread waiting on the user is already under Needs you; it stays in a tree only to hold its children.
  const roots = (children.get(null) ?? []).sort(newest).map((thread) => build(thread, new Set())).filter((node) => !node.thread.needsYou || node.children.length);
  return {
    needsYou: started(activity.needsYou),
    running: roots.filter(hasBusy),
    recurring: activity.scheduled.filter((item) => item.kind === "automation"),
    recent: roots.filter((node) => !hasBusy(node)),
  };
}
