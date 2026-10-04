// A Space at a glance, on its dashboard: what needs
// you, what's running, and every thread in it with sub-threads under their
// parent, then its newest items. The plan itself lives on the Space's page.
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Icon, openAppPath } from "@bb-studio/kit/app";
import { type ReactNode } from "react";
import { useSpaceLead, useSpaceOf, useSpaceOverview, type OverviewItem, type OverviewThread } from "./data";
import { cn } from "./styles";

export const RUNNING = new Set(["running", "starting", "active"]);
const ITEMS_SHOWN = 8;

/** A thread's state where BB draws it: needs you, running, unread, or nothing. */
export function ThreadGlyph({ thread }: { thread: PluginSidebarThread | undefined }) {
  if (thread?.hasPendingInteraction) return <span aria-label="Needs you" className="size-2 rounded-full bg-warning-foreground" />;
  if (thread && RUNNING.has(thread.runtimeStatus)) return <span aria-label="Running" className="size-3 rounded-full border-[1.5px] border-muted-foreground/60 border-r-transparent motion-safe:animate-spin" />;
  if (thread?.isUnread) return <span aria-label="Unread" className="size-1.5 rounded-full bg-foreground" />;
  return <span aria-hidden className="size-1 rounded-full bg-muted-foreground/30" />;
}

export interface OverviewRow { id: string; title: string; status?: string; updatedAt?: number; live: PluginSidebarThread | undefined }
export interface OverviewView {
  needsYou: OverviewRow[];
  running: OverviewRow[];
  failed: OverviewRow[];
  tree: { row: OverviewRow; children: OverviewRow[] }[];
}

/** Groups a Space's threads; `live` supplies BB's live state (needs you, running, unread). */
export function overviewOf(threads: readonly OverviewThread[], live: ReadonlyMap<string, PluginSidebarThread>): OverviewView {
  const rows = threads.filter((thread) => !thread.isLead).map((thread) => ({ thread, row: { id: thread.id, title: live.get(thread.id)?.displayTitle ?? thread.title, status: thread.status, updatedAt: thread.updatedAt, live: live.get(thread.id) } }));
  const ids = new Set(rows.map(({ thread }) => thread.id));
  const leadIds = new Set(threads.filter((thread) => thread.isLead).map((thread) => thread.id));
  const newest = (a: { thread: OverviewThread }, b: { thread: OverviewThread }) => b.thread.updatedAt - a.thread.updatedAt;
  // A sub-thread of the lead is top-level here: the lead is the view you're in.
  const isRoot = ({ thread }: { thread: OverviewThread }) => !thread.parentThreadId || leadIds.has(thread.parentThreadId) || !ids.has(thread.parentThreadId);
  return {
    needsYou: rows.filter(({ row }) => row.live?.hasPendingInteraction).sort(newest).map(({ row }) => row),
    running: rows.filter(({ row }) => !row.live?.hasPendingInteraction && row.live && RUNNING.has(row.live.runtimeStatus)).sort(newest).map(({ row }) => row),
    failed: rows.filter(({ row }) => row.status === "error" || row.status === "failed").sort(newest).map(({ row }) => row),
    tree: rows.filter(isRoot).sort(newest).map(({ thread, row }) => ({ row, children: rows.filter((child) => child.thread.parentThreadId === thread.id).sort(newest).map((child) => child.row) })),
  };
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section aria-label={title} className="px-2 pt-3">
      <h2 className="flex h-7 items-center justify-between px-2 text-xs font-medium text-muted-foreground">{title}{action}</h2>
      <div className="space-y-px">{children}</div>
    </section>
  );
}

function ThreadLine({ row, nested, onOpen }: { row: OverviewRow; nested?: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cn("flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-state-hover", nested && "pl-7")}>
      <span className="inline-flex size-4 shrink-0 items-center justify-center"><ThreadGlyph thread={row.live} /></span>
      <span className={cn("min-w-0 flex-1 truncate", row.live?.isUnread && "font-medium")}>{row.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{row.live?.hasPendingInteraction ? "Needs you" : row.live && RUNNING.has(row.live.runtimeStatus) ? "Running" : row.status === "error" || row.status === "failed" ? "Failed" : "Idle"}</span>
    </button>
  );
}

