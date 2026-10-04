// The Space's status belongs beside the lead chat. BB owns the workbench tabs.
import {
  type PluginNavPanelProps,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { GHOST_BUTTON, Icon, openAppPath } from "@bb-studio/kit/app";
import { useState } from "react";
import { useSpaceLead, useSpaceOf, useSpaceOverview } from "./data";
import { cn } from "./styles";
import { spaceIdOf } from "./routes";
import { StartThreadDialog } from "./SpaceView";

import { RUNNING, stateOf } from "./status";
export { RUNNING } from "./status";

export function ThreadGlyph({ thread }: { thread: PluginSidebarThread | undefined }) {
  if (thread?.hasPendingInteraction) return <span aria-label="Needs you" className="size-2 rounded-full bg-warning-foreground" />;
  if (thread && RUNNING.has(thread.runtimeStatus)) return <span aria-label="Working" className="size-3 rounded-full border-[1.5px] border-muted-foreground/60 border-r-transparent motion-safe:animate-spin" />;
  return <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/40" />;
}

function relative(at: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(at);
}


export function SpaceOverview({ spaceId, onOpenThread, onNewThread }: { spaceId: string; onOpenThread?: (threadId: string) => boolean; onNewThread?: () => void }) {
  const overview = useSpaceOverview(spaceId);
  const { threads } = useSidebarThreads();
  const actions = useSidebarThreadActions();
  const live = new Map(threads.map((thread) => [thread.id, thread]));
  const rows = (overview.data?.threads ?? []).map((thread) => ({ thread, live: live.get(thread.id), state: stateOf(thread, live.get(thread.id)) }))
    .sort((a, b) => a.state.order - b.state.order || Number(b.thread.isLead) - Number(a.thread.isLead) || b.thread.updatedAt - a.thread.updatedAt);
  const attention = rows.filter((row) => row.state.order === 0).length;
  const working = rows.filter((row) => row.state.order === 1).length;
  const open = (id: string) => { if (!onOpenThread?.(id)) actions.open(id); };
  return <div className="mx-auto w-full max-w-4xl px-5 py-6 sm:px-7">
    <header className="flex items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">Space status</h1>
      <button type="button" onClick={overview.refresh} aria-label="Refresh space status" className={GHOST_BUTTON}><Icon name="RefreshCw" className="size-4" /></button>
    </header>
    {overview.error ? <p role="alert" className="mt-3 text-sm text-destructive">Couldn’t update space status. {overview.data ? "Showing the last loaded status." : ""} <button type="button" onClick={overview.refresh} className="underline">Retry</button></p> : null}
    {overview.loading && !overview.data ? <p role="status" className="mt-4 text-sm text-muted-foreground">Loading space activity…</p> : null}
    {overview.data ? <p className="mt-2 mb-6 text-sm text-muted-foreground">{attention ? `${attention} ${attention === 1 ? "thread needs" : "threads need"} attention. ` : "No threads need attention. "}{working ? `${working} ${working === 1 ? "thread is" : "threads are"} working.` : "No threads are running."}</p> : null}
    <section aria-labelledby="space-threads-heading">
      <div className="mb-3 flex items-center justify-between gap-2"><h2 id="space-threads-heading" className="text-sm font-semibold">Threads</h2>{onNewThread ? <button type="button" onClick={onNewThread} className={GHOST_BUTTON}><Icon name="Plus" className="size-3.5" />New thread</button> : null}</div>
      <div className="overflow-hidden rounded-lg border border-border">
        <div aria-hidden className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_5rem_4rem]"><span>Thread / latest progress</span><span>State</span><span className="hidden text-right sm:block">Updated</span></div>
        {rows.map(({ thread, live: current, state }) => <button key={thread.id} type="button" onClick={() => open(thread.id)} className="grid w-full grid-cols-[minmax(0,1fr)_5rem] items-start gap-3 border-b border-border px-4 py-3.5 text-left last:border-b-0 hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,1fr)_5rem_4rem]">
          <span className="min-w-0"><span className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{current?.displayTitle ?? thread.title}</span>{thread.isLead ? <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">Lead</span> : null}</span><span className={cn("mt-1 block line-clamp-2 break-words text-xs leading-relaxed", state.order === 0 ? state.tone : "text-muted-foreground")}>{state.reason}</span></span>
          <span className={cn("flex items-center gap-1.5 pt-0.5 text-xs", state.tone)}><span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", state.order === 0 ? "bg-current" : state.order === 1 ? "bg-current motion-safe:animate-pulse" : "bg-muted-foreground/40")} />{state.label}</span>
          <time dateTime={new Date(thread.progressAt ?? thread.updatedAt).toISOString()} className="hidden pt-0.5 text-right text-xs text-muted-foreground sm:block">{relative(thread.progressAt ?? thread.updatedAt)}</time>
        </button>)}
        {overview.data && !rows.length ? <p className="px-4 py-6 text-sm text-muted-foreground">No threads yet. Start a thread to give this Space some work.</p> : null}
      </div>
    </section>
    {overview.data?.activity?.length ? <section aria-labelledby="space-activity-heading" className="mt-7"><h2 id="space-activity-heading" className="mb-4 text-sm font-semibold">Recent activity</h2><ol className="space-y-4">{overview.data.activity.slice(0, 12).map((event) => <li key={event.id} className="flex items-start gap-3"><span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" /><div className="min-w-0 flex-1"><button type="button" onClick={() => open(event.threadId)} className="max-w-full text-left text-sm hover:underline">{event.summary}</button><p className="mt-1 truncate text-xs text-muted-foreground">{event.title}</p></div><time dateTime={new Date(event.at).toISOString()} className="shrink-0 pt-0.5 text-xs text-muted-foreground">{relative(event.at)}</time></li>)}</ol></section> : null}
    {overview.data?.items.length ? <section aria-label="Space items" className="mt-7 border-t border-border pt-5"><h2 className="mb-3 text-sm font-semibold">Space items</h2><div className="flex flex-wrap gap-2">{overview.data.items.slice(0, 6).map((item) => <button key={item.ref} type="button" onClick={() => openAppPath(item.href)} className={cn(GHOST_BUTTON, "max-w-full border border-border")}><Icon name={item.kind === "page" ? "FileText" : "File"} className="size-3.5 shrink-0" /><span className="truncate">{item.title}</span></button>)}</div></section> : null}
  </div>;
}

export function ThreadSpaceOverview({ threadId }: PluginThreadPanelProps) {
  const spaceOf = useSpaceOf();
  const spaceId = spaceOf(threadId);
  return spaceId ? <SpaceOverview spaceId={spaceId} /> : <p className="p-4 text-sm text-muted-foreground">This thread isn’t in a Space.</p>;
}

export function SpaceDashboardTab({ subPath }: PluginNavPanelProps) {
  const spaceId = spaceIdOf(subPath);
  return spaceId ? <SpaceDashboard key={spaceId} spaceId={spaceId} /> : <p className="p-4 text-sm text-muted-foreground">Open a Space to see its status.</p>;
}

function SpaceDashboard({ spaceId }: { spaceId: string }) {
  const lead = useSpaceLead(spaceId);
  const [starting, setStarting] = useState(false);
  return <div className="h-full min-h-0 overflow-y-auto">
    <SpaceOverview spaceId={spaceId} onNewThread={() => setStarting(true)} />
    {starting ? <StartThreadDialog spaceId={spaceId} name={lead.data?.name ?? "this Space"} defaultProjectId={lead.data?.defaultProjectId ?? null} onClose={() => setStarting(false)} /> : null}
  </div>;
}
