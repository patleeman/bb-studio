// A project at a glance, the first workbench tab beside the lead: what needs
// you, what's running, what the project reported lately, and every thread in
// it with sub-threads under their parent. The plan itself lives on the page.
import {
  ThreadChat,
  experimental_useAppPanel as useAppPanel,
  experimental_useFixedTabTarget as useFixedTabTarget,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginNavPanelProps,
  type PluginSidebarThread,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Icon, openAppPath } from "@bb-studio/kit/app";
import type { ReactNode } from "react";
import { inboxLink } from "./links";
import { useCall, useLive, type InboxEvent } from "./model";
import { useProject } from "./ProjectPanel";
import { useWork } from "./projects";
import { useStartThread } from "./StartThread";
import { PROJECTS_PANEL, projectIdOf } from "./routes";
import { RUNNING, ThreadGlyph } from "./Sidebar";
import { plainPreview } from "./text";
import { cn } from "./styles";

const RECENT_UPDATES = 5;

type ThreadTarget = { threadId: string };

/** The workbench tab a thread opens in, beside the project's lead. Plugins can't add closable tabs, so it's one tab, retargeted. */
export const THREAD_TAB = {
  panelId: PROJECTS_PANEL,
  id: "thread",
  experimental_target: {
    validate: (value: unknown): value is ThreadTarget =>
      typeof value === "object" && value !== null && typeof (value as { threadId?: unknown }).threadId === "string",
  },
} as const;

export interface Overview {
  needsYou: PluginSidebarThread[];
  running: PluginSidebarThread[];
  /** Top-level threads, newest first, each with its sub-threads. */
  tree: { thread: PluginSidebarThread; children: PluginSidebarThread[] }[];
  updates: InboxEvent[];
}