function ItemLine({ item }: { item: OverviewItem }) {
  return (
    <button type="button" onClick={() => openAppPath(item.href)} className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-state-hover">
      <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">{item.icon && !/^[A-Za-z]/.test(item.icon) ? item.icon : <Icon name={item.kind === "page" ? "FileText" : "File"} className="size-4" />}</span>
      <span className="min-w-0 flex-1 truncate">{item.title || "Untitled"}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(item.updatedAt)}</span>
    </button>
  );
}

export function SpaceOverview({ spaceId, onOpenThread, onNewThread }: { spaceId: string; onOpenThread?: (threadId: string) => boolean; onNewThread?: () => void }) {
  const overview = useSpaceOverview(spaceId);
  const lead = useSpaceLead(spaceId);
  const { threads } = useSidebarThreads();
  const threadActions = useSidebarThreadActions();
  const live = new Map(threads.map((thread) => [thread.id, thread]));
  const view = overviewOf(overview.data?.threads ?? [], live);
  const items = overview.data?.items ?? [];
  const run = lead.data?.run?.enabled ? lead.data.run : null;
  const open = (threadId: string) => { if (!onOpenThread?.(threadId)) threadActions.open(threadId); };
  return (
    <div className="pb-4">
      {overview.error ? <p role="alert" className="px-4 py-2 text-sm text-destructive">{overview.error} <button type="button" onClick={overview.refresh} className="underline">Retry</button></p> : null}
      {overview.loading && !overview.data ? <p role="status" className="px-4 py-2 text-sm text-muted-foreground">Loading space activity…</p> : null}
      {overview.data ? <p className="px-4 pt-4 text-sm text-muted-foreground">{view.needsYou.length ? `${view.needsYou.length} ${view.needsYou.length === 1 ? "thread needs" : "threads need"} your input. ` : "No threads waiting for your input. "}{view.running.length ? `${view.running.length} ${view.running.length === 1 ? "thread is" : "threads are"} working.` : "No worker threads running."}</p> : null}
      {run
        ? <p className="flex items-center gap-2 px-4 pt-3 text-xs text-muted-foreground"><Icon name="Repeat" className="size-3.5" />The lead checks in {run.cadence === "hourly" ? "every hour" : run.cadence === "daily" ? "every day" : "on weekdays"} and reports to your Inbox.</p>
        : null}
      {view.needsYou.length ? <Section title="Needs you">{view.needsYou.map((row) => <ThreadLine key={row.id} row={row} onOpen={() => open(row.id)} />)}</Section> : null}
      {view.running.length ? <Section title="Running">{view.running.map((row) => <ThreadLine key={row.id} row={row} onOpen={() => open(row.id)} />)}</Section> : null}
      {view.failed.length ? <Section title="Failed">{view.failed.map((row) => <ThreadLine key={row.id} row={row} onOpen={() => open(row.id)} />)}</Section> : null}
      <Section
        title="Threads"
        action={onNewThread ? <button type="button" aria-label="New thread in this Space" title="New thread in this Space" onClick={onNewThread} className="inline-flex size-6 items-center justify-center rounded-md hover:bg-state-hover hover:text-foreground"><Icon name="Plus" className="size-4" /></button> : undefined}
      >
        {view.tree.map(({ row, children }) => (
          <div key={row.id} className="space-y-px">
            <ThreadLine row={row} onOpen={() => open(row.id)} />
            {children.map((child) => <ThreadLine key={child.id} row={child} nested onOpen={() => open(child.id)} />)}
          </div>
        ))}
        {overview.data && !view.tree.length ? <p className="px-2 py-2 text-xs text-muted-foreground">No other threads yet. The lead starts them as the work needs, or start one with +.</p> : null}
      </Section>
      {items.length
        ? <Section title="Recently updated">{items.slice(0, ITEMS_SHOWN).map((item) => <ItemLine key={item.ref} item={item} />)}</Section>
        : null}
    </div>
  );
}

/** Thread panel: the overview of the thread's Space, from any of its threads. */
export function ThreadSpaceOverview({ threadId }: PluginThreadPanelProps) {
  const spaceOf = useSpaceOf();
  const spaceId = spaceOf(threadId);
  return spaceId ? <SpaceOverview spaceId={spaceId} /> : <p className="p-4 text-sm text-muted-foreground">This thread isn't in a Space.</p>;
}
