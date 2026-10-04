// A Space's status, beside its lead: what needs you, what's running and what
// it's doing, the Space's Studio items, and recent activity. Built from the
// threads' own events, so it stays true when the lead is busy or wrong.
// Threads and items open as workbench tabs; the lead stays in the chat.
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  type PluginSidebarThread,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { BAR_BUTTON, cn, Icon } from "@bb-studio/kit/app";
import { useMemo, useState, type ReactNode } from "react";
import { useSpaceLead, useSpaceOf, useSpaceOverview, type OverviewItem, type OverviewThread, type SpaceLead } from "./data";
import { NewInSpaceMenu } from "./NewInSpace";
import { RUN_LABELS, StartThreadDialog } from "./SpaceView";
import { RUNNING, startedByLead, stateOf } from "./status";
import { openItemsTab, openItemTab, openThreadTab } from "./tabs";

export { RUNNING } from "./status";

export function ThreadGlyph({ thread }: { thread: PluginSidebarThread | undefined }) {
  if (thread?.hasPendingInteraction) return <span aria-label="Needs you" className="size-2 rounded-full bg-warning-foreground" />;
  if (thread && RUNNING.has(thread.runtimeStatus)) return <span aria-label="Working" className="size-3 rounded-full border-[1.5px] border-muted-foreground/60 border-r-transparent motion-safe:animate-spin" />;
  return <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/40" />;
}

function relative(at: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(at);
}

function Time({ at }: { at: number }) {
  return <time dateTime={new Date(at).toISOString()} className="shrink-0 text-xs text-muted-foreground tabular-nums">{relative(at)}</time>;
}

/** Idle threads shown before "Show all": the most recently active ones. */
const IDLE_SHOWN = 4;

type Row = { thread: OverviewThread; title: string; state: ReturnType<typeof stateOf>; byLead: boolean; at: number };

function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-7 first:mt-5">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}{count ? <span className="ml-1.5 tabular-nums">{count}</span> : null}</h2>
        <div className="ml-auto flex items-center gap-1">{action}</div>
      </div>
      {children}
    </section>
  );
}

function Who({ row }: { row: Row }) {
  return <span className="text-xs text-muted-foreground">{row.thread.isLead ? "Lead" : row.byLead ? "Lead's worker" : "Yours"}</span>;
}

function AttentionCard({ row, onOpen }: { row: Row; onOpen(): void }) {
  return (
    <button type="button" onClick={onOpen} className="group block w-full rounded-lg border border-border bg-background p-3.5 text-left hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
      <span className="flex items-center gap-2">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full bg-current", row.state.tone)} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.title}</span>
        <span className={cn("shrink-0 text-xs font-medium", row.state.tone)}>{row.state.label}</span>
      </span>
      <span className="mt-1.5 block line-clamp-3 text-sm leading-relaxed break-words">{row.state.reason}</span>
      <span className="mt-2 flex items-center gap-2"><Who row={row} /><span aria-hidden className="text-xs text-muted-foreground">·</span><Time at={row.at} /><span className="ml-auto text-xs text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">Open beside the lead →</span></span>
    </button>
  );
}

function ThreadRow({ row, onOpen, live }: { row: Row; onOpen(): void; live: PluginSidebarThread | undefined }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 rounded-md px-2 py-2.5 text-left hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
      <span className="mt-1.5 inline-flex size-3 shrink-0 items-center justify-center"><ThreadGlyph thread={live} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium">{row.title}</span><Time at={row.at} /></span>
        <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed break-words text-muted-foreground">{row.state.reason}</span>
        <span className="mt-1 block"><Who row={row} /></span>
      </span>
    </button>
  );
}

