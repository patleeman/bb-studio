// The sidebar's list: Projects, then Threads. A project is one row; opening it
// shows its lead and its page (ProjectPanel), so nothing inside a project is
// listed here. Threads are the one-offs: your Personal project's threads.
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  type PluginSidebarProject,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb-studio/kit/app";
import { useMemo, useState, type ReactNode } from "react";
import { usePathname } from "./location";
import { projectPath, PROJECTS_PANEL } from "./routes";
import { ThreadMenu } from "./ThreadMenu";
import { ROW, ROW_ACTIVE, ROW_GLYPH, ROW_LABEL, SECTION, SECTION_ACTION, cn } from "./styles";

const RUNNING = new Set(["running", "starting", "active"]);
const THREADS_SHOWN = 25;

/** A thread's state where BB draws it: needs you, running, unread, or nothing. */
export function ThreadGlyph({ thread }: { thread: PluginSidebarThread }) {
  if (thread.hasPendingInteraction) return <span aria-label="Needs you" className="size-2 rounded-full bg-warning-foreground" />;
  if (RUNNING.has(thread.runtimeStatus)) return <span aria-label="Running" className="size-3 rounded-full border-[1.5px] border-muted-foreground/60 border-r-transparent motion-safe:animate-spin" />;
  if (thread.isUnread) return <span aria-label="Unread" className="size-1.5 rounded-full bg-foreground" />;
  return <span aria-hidden className="size-1 rounded-full bg-muted-foreground/30" />;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-3 first:mt-1">
      <h2 className={SECTION}>{title}{action}</h2>
      <div className="space-y-px">{children}</div>
    </section>
  );
}

function ProjectRow({ project, threads, active, onOpen }: { project: PluginSidebarProject; threads: readonly PluginSidebarThread[]; active: boolean; onOpen: () => void }) {
  const needsYou = threads.some((thread) => thread.hasPendingInteraction);
  const running = threads.some((thread) => RUNNING.has(thread.runtimeStatus));
  return (
    <button type="button" onClick={onOpen} aria-current={active ? "page" : undefined} className={cn(ROW, active && ROW_ACTIVE)}>
      <span className={ROW_GLYPH}><Icon name={active ? "FolderOpen" : "Folder"} /></span>
      <span className={ROW_LABEL}>{project.name}</span>
      {needsYou
        ? <span aria-label="Needs you" className="size-2 shrink-0 rounded-full bg-warning-foreground" />
        : running
          ? <span aria-label="Running" className="size-3 shrink-0 rounded-full border-[1.5px] border-muted-foreground/60 border-r-transparent motion-safe:animate-spin" />
          : null}
    </button>
  );
}

function ThreadRow({ thread, active, onOpen }: { thread: PluginSidebarThread; active: boolean; onOpen: () => void }) {
  return (
    <ThreadMenu thread={thread}>
      {(editor) => editor ?? (
        <button type="button" onClick={onOpen} aria-current={active ? "page" : undefined} className={cn(ROW, active && ROW_ACTIVE, "group-hover/thread:pr-8")}>
          <span className={ROW_GLYPH}><ThreadGlyph thread={thread} /></span>
          <span className={cn(ROW_LABEL, thread.isUnread && "font-medium")}>{thread.displayTitle}</span>
        </button>
      )}
    </ThreadMenu>
  );
}

const visible = (thread: PluginSidebarThread) => !thread.isArchived && !thread.isHidden && !thread.parentThreadId;

export function Sidebar({ activeThreadId, onNavigate }: PluginThreadListProps) {
  const { threads, projects } = useSidebarThreads();
  const threadActions = useSidebarThreadActions();
  const navigate = useBbNavigate();
  const pathname = usePathname();
  const [showAll, setShowAll] = useState(false);

  const byProject = useMemo(() => {
    const map = new Map<string, PluginSidebarThread[]>();
    for (const thread of threads) if (visible(thread)) map.set(thread.projectId, [...(map.get(thread.projectId) ?? []), thread]);
    return map;
  }, [threads]);
  const latest = (projectId: string) => Math.max(0, ...(byProject.get(projectId) ?? []).map((thread) => thread.updatedAt));
  const work = projects.filter((project) => !project.isPersonal).sort((a, b) => latest(b.id) - latest(a.id) || a.name.localeCompare(b.name));
  const personal = projects.find((project) => project.isPersonal);
  const oneOffs = [...(personal ? byProject.get(personal.id) ?? [] : [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const shown = showAll ? oneOffs : oneOffs.slice(0, THREADS_SHOWN);
  const activeProject = threads.find((thread) => thread.id === activeThreadId)?.projectId ?? null;

  const openProject = (projectId: string) => { navigate.toPluginPanel(PROJECTS_PANEL, { subPath: projectId }); onNavigate(); };
  const openThread = (threadId: string) => { threadActions.open(threadId); onNavigate(); };

  return (
    <div className="flex flex-col px-2 pb-6">
      <Section title="Projects">
        {work.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            threads={byProject.get(project.id) ?? []}
            // On the project's page, or in one of its threads.
            active={pathname === projectPath(project.id) || activeProject === project.id}
            onOpen={() => openProject(project.id)}
          />
        ))}
        {!work.length ? <p className="px-2 py-1 text-xs text-muted-foreground">No projects yet.</p> : null}
      </Section>
      <Section
        title="Threads"
        action={<button type="button" aria-label="New thread" title="New thread" onClick={() => { threadActions.openNewThread({ ...(personal ? { projectId: personal.id } : {}), focusPrompt: true }); onNavigate(); }} className={SECTION_ACTION}><Icon name="Plus" /></button>}
      >
        {shown.map((thread) => <ThreadRow key={thread.id} thread={thread} active={thread.id === activeThreadId} onOpen={() => openThread(thread.id)} />)}
        {oneOffs.length > THREADS_SHOWN
          ? <button type="button" onClick={() => setShowAll(!showAll)} className={cn(ROW, "text-muted-foreground")}>{showAll ? "Show less" : `Show ${oneOffs.length - THREADS_SHOWN} more`}</button>
          : null}
      </Section>
    </div>
  );
}
