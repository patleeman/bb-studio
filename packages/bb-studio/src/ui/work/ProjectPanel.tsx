// A project: talk to its lead in the middle, with the project's page in the
// workbench beside it (docs/work-model: pg_7fe6aafc7a1c7c05). The lead owns
// the project: it keeps the page current and starts sub-threads. A project
// with no lead yet starts one from BB's own composer: what you write is what
// the project is about.
import {
  ThreadChat,
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  type NewThreadRequest,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { GHOST_BUTTON, Icon, PageColumn, floatWindowKey, openAppPath, publishFloatBody, type FloatTarget } from "@bb-studio/kit/app";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCall, useLive } from "./model";
import { PROJECTS_PANEL, projectIdOf } from "./routes";
import { ThreadGlyph } from "./Sidebar";
import { cn } from "./styles";

export interface ProjectInfo {
  projectId: string;
  name: string;
  leadThreadId: string | null;
  pageId: string | null;
  pageHref: string | null;
}

export function useProject(projectId: string | null) {
  return useLive<ProjectInfo>("project_get", { projectId }, { enabled: projectId !== null, pollMs: 0 });
}

/** The Projects panel: the list at its root, a project at `<projectId>`. */
export function ProjectPanel({ subPath }: PluginNavPanelProps) {
  const projectId = projectIdOf(subPath);
  return projectId ? <ProjectView key={projectId} projectId={projectId} /> : <ProjectList />;
}

function ProjectList() {
  const { projects, threads } = useSidebarThreads();
  const navigate = useBbNavigate();
  const work = projects.filter((project) => !project.isPersonal);
  return (
    <PageColumn className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <p className="mt-1 text-sm text-muted-foreground">Each project has a lead you talk to, and a page it keeps current. Make a new project from BB's project menu.</p>
      <div className="mt-6 space-y-1">
        {work.map((project) => {
          const count = threads.filter((thread) => thread.projectId === project.id && !thread.isArchived && !thread.isHidden).length;
          return (
            <button key={project.id} type="button" onClick={() => navigate.toPluginPanel(PROJECTS_PANEL, { subPath: project.id })} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-state-hover">
              <Icon name="Folder" className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate font-medium">{project.name}</span>
              <span className="text-xs text-muted-foreground">{count} {count === 1 ? "thread" : "threads"}</span>
            </button>
          );
        })}
      </div>
    </PageColumn>
  );
}

function ProjectView({ projectId }: { projectId: string }) {
  const call = useCall();
  const project = useProject(projectId);
  const { projects } = useSidebarThreads();
  const threadActions = useSidebarThreadActions();
  const [error, setError] = useState<string | null>(null);
  const bbProject = projects.find((entry) => entry.id === projectId);
  const name = project.data?.name ?? bbProject?.name ?? "Project";
  const leadThreadId = project.data?.leadThreadId ?? null;

  const start = async (request: NewThreadRequest) => {
    setError(null);
    try {
      await call("project_setup", { projectId, request });
      project.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <Icon name="FolderOpen" className="size-4 text-muted-foreground" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h1>
        <button type="button" onClick={() => threadActions.openNewThread({ projectId, focusPrompt: true })} className={GHOST_BUTTON}>
          <Icon name="MessageSquarePlus" className="size-4" />New thread
        </button>
        {bbProject ? <button type="button" aria-label="Project settings" title="Project settings" onClick={() => openAppPath(bbProject.settingsHref)} className={GHOST_BUTTON}><Icon name="Settings" className="size-4" /></button> : null}
      </header>
      {leadThreadId
        ? <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 pb-4">
            {/* "inherit": send with the lead thread's own permission, not the composer's default. */}
            <ThreadChat key={leadThreadId} threadId={leadThreadId} variant="full" layout="contained" permissionPolicy="inherit" className="min-h-0 flex-1" />
          </div>
        : project.loading
          ? null
          : <div className="mx-auto w-full max-w-2xl px-6 pt-16">
              <h2 className="text-xl font-semibold">Start {name}</h2>
              <p className="mt-1 mb-5 text-sm text-muted-foreground">Tell the lead what this project is about. It writes the project's page and gets going; you talk to it here.</p>
              <NewThreadComposer defaultProjectId={projectId} placeholder="What's this project about?" draftKey={`project-lead:${projectId}`} onSubmit={start} />
              {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
            </div>}
    </div>
  );
}

/**
 * The real Pages editor, inside our workbench tab: Pages draws any page whose
 * path is published as a float body (kit/float-registry), the same way it
 * draws into Float windows.
 */
function PageEmbed({ pageId }: { pageId: string }) {
  const element = useRef<HTMLDivElement>(null);
  const target = useMemo<FloatTarget>(() => ({ kind: "path", path: `/plugins/pages/pages/${encodeURIComponent(pageId)}` }), [pageId]);
  useLayoutEffect(() => {
    if (!element.current) return;
    const windowKey = floatWindowKey(target);
    publishFloatBody({ windowKey, target, element: element.current, placement: "workbench" });
    return () => publishFloatBody({ windowKey, element: null });
  }, [target]);
  return <div ref={element} className="h-full min-h-0 overflow-auto" />;
}

/** Workbench tab: the project's page, editable beside the chat. */
export function ProjectPageTab({ subPath }: PluginNavPanelProps) {
  const projectId = projectIdOf(subPath);
  const project = useProject(projectId);
  if (!projectId) return <p className="p-4 text-sm text-muted-foreground">Open a project to see its page.</p>;
  const pageId = project.data?.pageId;
  if (pageId) return <PageEmbed pageId={pageId} />;
  return project.loading ? null : <p className="p-4 text-sm text-muted-foreground">The project's page appears here once you start its lead.</p>;
}

/** Workbench tab: the project's threads, and a way to start another. */
export function ProjectThreadsTab({ subPath }: PluginNavPanelProps) {
  const projectId = projectIdOf(subPath);
  const project = useProject(projectId);
  const { threads } = useSidebarThreads();
  const threadActions = useSidebarThreadActions();
  if (!projectId) return null;
  const leadId = project.data?.leadThreadId;
  const own = threads
    .filter((thread) => thread.projectId === projectId && !thread.isArchived && !thread.isHidden && thread.id !== leadId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="space-y-px p-2">
      <button type="button" onClick={() => threadActions.openNewThread({ projectId, focusPrompt: true })} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground">
        <Icon name="Plus" className="size-4" />New thread in this project
      </button>
      {own.map((thread) => (
        <button key={thread.id} type="button" onClick={() => threadActions.open(thread.id)} className={cn("flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-state-hover", thread.parentThreadId && "pl-6")}>
          <span className="inline-flex size-4 shrink-0 items-center justify-center"><ThreadGlyph thread={thread} /></span>
          <span className={cn("min-w-0 flex-1 truncate", thread.isUnread && "font-medium")}>{thread.displayTitle}</span>
        </button>
      ))}
      {!own.length ? <p className="px-2 py-2 text-xs text-muted-foreground">No other threads yet. The lead starts them as the work needs, or start one here.</p> : null}
    </div>
  );
}