export function ItemRow({ item, onOpen }: { item: OverviewItem; onOpen(): void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
      <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {item.icon ? <span className="text-sm leading-none">{item.icon}</span> : <Icon name={item.kind === "page" ? "FileText" : "File"} className="size-4" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground capitalize">{item.kind}</span>
      <Time at={item.updatedAt} />
    </button>
  );
}

function heartbeat(lead: SpaceLead | null): string | null {
  if (!lead?.leadThreadId) return null;
  return lead.run?.enabled ? `Heartbeat: ${RUN_LABELS[lead.run.cadence].toLowerCase()}` : "Heartbeat off";
}

/** The status page for a Space, opened beside one of its threads. */
export function SpaceStatus({ spaceId }: { spaceId: string }) {
  const overview = useSpaceOverview(spaceId);
  const lead = useSpaceLead(spaceId);
  const navigate = useBbNavigate();
  const { threads: sidebar } = useSidebarThreads();
  const [starting, setStarting] = useState(false);
  const [showAllIdle, setShowAllIdle] = useState(false);
  const live = useMemo(() => new Map(sidebar.map((thread) => [thread.id, thread])), [sidebar]);
  const leadId = lead.data?.leadThreadId ?? null;
  const rows = useMemo<Row[]>(() => {
    const all = overview.data?.threads ?? [];
    const byId = new Map(all.map((thread) => [thread.id, thread]));
    return all.map((thread) => ({
      thread,
      title: live.get(thread.id)?.displayTitle ?? thread.title,
      state: stateOf(thread, live.get(thread.id)),
      byLead: startedByLead(thread, byId, leadId),
      at: Math.max(thread.progressAt ?? 0, thread.updatedAt),
    })).sort((a, b) => b.at - a.at);
  }, [leadId, live, overview.data?.threads]);
  // The lead is the chat beside this tab; it shows here only when it needs you.
  const attention = rows.filter((row) => row.state.order === 0);
  const working = rows.filter((row) => row.state.order === 1 && !row.thread.isLead);
  const idle = rows.filter((row) => row.state.order === 2 && !row.thread.isLead);
  const leadRow = rows.find((row) => row.thread.isLead);
  const items = overview.data?.items ?? [];
  const open = (row: Row) => openThreadTab(navigate, { id: row.thread.id, title: row.title });
  const name = lead.data?.name ?? "Space";
  const beat = heartbeat(lead.data);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-5 pt-5 pb-10">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {overview.data ? <>
                <span className={attention.length ? "font-medium text-warning-foreground" : undefined}>{attention.length ? `${attention.length} need${attention.length === 1 ? "s" : ""} you` : "Nothing needs you"}</span>
                <span>{working.length} working</span>
                <span>{idle.length} idle</span>
              </> : null}
              {beat ? <span>{beat}</span> : null}
            </p>
          </div>
          <button type="button" onClick={() => setStarting(true)} className={BAR_BUTTON} title="Start a thread in this Space"><Icon name="MessageSquarePlus" className="size-4" />Thread</button>
          <NewInSpaceMenu spaceId={spaceId} onCreated={(item) => openItemTab(navigate, item)} />
        </header>

        {overview.error ? <p role="alert" className="mt-3 text-sm text-destructive">Couldn't update the status. {overview.data ? "Showing the last loaded status." : ""} <button type="button" onClick={overview.refresh} className="underline">Retry</button></p> : null}
        {overview.loading && !overview.data ? <p role="status" className="mt-6 text-sm text-muted-foreground">Loading…</p> : null}

        {overview.data ? <>
          {attention.length ? (
            <Section title="Needs you" count={attention.length}>
              <div className="space-y-2">{attention.map((row) => <AttentionCard key={row.thread.id} row={row} onOpen={() => open(row)} />)}</div>
            </Section>
          ) : null}

          <Section title="Working" count={working.length}>
            {working.length
              ? <div className="-mx-2">{working.map((row) => <ThreadRow key={row.thread.id} row={row} live={live.get(row.thread.id)} onOpen={() => open(row)} />)}</div>
              : <p className="text-sm text-muted-foreground">{leadRow?.state.order === 1 ? "Only the lead is working right now." : "Nothing is running."} <button type="button" onClick={() => setStarting(true)} className="underline underline-offset-2 hover:text-foreground">Start a thread</button></p>}
          </Section>

          <Section title="Studio" count={items.length} action={<NewInSpaceMenu spaceId={spaceId} label="New" onCreated={(item) => openItemTab(navigate, item)} />}>
            {items.length
              ? <div className="-mx-2">
                  {items.slice(0, 8).map((item) => <ItemRow key={item.ref} item={item} onOpen={() => openItemTab(navigate, item)} />)}
                  {items.length > 8 ? <button type="button" onClick={() => openItemsTab(navigate)} className="px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline">All {items.length}</button> : null}
                </div>
              : <p className="text-sm text-muted-foreground">No pages, drawings or tables yet. Anything you make here stays in {name}.</p>}
          </Section>

          {overview.data.activity.length ? (
            <Section title="Recent activity">
              <ol className="space-y-3">
                {overview.data.activity.slice(0, 8).map((event) => {
                  const row = rows.find((candidate) => candidate.thread.id === event.threadId);
                  const clickable = row && !row.thread.isLead;
                  return (
                    <li key={event.id} className="flex items-start gap-3">
                      <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", event.kind === "failure" ? "bg-destructive" : event.kind === "blocked" ? "bg-warning-foreground" : "bg-muted-foreground/50")} />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm break-words">{event.summary}</p>
                        {clickable
                          ? <button type="button" onClick={() => open(row)} className="mt-0.5 max-w-full truncate text-xs text-muted-foreground hover:text-foreground hover:underline">{row.title}</button>
                          : <p className="mt-0.5 truncate text-xs text-muted-foreground">{row?.thread.isLead ? "Lead" : event.title}</p>}
                      </div>
                      <Time at={event.at} />
                    </li>
                  );
                })}
              </ol>
            </Section>
          ) : null}

          {idle.length ? (
            <Section title="Idle" count={idle.length} action={idle.length > IDLE_SHOWN ? <button type="button" onClick={() => setShowAllIdle((value) => !value)} className={BAR_BUTTON} aria-expanded={showAllIdle}>{showAllIdle ? "Show fewer" : "Show all"}</button> : null}>
              <div className="-mx-2">{(showAllIdle ? idle : idle.slice(0, IDLE_SHOWN)).map((row) => <ThreadRow key={row.thread.id} row={row} live={live.get(row.thread.id)} onOpen={() => open(row)} />)}</div>
            </Section>
          ) : null}
        </> : null}
      </div>
      {starting && lead.data ? (
        <StartThreadDialog
          spaceId={spaceId}
          name={name}
          defaultProjectId={lead.data.defaultProjectId}
          onStarted={(id) => openThreadTab(navigate, { id, title: "New thread" })}
          onClose={() => setStarting(false)}
        />
      ) : null}
    </div>
  );
}

/** Workbench tab: the status of the thread's Space. */
export function ThreadSpaceOverview({ threadId }: PluginThreadPanelProps) {
  const spaceId = useSpaceOf()(threadId);
  return spaceId ? <SpaceStatus key={spaceId} spaceId={spaceId} /> : <p className="p-4 text-sm text-muted-foreground">This thread isn't in a Space.</p>;
}
