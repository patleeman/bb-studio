// The sidebar's tabs (docs/office-tabs.md): Essentials, Pinned (with folders)
// and Today, per Space. Anything you open that isn't a tab yet joins the top
// of Today; Today tabs archive on their own after a while. Threads come back
// from the server with no title, and get theirs from BB's thread list here.
import {
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocationHref } from "./location";
import { setCurrentSpaceId, useCall, useLive } from "./model";
import { officePath } from "./routes";

export type TabZone = "essential" | "pinned" | "today" | "archived";
export type TabKind = "thread" | "item" | "bot" | "conversation" | "inbox" | "home" | "library" | "folder" | "split";

export interface Tab {
  ref: string;
  kind: TabKind;
  title: string | null;
  icon: string | null;
  href: string | null;
  zone: TabZone;
  folderId: string | null;
  openedAt: number;
  archivedAt: number | null;
  itemKind?: string;
  providerId?: string;
  botState?: "idle" | "working" | "needs_you";
  badge?: number;
  needsYou?: boolean;
  unread?: boolean;
  /** A split's tabs, in pane order (left to right). */
  members?: Tab[];
}

export interface TabFolder { id: string; name: string; open: boolean; position: number }

interface TabsResult {
  seeded: boolean;
  essentials: Tab[];
  pinned: Tab[];
  folders: TabFolder[];
  today: Tab[];
}

/** A tab with its thread attached, when it is one. Tabs whose thread is gone are dropped. */
export interface ShownTab extends Omit<Tab, "members"> {
  title: string;
  thread: PluginSidebarThread | null;
  /** A split's tabs, with their threads attached. */
  members?: ShownTab[];
}

export function threadRef(threadId: string): string {
  return `thread:${threadId}`;
}

function threadIdOf(ref: string): string | null {
  return ref.startsWith("thread:") ? ref.slice("thread:".length) : null;
}

/** A tab as the UI draws it, without BB's thread list: titles fall back to "Untitled". */
export function shownTab(tab: Tab): ShownTab {
  const { members, ...rest } = tab;
  const shownMembers = members?.map(shownTab);
  return { ...rest, title: tab.title || shownMembers?.map((member) => member.title).join(" | ") || "Untitled", thread: null, ...(shownMembers ? { members: shownMembers } : {}) };
}

/**
 * Whether the route shows this tab. `location` is path plus query, since a
 * Library view's address carries its filter. A bot's desk counts on any of its
 * own tabs.
 */
export function isTabActive(tab: ShownTab, activeThreadId: string | null, location: string): boolean {
  if (tab.members) return tab.members.some((member) => isTabActive(member, activeThreadId, location));
  if (tab.thread) return tab.thread.id === activeThreadId;
  if (!tab.href || activeThreadId) return false;
  return location === tab.href || (tab.kind === "bot" && location.startsWith(`${tab.href}/`));
}

/** Fills in thread titles and state; drops thread tabs BB no longer lists. */
export function attach(tabs: readonly Tab[], threads: ReadonlyMap<string, PluginSidebarThread>): ShownTab[] {
  return tabs.flatMap((tab): ShownTab[] => {
    if (tab.kind === "split") {
      const members = attach(tab.members ?? [], threads);
      if (!members.length) return [];
      const { members: _raw, ...rest } = tab;
      return [{ ...rest, members, title: members.map((member) => member.title).join(" | "), thread: null, unread: members.some((member) => member.unread), needsYou: members.some((member) => member.needsYou) }];
    }
    const threadId = threadIdOf(tab.ref);
    if (!threadId) {
      const { members: _raw, ...rest } = tab;
      return [{ ...rest, title: tab.title || "Untitled", thread: null }];
    }
    const thread = threads.get(threadId);
    const { members: _raw, ...rest } = tab;
    return thread ? [{ ...rest, title: thread.displayTitle, unread: thread.isUnread, needsYou: thread.hasPendingInteraction, thread }] : [];
  });
}

export function useTabs(spaceId: string | null) {
  const call = useCall();
  const live = useLive<TabsResult>("tabs_get", { spaceId }, { enabled: spaceId !== null, pollMs: 120_000 });
  const { threads } = useSidebarThreads();
  const byId = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);

  // First visit to a Space: seed Pinned from its favorites, once.
  const seeding = useRef<string | null>(null);
  useEffect(() => {
    if (!spaceId || !live.data || live.data.seeded || seeding.current === spaceId) return;
    seeding.current = spaceId;
    const pinnedThreadIds = threads.filter((thread) => thread.isPinned && !thread.isArchived).map((thread) => thread.id);
    void call("tabs_seed", { spaceId, pinnedThreadIds }).then(live.refresh, () => undefined);
  }, [spaceId, live.data, threads, call, live.refresh]);

  const data = live.data;
  return {
    ...live,
    essentials: attach(data?.essentials ?? [], byId),
    pinned: attach(data?.pinned ?? [], byId),
    folders: data?.folders ?? [],
    today: attach(data?.today ?? [], byId),
    threads,
  };
}

