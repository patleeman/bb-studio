// The sidebar's Threads section, under Bots: every top-level thread in one
// list, pinned first and then newest, as two-line rows. The first line has the
// status dot, title and age (or a pill when the thread waits on the user); the
// second names the project, so there are no per-project sections. Sub-threads
// and hidden threads (a Bot's earlier conversations) stay out; a Bot's own
// threads also show under it in the Bots section.
import { cn, Icon } from "@bb-studio/kit/ui";
import {
  experimental_useSidebarThreads,
  ThreadTitle,
  useBbNavigate,
  useSidebarThreadShortcut,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useMemo, useState } from "react";

type Thread = PluginSidebarThread;
export type ThreadState = "needs-you" | "working" | "error" | "unread" | "idle";

const BUSY = new Set(["starting", "active", "stopping", "provisioning"]);

/** What a thread asks of the user, most urgent first. */
export function threadState(thread: Pick<Thread, "status" | "runtimeStatus" | "indicator" | "hasPendingInteraction" | "isUnread">): ThreadState {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "needs-you";
  if (BUSY.has(thread.status) || BUSY.has(thread.runtimeStatus) || thread.indicator === "runtime") return "working";
  if (thread.indicator === "unread-error") return "error";
  if (thread.indicator === "unread-success" || thread.isUnread) return "unread";
  return "idle";
}

const recency = (thread: Thread) => Math.max(thread.updatedAt, thread.latestAttentionAt);

/** The rows the section shows: top-level, visible, unarchived threads, pinned first in pin order, then newest. */
export function listedThreads(threads: readonly Thread[]): Thread[] {
  const shown = threads.filter((thread) => !thread.parentThreadId && !thread.isHidden && !thread.isArchived);
  const pinned = shown.filter((thread) => thread.isPinned).sort((a, b) => (a.pinSortKey ?? "").localeCompare(b.pinSortKey ?? ""));
  const rest = shown.filter((thread) => !thread.isPinned).sort((a, b) => recency(b) - recency(a));
  return [...pinned, ...rest];
}

/** "now", "5m", "3h", "2d", "4w". */
export function compactAge(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 1440)}d`;
  return `${Math.round(minutes / 10080)}w`;
}

const DOT: Record<ThreadState, { className: string; label: string | null }> = {
  "needs-you": { className: "bg-warning ring-[3px] ring-warning/30", label: "Needs you" },
  working: { className: "bg-success ring-[3px] ring-success/20", label: "Working" },
  error: { className: "bg-destructive ring-[3px] ring-destructive/30", label: "Unread error" },
  unread: { className: "bg-blue-500 ring-[3px] ring-blue-500/30", label: "Unread result" },
  // A read, idle thread has no dot, so a thread that wants you stands out.
  idle: { className: "invisible", label: null },
};
const PILL: Partial<Record<ThreadState, { className: string; label: string }>> = {
  "needs-you": { className: "bg-warning text-neutral-950", label: "Needs you" },
  error: { className: "bg-destructive text-white", label: "Failed" },
};

const PAGE = 40;

export function ThreadsSection({ activeThreadId, onNavigate }: { activeThreadId: string | null; onNavigate(): void }) {
  const state = experimental_useSidebarThreads();
  const navigate = useBbNavigate();
  const open = (threadId: string, split: boolean) => { navigate.toThread(threadId, split ? { split: true } : undefined); onNavigate(); };
  const [limit, setLimit] = useState(PAGE);
  const [closed, setClosed] = useState(false);
  const rows = useMemo(() => listedThreads(state.threads), [state.threads]);
  const projects = useMemo(() => new Map(state.projects.map((project) => [project.id, project.name])), [state.projects]);
  return (
    <section aria-label="Threads" data-testid="threads-section" className="flex flex-col gap-0.5 px-1.5 pb-3">
      <div className="flex h-7 items-center gap-1 pl-2 text-[11px] font-medium text-muted-foreground">
        <button type="button" aria-expanded={!closed} onClick={() => setClosed(!closed)} className="group flex min-w-0 flex-1 items-center gap-1 text-left hover:text-foreground">
          <span className="truncate">Threads</span>
          <Icon name={closed ? "ChevronRight" : "ChevronDown"} className="size-3 opacity-0 group-hover:opacity-100" />
        </button>
        <button type="button" aria-label="New thread" title="New thread" onClick={() => { navigate.toCompose(); onNavigate(); }}
          className="flex size-6 items-center justify-center rounded-md hover:bg-state-hover hover:text-foreground"><Icon name="Plus" className="size-3.5" /></button>
      </div>
      {closed ? null : state.status === "loading" && !rows.length ? (
        <p className="px-2 text-xs text-muted-foreground">Loading…</p>
      ) : state.status === "error" && !rows.length ? (
        <p className="px-2 text-xs text-muted-foreground">Couldn't load threads.</p>
      ) : !rows.length ? (
        <p className="px-2 text-xs text-muted-foreground">No threads yet.</p>
      ) : (
        <>
          {rows.slice(0, limit).map((thread) => (
            <ThreadRow key={thread.id} thread={thread} project={projects.get(thread.projectId) ?? null} active={activeThreadId === thread.id} open={open} />
          ))}
          {rows.length > limit ? (
            <button type="button" onClick={() => setLimit(limit + PAGE)} className="h-7 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground">
              Show more
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function ThreadRow({ thread, project, active, open }: { thread: Thread; project: string | null; active: boolean; open(threadId: string, split: boolean): void }) {
  const shortcut = useSidebarThreadShortcut(thread.id);
  const state = threadState(thread);
  const dot = DOT[state];
  const pill = PILL[state];
  const at = recency(thread);
  const loud = state !== "idle" && state !== "working";
  return (
    <a
      href={thread.href}
      data-sidebar-thread-id={thread.id}
      aria-current={active ? "page" : undefined}
      onClick={(event) => { event.preventDefault(); open(thread.id, event.metaKey || event.ctrlKey); }}
      onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); open(thread.id, true); } }}
      className={cn("flex min-w-0 flex-col rounded-md py-1 pr-2 pl-1 text-sm", active ? "bg-state-active" : "hover:bg-state-hover")}
    >
      <span className="flex h-5 min-w-0 items-center gap-1.5">
        {thread.isPinned && state === "idle"
          ? <Icon name="Pin" aria-label="Pinned" className="mx-[1.5px] size-3 shrink-0 text-muted-foreground" />
          : <span role={dot.label ? "img" : undefined} aria-label={dot.label ?? undefined} aria-hidden={dot.label ? undefined : true} title={dot.label ?? undefined}
              className={cn("mx-[4.5px] size-[7px] shrink-0 rounded-full", dot.className)} />}
        <span className={cn("min-w-0 flex-1 truncate", loud ? "font-semibold" : state === "idle" && !active ? "text-muted-foreground" : "")}>
          <ThreadTitle threadId={thread.id} />
        </span>
        {shortcut ? <span aria-hidden className="shrink-0 rounded bg-state-hover px-1 text-[10px] text-muted-foreground">{shortcut.label}</span> : null}
        {pill
          ? <span className={cn("shrink-0 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-wide", pill.className)}>{pill.label}</span>
          : <time dateTime={new Date(at).toISOString()} className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{compactAge(at)}</time>}
      </span>
      <span data-thread-project="" className="min-w-0 truncate pl-[22px] text-xs leading-4 text-muted-foreground">{project ?? " "}</span>
    </a>
  );
}