export function overviewOf(threads: readonly PluginSidebarThread[], projectId: string, leadId: string | null, events: readonly InboxEvent[], projectOf: (thread: PluginSidebarThread) => string | null = (thread) => thread.projectId): Overview {
  const own = threads.filter((thread) => projectOf(thread) === projectId && !thread.isArchived && !thread.isHidden);
  const ids = new Set(own.map((thread) => thread.id));
  const newest = (a: PluginSidebarThread, b: PluginSidebarThread) => b.updatedAt - a.updatedAt;
  const rest = own.filter((thread) => thread.id !== leadId);
  // A sub-thread of the lead is top-level here: the lead is the page you're on.
  const isRoot = (thread: PluginSidebarThread) => !thread.parentThreadId || thread.parentThreadId === leadId || !ids.has(thread.parentThreadId);
  return {
    needsYou: own.filter((thread) => thread.hasPendingInteraction).sort(newest),
    running: rest.filter((thread) => !thread.hasPendingInteraction && RUNNING.has(thread.runtimeStatus)).sort(newest),
    tree: rest.filter(isRoot).sort(newest).map((thread) => ({ thread, children: rest.filter((child) => child.parentThreadId === thread.id).sort(newest) })),
    updates: events.filter((event) => event.threadId !== null && ids.has(event.threadId)).sort((a, b) => b.createdAt - a.createdAt).slice(0, RECENT_UPDATES),
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

function ThreadLine({ thread, nested, onOpen }: { thread: PluginSidebarThread; nested?: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cn("flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-state-hover", nested && "pl-7")}>
      <span className="inline-flex size-4 shrink-0 items-center justify-center"><ThreadGlyph thread={thread} /></span>
      <span className={cn("min-w-0 flex-1 truncate", thread.isUnread && "font-medium")}>{thread.displayTitle}</span>
    </button>
  );
}

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (60 * 24))}d`;
}

export function ProjectOverview({ projectId, onOpenThread }: { projectId: string; onOpenThread?: (threadId: string) => boolean }) {
  const call = useCall();
  const project = useProject(projectId);
  const { threads } = useSidebarThreads();
  const threadActions = useSidebarThreadActions();
  const inbox = useLive<{ events: InboxEvent[] }>("inbox_list", { spaceId: "all" }, { pollMs: 30_000 });
  const leadId = project.data?.leadThreadId ?? null;
  const work = useWork();
  const startThread = useStartThread();
  const view = overviewOf(threads, projectId, leadId, inbox.data?.events ?? [], work.projectOf);
  const startIn = [work.chief, ...work.projects].find((entry) => entry?.id === projectId)?.bbProjectId ?? null;
  const run = project.data?.run?.enabled ? project.data.run : null;
  const open = (threadId: string) => { if (!onOpenThread?.(threadId)) threadActions.open(threadId); };
  const openEvent = (event: InboxEvent) => {
    const link = inboxLink(event);
    if (!link) return;
    void call("inbox_read", { keys: [event.key] }).catch(() => undefined);
    if (link.kind === "thread") open(link.threadId);
    else openAppPath(link.path);
  };

  return (
    <div className="pb-4">
      {startThread.dialog}
      {run
        ? <p className="flex items-center gap-2 px-4 pt-3 text-xs text-muted-foreground"><Icon name="Repeat" className="size-3.5" />The lead checks in {run.cadence === "hourly" ? "every hour" : run.cadence === "daily" ? "every day" : "on weekdays"} and reports to your Inbox.</p>
        : null}
      {view.needsYou.length
        ? <Section title="Needs you">{view.needsYou.map((thread) => <ThreadLine key={thread.id} thread={thread} onOpen={() => open(thread.id)} />)}</Section>
        : null}
      {view.running.length
        ? <Section title="Running">{view.running.map((thread) => <ThreadLine key={thread.id} thread={thread} onOpen={() => open(thread.id)} />)}</Section>
        : null}
      {view.updates.length
        ? <Section title="Latest updates">
            {view.updates.map((event) => (
              <button key={event.key} type="button" onClick={() => openEvent(event)} className="flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left hover:bg-state-hover">
                <span className="flex w-full items-baseline gap-2">
                  <span className={cn("min-w-0 flex-1 truncate text-sm", event.readAt === null && "font-medium")}>{event.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ago(event.createdAt)}</span>
                </span>
                {event.body ? <span className="line-clamp-2 text-xs text-muted-foreground">{plainPreview(event.body)}</span> : null}
              </button>
            ))}
          </Section>
        : null}
      <Section
        title="Threads"
        action={<button type="button" aria-label="New thread in this project" title="New thread in this project" onClick={() => (work.canOrganize ? startThread.start(projectId) : threadActions.openNewThread({ ...(startIn ? { projectId: startIn } : {}), focusPrompt: true }))} className="inline-flex size-6 items-center justify-center rounded-md hover:bg-state-hover hover:text-foreground"><Icon name="Plus" className="size-4" /></button>}
      >
        {view.tree.map(({ thread, children }) => (
          <div key={thread.id} className="space-y-px">
            <ThreadLine thread={thread} onOpen={() => open(thread.id)} />
            {children.map((child) => <ThreadLine key={child.id} thread={child} nested onOpen={() => open(child.id)} />)}
          </div>
        ))}
        {!view.tree.length ? <p className="px-2 py-2 text-xs text-muted-foreground">No other threads yet. The lead starts them as the work needs, or start one with +.</p> : null}
      </Section>
    </div>
  );
}

/** Workbench tab beside the project view. Threads open in the Thread tab next to it. */
export function ProjectOverviewTab({ subPath }: PluginNavPanelProps) {
  const projectId = projectIdOf(subPath);
  const panel = useAppPanel();
  const openInTab = (threadId: string) => panel.openFixedTab({ surface: { kind: "current" }, tab: THREAD_TAB, target: { threadId } });
  return projectId ? <ProjectOverview projectId={projectId} onOpenThread={openInTab} /> : <p className="p-4 text-sm text-muted-foreground">Open a project to see its overview.</p>;
}

/** Workbench tab: the thread last opened from the Overview, beside the lead. */
export function ProjectThreadTab(_props: PluginNavPanelProps) {
  const target = useFixedTabTarget(THREAD_TAB);
  const threadActions = useSidebarThreadActions();
  const threadId = target?.target.threadId;
  if (!threadId) return <p className="p-4 text-sm text-muted-foreground">Open a thread from the Overview and it shows here, beside the lead.</p>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-end gap-1 border-b border-border px-2">
        <button type="button" onClick={() => threadActions.open(threadId)} title="Open full size" aria-label="Open full size" className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"><Icon name="Maximize2" className="size-4" /></button>
      </div>
      <ThreadChat key={threadId} threadId={threadId} variant="full" layout="contained" permissionPolicy="inherit" className="min-h-0 flex-1" />
    </div>
  );
}

/** Thread panel: the overview of the thread's project, from any of its threads. */
export function ThreadProjectOverview({ threadId }: PluginThreadPanelProps) {
  const { threads } = useSidebarThreads();
  const { projectOf } = useWork();
  const thread = threads.find((entry) => entry.id === threadId);
  const projectId = thread ? projectOf(thread) : null;
  return projectId ? <ProjectOverview projectId={projectId} /> : null;
}