export function useTabActions(spaceId: string | null, refresh: () => void) {
  const call = useCall();
  const run = useCallback((method: string, input: Record<string, unknown>) => {
    void call(method, input).then(refresh, refresh);
  }, [call, refresh]);
  return useMemo(() => ({
    move: (ref: string, zone: TabZone, options: { folderId?: string | null; index?: number } = {}) => run("tabs_move", { spaceId, ref, zone, ...options }),
    archive: (ref: string) => run("tabs_move", { spaceId, ref, zone: "archived" }),
    closeMany: (refs: readonly string[]) => { if (refs.length) run("tabs_close_many", { spaceId, refs }); },
    separate: (ref: string) => run("tabs_split_remove", { spaceId, ref }),
    /** Keeps panes open side by side as one split tab (pane order, left to right). */
    keepSplit: (refs: readonly string[]) => run("tabs_split_create", { spaceId, refs }),
    moveToSpace: (ref: string, toSpaceId: string) => run("tabs_move_space", { spaceId, ref, toSpaceId }),
    /** Brings back the tab closed last; resolves to it, or null when nothing was closed. */
    reopen: async (): Promise<Tab | null> => {
      const { tab } = await call("tabs_reopen", { spaceId }) as { tab: Tab | null };
      refresh();
      return tab;
    },
    open: (ref: string) => run("tabs_open", { spaceId, ref }),
    /** Makes a Pinned folder, then files `withRef` in it when given. */
    createFolder: (name: string, withRef?: string) => {
      void call("tab_folder_create", { spaceId, name })
        .then(async (result) => {
          const { folder } = result as { folder: TabFolder };
          if (withRef) await call("tabs_move", { spaceId, ref: withRef, zone: "pinned", folderId: folder.id });
        })
        .then(refresh, refresh);
    },
    updateFolder: (folderId: string, patch: { name?: string; open?: boolean; position?: number }) => run("tab_folder_update", { folderId, ...patch }),
    deleteFolder: (folderId: string) => run("tab_folder_delete", { folderId }),
  }), [run, spaceId, call, refresh]);
}

/**
 * Keeps Today honest: whatever the route shows becomes a tab. Threads go by
 * id; any other page goes by its path, which the server resolves to a ref (or
 * ignores, for pages that aren't things you'd keep, like settings). Home is
 * the new-tab page, so landing there adds nothing; you can still pin it.
 */
export function useTrackOpen(spaceId: string | null, activeThreadId: string | null, knownHrefs: ReadonlySet<string>, knownRefs: ReadonlySet<string>, refresh: () => void) {
  const call = useCall();
  const href = useLocationHref();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!spaceId) return;
    const key = activeThreadId ? threadRef(activeThreadId) : href;
    if (!key || key === last.current) return;
    last.current = key;
    if (!activeThreadId && href === officePath("") && !knownHrefs.has(href)) return;
    // Already a tab: only its opened time moves, so there's nothing to redraw.
    const known = activeThreadId ? knownRefs.has(key) : knownHrefs.has(href);
    // Something new from another Space opens there, and the sidebar follows
    // it (Space routing); a tab you already have here stays here.
    const follow = !known && readRouting() === "own";
    void call("tabs_open", { spaceId, follow, ...(activeThreadId ? { ref: key } : { href }) })
      .then((result) => {
        const landed = (result as { spaceId?: string }).spaceId;
        if (landed && landed !== spaceId) setCurrentSpaceId(landed);
        else if (!known) refresh();
      }, () => undefined);
  }, [spaceId, activeThreadId, href, knownHrefs, knownRefs, call, refresh]);
}

// Space routing, per browser: "own" opens things in the Space they belong to;
// "current" keeps everything in the Space you're in.
const ROUTING_KEY = "bb-studio.office.routing";
export type Routing = "own" | "current";
export function readRouting(): Routing {
  // Off by default, as in Arc ("most recent Space"): routing everything away
  // made a Space with no projects of its own keep only one tab.
  try { return globalThis.localStorage?.getItem(ROUTING_KEY) === "own" ? "own" : "current"; } catch { return "current"; }
}
export function writeRouting(routing: Routing): void {
  try { globalThis.localStorage?.setItem(ROUTING_KEY, routing); } catch { /* private mode */ }
}
