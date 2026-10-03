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
import { useCall, useLive } from "./model";
import { officePath } from "./routes";

export type TabZone = "essential" | "pinned" | "today" | "archived";
export type TabKind = "thread" | "item" | "bot" | "conversation" | "inbox" | "home" | "library" | "folder";

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
export interface ShownTab extends Tab {
  title: string;
  thread: PluginSidebarThread | null;
}

export function threadRef(threadId: string): string {
  return `thread:${threadId}`;
}

function threadIdOf(ref: string): string | null {
  return ref.startsWith("thread:") ? ref.slice("thread:".length) : null;
}

/**
 * Whether the route shows this tab. `location` is path plus query, since a
 * Library view's address carries its filter. A bot's desk counts on any of its
 * own tabs.
 */
export function isTabActive(tab: ShownTab, activeThreadId: string | null, location: string): boolean {
  if (tab.thread) return tab.thread.id === activeThreadId;
  if (!tab.href || activeThreadId) return false;
  return location === tab.href || (tab.kind === "bot" && location.startsWith(`${tab.href}/`));
}

/** Fills in thread titles and state; drops thread tabs BB no longer lists. */
export function attach(tabs: readonly Tab[], threads: ReadonlyMap<string, PluginSidebarThread>): ShownTab[] {
  return tabs.flatMap((tab): ShownTab[] => {
    const threadId = threadIdOf(tab.ref);
    if (!threadId) return [{ ...tab, title: tab.title || "Untitled", thread: null }];
    const thread = threads.get(threadId);
    return thread ? [{ ...tab, title: thread.displayTitle, unread: thread.isUnread, needsYou: thread.hasPendingInteraction, thread }] : [];
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
    open: (ref: string) => run("tabs_open", { spaceId, ref }),
    newFolder: (name: string) => run("tab_folder_create", { spaceId, name }),
    updateFolder: (folderId: string, patch: { name?: string; open?: boolean }) => run("tab_folder_update", { folderId, ...patch }),
    deleteFolder: (folderId: string) => run("tab_folder_delete", { folderId }),
  }), [run, spaceId]);
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
    void call("tabs_open", activeThreadId ? { spaceId, ref: key } : { spaceId, href: href })
      .then(() => { if (!known) refresh(); }, () => undefined);
  }, [spaceId, activeThreadId, href, knownHrefs, knownRefs, call, refresh]);
}
