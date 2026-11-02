// The sidebar's Threads section, under Bots: every top-level thread, pinned
// first and then newest (by last activity or creation), in one list of
// two-line rows whose second line names the project, or grouped under project
// headings (the menu beside the heading; kept on this device). The first line
// has the title and, on the right, the age, or in its place what the thread
// needs: a pill (Needs you, Failed), a dot (working, unread) or a pin.
// Sub-threads and hidden threads stay out, and so does every thread the Bots
// section shows (bot_listed_threads). Each row has BB's own thread menu
// (right-click or the hover ⋯) and Archive on hover, with rename in place.
// A row drags onto a Bot in the Bots section to hand the thread to it; a
// row from a Bot's list dropped here takes the thread back (bot_thread_release).
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Icon } from "../../kit/ui/index";
import {
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadActionsMenu as ThreadActionsMenu,
  experimental_useSidebarThreads,
  experimental_useThreadActions,
  ThreadTitle,
  useBbNavigate,
  useSdk,
  useSidebarThreadShortcut,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useMemo, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { useCall, useLive } from "../live";

type Thread = PluginSidebarThread;
/** The drag type of a thread row: its id, dropped on a Bot to hand it over (BotSidebar.tsx). */
export const THREAD_DRAG = "application/x-studio-thread";
/** Set as well on a row from a Bot's list: only those drop on Threads. */
export const BOT_THREAD_DRAG = "application/x-studio-bot-thread";
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

/** How the section orders and groups its rows; kept on this device. */
export interface ThreadsView {
  sort: "activity" | "created";
  group: "none" | "project";
}
const VIEW_KEY = "studio.threads.view";
const DEFAULT_VIEW: ThreadsView = { sort: "activity", group: "none" };

export function readThreadsView(): ThreadsView {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as Partial<ThreadsView> | null;
    return {
      sort: raw?.sort === "created" ? "created" : "activity",
      group: raw?.group === "project" ? "project" : "none",
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

function useThreadsView(): [ThreadsView, (patch: Partial<ThreadsView>) => void] {
  const [view, setView] = useState(readThreadsView);
  const update = (patch: Partial<ThreadsView>) => setView((current) => {
    const next = { ...current, ...patch };
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  return [view, update];
}

/** Rows grouped by project, projects in the order their first row appears. */
export function groupByProject(rows: readonly Thread[]): { projectId: string; threads: Thread[] }[] {
  const groups = new Map<string, Thread[]>();
  for (const thread of rows) {
    const group = groups.get(thread.projectId);
    if (group) group.push(thread);
    else groups.set(thread.projectId, [thread]);
  }
  return [...groups].map(([projectId, threads]) => ({ projectId, threads }));
}

/** The rows the section shows: top-level, visible, unarchived threads the Bots section doesn't, pinned first in pin order, then newest by `sort`. */
export function listedThreads(threads: readonly Thread[], botThreads: ReadonlySet<string> = new Set(), sort: ThreadsView["sort"] = "activity"): Thread[] {
  const shown = threads.filter((thread) => !thread.parentThreadId && !thread.isHidden && !thread.isArchived && !botThreads.has(thread.id));
  const pinned = shown.filter((thread) => thread.isPinned).sort((a, b) => (a.pinSortKey ?? "").localeCompare(b.pinSortKey ?? ""));
  const key = sort === "created" ? (thread: Thread) => thread.createdAt : recency;
  const rest = shown.filter((thread) => !thread.isPinned).sort((a, b) => key(b) - key(a));
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

const PAGE = 10;

export function ThreadsSection({ activeThreadId, onNavigate }: { activeThreadId: string | null; onNavigate(): void }) {
  const state = experimental_useSidebarThreads();
  const navigate = useBbNavigate();
  const open = (threadId: string, split: boolean) => { navigate.toThread(threadId, split ? { split: true } : undefined); onNavigate(); };
  const [limit, setLimit] = useState(PAGE);
  const [closed, setClosed] = useState(false);
  const listed = useLive("bot_listed_threads", {}, { pollMs: 60_000 });
  const botThreads = useMemo(() => new Set(listed.data?.threadIds ?? []), [listed.data]);
  const [view, setView] = useThreadsView();
  const rows = useMemo(() => listedThreads(state.threads, botThreads, view.sort), [state.threads, botThreads, view.sort]);
  const projects = useMemo(() => new Map(state.projects.map((project) => [project.id, project.name])), [state.projects]);
  // A Bot's thread dropped here comes back to the user.
  const call = useCall();
  const [over, setOver] = useState(false);
  const fromBot = (event: DragEvent) => event.dataTransfer.types.includes(BOT_THREAD_DRAG);
  const drop = {
    onDragOver: (event: DragEvent) => { if (!fromBot(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(true); },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); },
    onDrop: (event: DragEvent) => {
      setOver(false);
      const threadId = fromBot(event) ? event.dataTransfer.getData(THREAD_DRAG) : "";
      if (!threadId) return;
      event.preventDefault();
      call("bot_thread_release", { threadId }).then(
        () => toast.success("Moved to your threads"),
        (error: unknown) => toast.error(`Couldn't take it back: ${error instanceof Error ? error.message : String(error)}`),
      );
    },
  };
  return (
    <section aria-label="Threads" data-testid="threads-section" {...drop} data-drop-over={over || undefined}
      className={cn("flex flex-col gap-0.5 rounded-md px-1.5 pb-3", over && "ring-2 ring-inset ring-ring")}>
      <div className="flex h-7 items-center gap-1 pl-2 text-[11px] font-medium text-muted-foreground">
        <button type="button" aria-expanded={!closed} onClick={() => setClosed(!closed)} className="group flex min-w-0 flex-1 items-center gap-1 text-left hover:text-foreground">
          <span className="truncate">Threads</span>
          <Icon name={closed ? "ChevronRight" : "ChevronDown"} className="size-3 opacity-0 group-hover:opacity-100" />
        </button>
        <ViewMenu view={view} onChange={setView} />
      </div>
      {closed ? null : state.status === "loading" && !rows.length ? (
        <p className="px-2 text-xs text-muted-foreground">Loading…</p>
      ) : state.status === "error" && !rows.length ? (
        <p className="px-2 text-xs text-muted-foreground">Couldn't load threads.</p>
      ) : !rows.length ? (
        <p className="px-2 text-xs text-muted-foreground">No threads yet.</p>
      ) : (
        <>
          {view.group === "project"
            ? groupByProject(rows.slice(0, limit)).map((group) => (
              <div key={group.projectId} role="group" aria-label={projects.get(group.projectId) ?? "Project"} className="flex flex-col gap-0.5">
                <p className="truncate px-2 pt-1.5 text-xs font-medium text-muted-foreground">{projects.get(group.projectId) ?? "Project"}</p>
                {group.threads.map((thread) => (
                  <ThreadRow key={thread.id} thread={thread} project={null} active={activeThreadId === thread.id} open={open} />
                ))}
              </div>
            ))
            : rows.slice(0, limit).map((thread) => (
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

const SORTS: { id: ThreadsView["sort"]; label: string }[] = [{ id: "activity", label: "Last activity" }, { id: "created", label: "Created" }];
const GROUPS: { id: ThreadsView["group"]; label: string }[] = [{ id: "none", label: "None" }, { id: "project", label: "Project" }];

/** Sort and group, beside the Threads heading. */
function ViewMenu({ view, onChange }: { view: ThreadsView; onChange(patch: Partial<ThreadsView>): void }) {
  const check = (on: boolean) => <Icon name="Check" className={cn("ml-auto size-3.5", on ? "" : "invisible")} aria-hidden />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Sort and group threads" title="Sort and group"
          className="flex size-6 items-center justify-center rounded-md hover:bg-state-hover hover:text-foreground"><Icon name="ArrowUpDown" className="size-3.5" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        {SORTS.map((sort) => (
          <DropdownMenuItem key={sort.id} aria-checked={view.sort === sort.id} onSelect={() => onChange({ sort: sort.id })}>{sort.label}{check(view.sort === sort.id)}</DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Group by</DropdownMenuLabel>
        {GROUPS.map((group) => (
          <DropdownMenuItem key={group.id} aria-checked={view.group === group.id} onSelect={() => onChange({ group: group.id })}>{group.label}{check(view.group === group.id)}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** BB's thread menu target for a sidebar thread. */
function menuTarget(thread: Thread) {
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment: thread.environment?.id ? { id: thread.environment.id, path: thread.environment.path } : null,
  };
}

function ThreadRow({ thread, project, active, open }: { thread: Thread; project: string | null; active: boolean; open(threadId: string, split: boolean): void }) {
  const shortcut = useSidebarThreadShortcut(thread.id);
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const state = threadState(thread);
  const dot = DOT[state];
  const pill = PILL[state];
  const at = recency(thread);
  const loud = state !== "idle" && state !== "working";
  const target = menuTarget(thread);
  return (
    <ThreadActionsContextMenu thread={target} requestRename={() => setRenaming(true)} disabled={renaming}>
      <a
        href={thread.href}
        data-sidebar-thread-id={thread.id}
        aria-current={active ? "page" : undefined}
        draggable={!renaming}
        onDragStart={(event) => { event.dataTransfer.setData(THREAD_DRAG, thread.id); event.dataTransfer.effectAllowed = "copyMove"; }}
        onClick={(event) => { event.preventDefault(); if (!renaming) open(thread.id, event.metaKey || event.ctrlKey); }}
        onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); open(thread.id, true); } }}
        className={cn("group/thread-row flex min-w-0 flex-col rounded-md py-1 pr-1 pl-2 text-sm", active ? "bg-state-active" : "hover:bg-state-hover")}
      >
        <span className="flex h-5 min-w-0 items-center gap-1.5">
          {renaming ? <RenameInput thread={thread} onDone={() => setRenaming(false)} /> : (
            <span className={cn("min-w-0 flex-1 truncate", loud ? "font-semibold" : state === "idle" && !active ? "text-muted-foreground" : "")}>
              <ThreadTitle threadId={thread.id} />
            </span>
          )}
          {shortcut ? <span aria-hidden className="shrink-0 rounded bg-state-hover px-1 text-[10px] text-muted-foreground">{shortcut.label}</span> : null}
          <span className={cn("shrink-0", menuOpen ? "hidden" : "group-hover/thread-row:hidden")}>
            {pill
              ? <span className={cn("whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-wide", pill.className)}>{pill.label}</span>
              : dot.label
                ? <span role="img" aria-label={dot.label} title={dot.label} className={cn("mr-1 block size-[7px] rounded-full", dot.className)} />
                : thread.isPinned
                  ? <Icon name="Pin" aria-label="Pinned" className="size-3 text-muted-foreground" />
                  : <time dateTime={new Date(at).toISOString()} className="text-[11px] tabular-nums text-muted-foreground">{compactAge(at)}</time>}
          </span>
          <span className={cn("shrink-0 items-center gap-0.5", menuOpen ? "flex" : "hidden group-hover/thread-row:flex max-md:pointer-coarse:flex")}>
            <ArchiveButton thread={target} title={thread.displayTitle} />
            <ThreadActionsMenu
              thread={target}
              requestRename={() => setRenaming(true)}
              onOpenChange={setMenuOpen}
              align="start"
              trigger={(props) => (
                <button type="button" aria-label={`Actions for ${thread.displayTitle}`} {...props} onClick={(event) => { event.preventDefault(); event.stopPropagation(); props.onClick?.(event); }}
                  className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground">
                  <Icon name="MoreHorizontal" className="size-3.5" aria-hidden />
                </button>
              )}
            />
          </span>
        </span>
        {project === null ? null : <span data-thread-project="" className="min-w-0 truncate text-xs leading-4 text-muted-foreground">{project}</span>}
      </a>
    </ThreadActionsContextMenu>
  );
}

const ARCHIVE_KEYS = ["bb--core/archive"];

/** BB's own Archive (with its Undo toast), one click on hover: a sidebar thread, or a Bot's side thread (BotSidebar.tsx). */
export function ArchiveButton({ thread, title }: { thread: ReturnType<typeof menuTarget>; title: string }) {
  const archive = experimental_useThreadActions(thread, { keys: ARCHIVE_KEYS })[0]?.action;
  if (!archive || archive.disabled) return null;
  return (
    <button type="button" aria-label={`${archive.label} ${title}`} title={archive.label}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); void archive.run(); }}
      className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground">
      <Icon name={archive.icon} className="size-3.5" aria-hidden />
    </button>
  );
}

/** Rename in place: a sidebar thread, or a Bot's side thread (BotSidebar.tsx). */
export function RenameInput({ thread, onDone }: { thread: Pick<Thread, "id" | "title" | "displayTitle">; onDone(): void }) {
  const sdk = useSdk();
  const [value, setValue] = useState(thread.title ?? thread.displayTitle);
  const commit = () => {
    const title = value.trim();
    onDone();
    if (!title || title === thread.title) return;
    sdk.threads.update({ threadId: thread.id, title }).catch((error: unknown) => console.warn(`Couldn't rename: ${error instanceof Error ? error.message : String(error)}`));
  };
  return (
    <input
      autoFocus
      aria-label="Thread title"
      value={value}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") commit();
        if (event.key === "Escape") onDone();
      }}
      className="h-5 min-w-0 flex-1 rounded-sm border border-input bg-background px-1 text-sm outline-none focus:border-ring"
    />
  );
}
