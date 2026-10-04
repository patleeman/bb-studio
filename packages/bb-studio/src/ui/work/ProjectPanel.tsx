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
import * as Menu from "@radix-ui/react-dropdown-menu";
import { GHOST_BUTTON, Icon, OUTLINE_BUTTON, PageColumn, floatWindowKey, openAppPath, publishFloatBody, type FloatTarget } from "@bb-studio/kit/app";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCall, useLive } from "./model";
import { useWork } from "./projects";
import { useStartThread } from "./StartThread";
import { PROJECTS_PANEL, projectIdOf } from "./routes";
import { ThreadGlyph } from "./Sidebar";
import { Face } from "./Face";
import { HandoffDialog } from "./Handoff";
import { MENU, MENU_ITEM, PORTAL_SCOPE, cn } from "./styles";

export type Cadence = "hourly" | "daily" | "weekdays";

export interface ProjectInfo {
  projectId: string;
  name: string;
  /** The Personal project's lead is the Chief of Staff. */
  role?: "chief-of-staff" | "project";
  leadThreadId: string | null;
  pageId: string | null;
  pageHref: string | null;
  /** Run mode: the lead keeps going on a heartbeat and reports to the Inbox. */
  run?: { enabled: boolean; cadence: Cadence; time?: string | null } | null;
}

interface BotSummary {
  id: string;
  name: string;
  avatar: string | null;
  providerId: string;
  mission: string | null;
  hasMemory: boolean;
  schedules: number;
  suggestion: "project" | "chief-of-staff" | "retire";
}

export function useProject(projectId: string | null) {
  return useLive<ProjectInfo>("project_get", { projectId }, { enabled: projectId !== null, pollMs: 0 });
}

/** The Projects panel: the list at its root, a project at `<projectId>`. */
export function ProjectPanel({ subPath }: PluginNavPanelProps) {
  const projectId = projectIdOf(subPath);
  return projectId ? <ProjectView key={projectId} projectId={projectId} /> : <ProjectList />;
}

const SUGGESTIONS: Record<BotSummary["suggestion"], string> = {
  project: "Make it a project",
  "chief-of-staff": "Merge into Chief of Staff",
  retire: "Retire",
};

/** Bots are being folded in: each becomes a project's lead, joins the Chief of Staff, or retires. */
function BotsToFold() {
  const call = useCall();
  const navigate = useBbNavigate();
  const bots = useLive<{ bots: BotSummary[] }>("bots_overview", {}, { pollMs: 0 });
  const personalId = useWork().chief?.id ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = bots.data?.bots ?? [];
  if (!list.length) return null;
  const act = async (bot: BotSummary, choice: BotSummary["suggestion"]) => {
    setBusy(bot.id); setError(null);
    try {
      if (choice === "retire") {
        if (!confirm(`Retire ${bot.name}? Its threads and history stay.`)) return;
        await call("bot_retire", { botId: bot.id });
      } else {
        const project = await call("bot_to_project", { botId: bot.id, ...(choice === "chief-of-staff" && personalId ? { projectId: personalId } : {}) }) as ProjectInfo;
        navigate.toPluginPanel(PROJECTS_PANEL, { subPath: project.projectId });
      }
      bots.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium">Your bots</h2>
      <p className="mt-1 text-sm text-muted-foreground">Bots become projects: the bot's mission and memory go on the project's page, its chat becomes the lead, and its schedules keep it running.</p>
      {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
      <ul className="mt-3 divide-y divide-border">
        {list.map((bot) => (
          <li key={bot.id} className="flex items-center gap-3 py-2.5">
            <Face name={bot.name} avatar={bot.avatar} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{bot.name}</div>
              <div className="truncate text-xs text-muted-foreground">{[bot.mission, bot.hasMemory ? "has memory" : null, bot.schedules ? `${bot.schedules} schedule${bot.schedules === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "No mission yet"}</div>
            </div>
            <button type="button" disabled={busy === bot.id} onClick={() => void act(bot, bot.suggestion)} className={OUTLINE_BUTTON}>{SUGGESTIONS[bot.suggestion]}</button>
            {bot.suggestion !== "retire"
              ? <button type="button" disabled={busy === bot.id} onClick={() => void act(bot, "retire")} className={GHOST_BUTTON}>Retire</button>
              : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProjectList() {
  const { threads } = useSidebarThreads();
  const navigate = useBbNavigate();
  const { projects: work, projectOf } = useWork();
  return (
    <PageColumn className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <p className="mt-1 text-sm text-muted-foreground">Each project has a lead you talk to, and a page it keeps current. Ask the Chief of Staff to start one, or make one from BB's project menu.</p>
      <div className="mt-6 space-y-1">
        {work.map((project) => {
          const count = threads.filter((thread) => projectOf(thread) === project.id && !thread.isArchived && !thread.isHidden).length;
          return (
            <button key={project.id} type="button" onClick={() => navigate.toPluginPanel(PROJECTS_PANEL, { subPath: project.id })} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-state-hover">
              <Icon name="Folder" className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate font-medium">{project.name}</span>
              <span className="text-xs text-muted-foreground">{count} {count === 1 ? "thread" : "threads"}</span>
            </button>
          );
        })}
      </div>
      <BotsToFold />
    </PageColumn>
  );
}

const RUN_LABELS: Record<Cadence, string> = { hourly: "Hourly", daily: "Daily", weekdays: "Weekdays" };

/** Off, or a heartbeat: the lead checks the project on a cadence and reports to the Inbox. */
function RunMenu({ project, onChanged }: { project: ProjectInfo; onChanged: () => void }) {
  const call = useCall();
  const run = project.run?.enabled ? project.run : null;
  const set = (cadence: Cadence | null) => {
    void call("project_set_run", { projectId: project.projectId, enabled: cadence !== null, cadence: cadence ?? run?.cadence ?? "daily" }).then(onChanged, onChanged);
  };
  return (
    <Menu.Root>
      <Menu.Trigger className={GHOST_BUTTON} title="Keep this project running on a heartbeat">
        <Icon name={run ? "Repeat" : "Pause"} className="size-4" />{run ? `Runs ${RUN_LABELS[run.cadence].toLowerCase()}` : "Keep running"}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content {...PORTAL_SCOPE} align="end" className={MENU}>
          <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">The lead checks in on its own and reports to your Inbox.</p>
          <Menu.RadioGroup value={run?.cadence ?? "off"} onValueChange={(value) => set(value === "off" ? null : value as Cadence)}>
            {(["off", "hourly", "daily", "weekdays"] as const).map((value) => (
              <Menu.RadioItem key={value} value={value} className={MENU_ITEM}>
                <span className="inline-flex size-3.5 items-center justify-center"><Menu.ItemIndicator><Icon name="Check" /></Menu.ItemIndicator></span>
                {value === "off" ? "Off" : RUN_LABELS[value]}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ProjectView({ projectId }: { projectId: string }) {
  const call = useCall();
  const project = useProject(projectId);
  const { projects } = useSidebarThreads();
  const work = useWork();
  const startThread = useStartThread();
  const threadActions = useSidebarThreadActions();
  const [error, setError] = useState<string | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  const studio = work.chief?.id === projectId ? work.chief : work.projects.find((entry) => entry.id === projectId);
  const chief = project.data?.role === "chief-of-staff" || studio?.role === "chief-of-staff";
  const name = chief ? "Chief of Staff" : project.data?.name ?? studio?.name ?? "Project";
  // Threads start in the project's folder (a BB project), or in Personal.
  const bbProject = projects.find((entry) => entry.id === studio?.bbProjectId) ?? null;
  const startIn = bbProject?.id ?? projects.find((entry) => entry.isPersonal)?.id ?? projectId;
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
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-4">
        <Icon name={chief ? "Bot" : "FolderOpen"} className="mr-1 size-4 text-muted-foreground" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h1>
        {project.data && leadThreadId ? <RunMenu project={project.data} onChanged={project.refresh} /> : null}
        {leadThreadId
          ? <button type="button" onClick={() => setHandingOff(true)} title="Hand the lead to another agent" className={GHOST_BUTTON}><Icon name="Fork" className="size-4" />Hand off</button>
          : null}
        <button type="button" onClick={() => (work.canOrganize ? startThread.start(projectId) : threadActions.openNewThread({ projectId: startIn, focusPrompt: true }))} className={GHOST_BUTTON}>
          <Icon name="MessageSquarePlus" className="size-4" />New thread
        </button>
        {bbProject && !bbProject.isPersonal && !chief ? <button type="button" aria-label="Folder settings" title="Folder settings" onClick={() => openAppPath(bbProject.settingsHref)} className={GHOST_BUTTON}><Icon name="Settings" className="size-4" /></button> : null}
      </header>
      {startThread.dialog}
      {leadThreadId
        ? <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 pb-4">
            {/* "inherit": send with the lead thread's own permission, not the composer's default. */}
            <ThreadChat key={leadThreadId} threadId={leadThreadId} variant="full" layout="contained" permissionPolicy="inherit" className="min-h-0 flex-1" />
            <HandoffDialog threadId={leadThreadId} projectId={startIn} open={handingOff} onOpenChange={setHandingOff} onDone={() => project.refresh()} />
          </div>
        : project.loading
          ? null
          : <div className="mx-auto w-full max-w-2xl px-6 pt-16">
              <h2 className="text-xl font-semibold">{chief ? "Meet your Chief of Staff" : `Start ${name}`}</h2>
              <p className="mt-1 mb-5 text-sm text-muted-foreground">
                {chief
                  ? "It takes your one-offs, starts and staffs projects, and hands work to their leads. Tell it what you want handled."
                  : "Tell the lead what this project is about. It writes the project's page and gets going; you talk to it here."}
              </p>
              <NewThreadComposer defaultProjectId={startIn} placeholder={chief ? "What should I take care of?" : "What's this project about?"} draftKey={`project-lead:${projectId}`} onSubmit={start} />
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
export function PageEmbed({ pageId }: { pageId: string }) {
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
