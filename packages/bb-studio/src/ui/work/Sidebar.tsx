// The sidebar's list, under BB's navigation: the Chief of Staff, Projects,
// Pinned, then Threads (everything not in a project). Projects are Studio's
// own (projects.ts); opening one shows its lead and page (ProjectPanel).
//
// It follows BB's own list: ⋯ and right-click menus in BB's order, a header
// menu to sort, drag to reorder projects, drop on Pinned to pin. Beyond BB:
// drag threads onto a project to move them there (or onto Threads to take
// them out), and shift-click to select several for one action.
import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { GHOST_BUTTON, Icon, PRIMARY_BUTTON, openAppPath } from "@bb-studio/kit/app";
import { useEffect, useMemo, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "./location";
import { useCall } from "./model";
import { useProject } from "./ProjectPanel";
import { extendSelection, nest, reorderNeighbours, sortThreads, useMoveThreads, useWork, type ThreadSort, type WorkProject } from "./projects";
import { projectPath, PROJECTS_PANEL } from "./routes";
import { useStartThread } from "./StartThread";
import { MenuBody, RowMenu, ThreadMenu, type MenuEntry, type MoveTarget } from "./ThreadMenu";
import { MENU, PORTAL_SCOPE, ROW, ROW_ACTIVE, ROW_GLYPH, ROW_LABEL, SECTION, SECTION_ACTION, cn } from "./styles";

export const RUNNING = new Set(["running", "starting", "active"]);
const THREADS_SHOWN = 25;
export const THREADS_MIME = "application/x-studio-threads";
const PROJECT_MIME = "application/x-studio-project";
const SORT_KEY = "bb-studio.work.thread-sort";

/** A thread's state where BB draws it: needs you, running, unread, or nothing. */
export function ThreadGlyph({ thread }: { thread: PluginSidebarThread }) {
  if (thread.hasPendingInteraction) return <span aria-label="Needs you" className="size-2 rounded-full bg-warning-foreground" />;
  if (RUNNING.has(thread.runtimeStatus)) return <span aria-label="Running" className="size-3 rounded-full border-[1.5px] border-muted-foreground/60 border-r-transparent motion-safe:animate-spin" />;
  if (thread.isUnread) return <span aria-label="Unread" className="size-1.5 rounded-full bg-foreground" />;
  return <span aria-hidden className="size-1 rounded-full bg-muted-foreground/30" />;
}

function StatusMark({ threads }: { threads: readonly PluginSidebarThread[] }) {
  if (threads.some((thread) => thread.hasPendingInteraction)) return <span aria-label="Needs you" className="size-2 shrink-0 rounded-full bg-warning-foreground" />;
  if (threads.some((thread) => RUNNING.has(thread.runtimeStatus))) return <span aria-label="Running" className="size-3 shrink-0 rounded-full border-[1.5px] border-muted-foreground/60 border-r-transparent motion-safe:animate-spin" />;
  return null;
}

function readSort(): ThreadSort {
  try { return { by: "updated", desc: true, ...JSON.parse(globalThis.localStorage?.getItem(SORT_KEY) ?? "{}") as Partial<ThreadSort> }; } catch { return { by: "updated", desc: true }; }
}

/** Drop target state: highlights while something droppable is over it. */
function useDrop(accepts: (types: readonly string[]) => boolean, onDrop: (data: DataTransfer) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (event: DragEvent) => { if (accepts(event.dataTransfer.types)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(true); } },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent) => { setOver(false); if (accepts(event.dataTransfer.types)) { event.preventDefault(); event.stopPropagation(); onDrop(event.dataTransfer); } },
    },
  };
}
type Drop = ReturnType<typeof useDrop>;

const draggedThreads = (data: DataTransfer): string[] => { try { return JSON.parse(data.getData(THREADS_MIME)) as string[]; } catch { return []; } };

function Section({ title, menu, action, drop, children }: { title: string; menu?: MenuEntry[][]; action?: ReactNode; drop?: Drop; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-3 first:mt-1" {...drop?.props}>
      <h2 className={cn(SECTION, drop?.over && "rounded-md bg-sidebar-accent")}>
        <span className="flex-1">{title}</span>
        {menu
          ? <Menu.Root>
              <Menu.Trigger aria-label={`${title} actions`} title={`${title} actions`} className={cn(SECTION_ACTION, "ml-0 data-[state=open]:opacity-100")}><Icon name="MoreHorizontal" /></Menu.Trigger>
              <Menu.Portal><Menu.Content {...PORTAL_SCOPE} align="end" className={MENU}><MenuBody parts={Menu} groups={menu} /></Menu.Content></Menu.Portal>
            </Menu.Root>
          : null}
        {action}
      </h2>
      <div className="space-y-px">{children}</div>
    </section>
  );
}

function ProjectRename({ project, onDone }: { project: WorkProject; onDone: () => void }) {
  const call = useCall();
  const [value, setValue] = useState(project.name);
  const save = () => {
    const name = value.trim();
    if (name && name !== project.name) void call("project_update", { projectId: project.id, name }).finally(onDone);
    else onDone();
  };
  return (
    <div className={cn(ROW, "bg-foreground/[0.08]")}>
      <span className={ROW_GLYPH}><Icon name="Folder" /></span>
      <input autoFocus aria-label="Project name" value={value} onChange={(change) => setValue(change.target.value)} onBlur={save}
        onKeyDown={(key) => { if (key.key === "Enter") save(); if (key.key === "Escape") onDone(); }}
        className="h-6 min-w-0 flex-1 rounded-sm bg-foreground/[0.06] px-1 text-sm outline-none ring-1 ring-ring" />
    </div>
  );
}

function ProjectRow({ project, threads, active, canOrganize, onOpen, onNewThread, onMoveThreads, onReorder, onChanged }: {
  project: WorkProject;
  threads: readonly PluginSidebarThread[];
  active: boolean;
  canOrganize: boolean;
  onOpen: () => void;
  onNewThread: () => void;
  onMoveThreads: (threadIds: string[], projectId: string) => void;
  onReorder: (draggedId: string, beforeId: string) => void;
  onChanged: () => void;
}) {
  const call = useCall();
  const threadActions = useSidebarThreadActions();
  const { projects: bbProjects } = useSidebarThreads();
  const [renaming, setRenaming] = useState(false);
  const drop = useDrop(
    (types) => canOrganize && (types.includes(THREADS_MIME) || types.includes(PROJECT_MIME)),
    (data) => {
      const dragged = data.getData(PROJECT_MIME);
      if (dragged) { if (dragged !== project.id) onReorder(dragged, project.id); return; }
      onMoveThreads(draggedThreads(data), project.id);
    },
  );
  const settings = project.bbProjectId ? bbProjects.find((entry) => entry.id === project.bbProjectId)?.settingsHref : null;
  const groups: MenuEntry[][] = [
    [{ id: "new", label: "New thread", icon: "MessageSquarePlus", run: () => (canOrganize ? onNewThread() : threadActions.openNewThread({ ...(project.bbProjectId ? { projectId: project.bbProjectId } : {}), focusPrompt: true })) }],
    [
      ...(canOrganize ? [{ id: "rename", label: "Rename", icon: "Edit", run: () => setRenaming(true) }] : []),
      ...(settings ? [{ id: "settings", label: "Folder settings", icon: "Settings", run: () => openAppPath(settings) }] : []),
    ],
    canOrganize
      ? [{ id: "archive", label: "Archive project", icon: "Archive", run: () => { if (confirm(`Archive ${project.name}? Its threads and pages stay; they move to Threads and the Library.`)) void call("project_archive", { projectId: project.id, archived: true }).then(onChanged); } }]
      : [],
  ].filter((group) => group.length);
  if (renaming) return <ProjectRename project={project} onDone={() => { setRenaming(false); onChanged(); }} />;
  return (
    <RowMenu label={project.name} groups={groups}>
      <button
        type="button"
        draggable={canOrganize}
        onDragStart={(event) => { event.dataTransfer.setData(PROJECT_MIME, project.id); event.dataTransfer.effectAllowed = "move"; }}
        onClick={onOpen}
        aria-current={active ? "page" : undefined}
        className={cn(ROW, active && ROW_ACTIVE, drop.over && "bg-sidebar-accent ring-1 ring-ring", "group-hover/thread:pr-8")}
        {...drop.props}
      >
        <span className={ROW_GLYPH}>{project.icon ? <span className="text-sm leading-none">{project.icon}</span> : <Icon name={active ? "FolderOpen" : "Folder"} />}</span>
        <span className={ROW_LABEL}>{project.name}</span>
        <span className="group-hover/thread:invisible"><StatusMark threads={threads} /></span>
      </button>
    </RowMenu>
  );
}

function ThreadRow({ thread, depth, active, selected, selection, moveTargets, onClick, onMove }: {
  thread: PluginSidebarThread;
  depth: number;
  active: boolean;
  selected: boolean;
  /** Everything selected; dragging a selected row drags them all. */
  selection: ReadonlySet<string>;
  moveTargets: MoveTarget[] | null;
  onClick: (event: MouseEvent) => void;
  onMove: (projectId: string | null) => void;
}) {
  return (
    <ThreadMenu thread={thread} moveTargets={moveTargets} onMove={onMove}>
      {() => (
        <button
          type="button"
          draggable
          onDragStart={(event) => {
            const ids = selected ? [...selection] : [thread.id];
            event.dataTransfer.setData(THREADS_MIME, JSON.stringify(ids));
            event.dataTransfer.effectAllowed = "move";
          }}
          onClick={onClick}
          aria-current={active ? "page" : undefined}
          aria-selected={selected || undefined}
          style={depth ? { paddingLeft: `${8 + depth * 16}px` } : undefined}
          className={cn(ROW, active && ROW_ACTIVE, selected && "bg-primary/15 hover:bg-primary/20", "group-hover/thread:pr-14")}
        >
          <span className={ROW_GLYPH}><ThreadGlyph thread={thread} /></span>
          <span className={cn(ROW_LABEL, thread.isUnread && "font-medium")}>{thread.displayTitle}</span>
        </button>
      )}
    </ThreadMenu>
  );
}

function NewProjectDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (projectId: string) => void }) {
  const call = useCall();
  const { projects: bbProjects } = useSidebarThreads();
  // One Studio project per folder: hide folders another project already has.
  const work = useWork();
  const taken = new Set([work.chief, ...work.projects].map((project) => project?.bbProjectId).filter(Boolean));
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(""); setFolder(""); setError(null); } }, [open]);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true); setError(null);
    try {
      const project = await call("project_create", { name: name.trim(), bbProjectId: folder || null }) as { id?: string; projectId?: string };
      onOpenChange(false);
      onCreated(project.id ?? project.projectId!);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay {...PORTAL_SCOPE} className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content {...PORTAL_SCOPE} className="fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-xl outline-none">
          <Dialog.Title className="text-base font-semibold">New project</Dialog.Title>
          <Dialog.Description className="mt-1 mb-4 text-sm text-muted-foreground">A project gets a lead you talk to and a page it keeps current. Add threads and pages to it any time.</Dialog.Description>
          <form onSubmit={(event) => { event.preventDefault(); void create(); }} className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Name</span>
              <input autoFocus value={name} onChange={(change) => setName(change.target.value)} placeholder="e.g. Hiring, Q4 launch, Taxes" className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Folder <span className="text-subtle-foreground">(optional, for code)</span></span>
              <select value={folder} onChange={(change) => setFolder(change.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring">
                <option value="">None</option>
                {bbProjects.filter((project) => !project.isPersonal && !taken.has(project.id)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close className={GHOST_BUTTON}>Cancel</Dialog.Close>
              <button type="submit" disabled={!name.trim() || busy} className={PRIMARY_BUTTON}>Create project</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function BulkBar({ count, onPin, onRead, onArchive, onClear, moveMenu }: { count: number; onPin: () => void; onRead: () => void; onArchive: () => void; onClear: () => void; moveMenu: MenuEntry[][] | null }) {
  const button = "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground [&_svg]:size-4";
  return (
    <div role="toolbar" aria-label="Selected threads" className="sticky bottom-2 z-10 mx-1 mt-2 flex items-center gap-0.5 rounded-lg border border-border bg-popover px-2 py-1 shadow-md">
      <span className="flex-1 text-xs text-muted-foreground">{count} selected</span>
      <button type="button" title="Pin" aria-label="Pin" onClick={onPin} className={button}><Icon name="Pin" /></button>
      <button type="button" title="Mark read" aria-label="Mark read" onClick={onRead} className={button}><Icon name="MailOpen" /></button>
      {moveMenu
        ? <Menu.Root>
            <Menu.Trigger title="Move to project" aria-label="Move to project" className={button}><Icon name="MoveTo" /></Menu.Trigger>
            <Menu.Portal><Menu.Content {...PORTAL_SCOPE} side="top" align="end" className={cn(MENU, "max-h-80 overflow-y-auto")}><MenuBody parts={Menu} groups={moveMenu} /></Menu.Content></Menu.Portal>
          </Menu.Root>
        : null}
      <button type="button" title="Archive" aria-label="Archive" onClick={onArchive} className={button}><Icon name="Archive" /></button>
      <button type="button" title="Clear selection (Esc)" aria-label="Clear selection" onClick={onClear} className={button}><Icon name="X" /></button>
    </div>
  );
}

/** With nothing pinned, Pinned appears only while dragging a thread. */
function PinTarget({ drop }: { drop: Drop }) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const start = (event: globalThis.DragEvent) => { if (event.dataTransfer?.types.includes(THREADS_MIME)) setDragging(true); };
    const end = () => setDragging(false);
    globalThis.addEventListener("dragstart", start);
    globalThis.addEventListener("dragend", end);
    globalThis.addEventListener("drop", end);
    return () => { globalThis.removeEventListener("dragstart", start); globalThis.removeEventListener("dragend", end); globalThis.removeEventListener("drop", end); };
  }, []);
  if (!dragging) return null;
  return <div {...drop.props} className={cn("mt-2 flex h-8 items-center justify-center gap-2 rounded-md border border-dashed border-border text-xs text-muted-foreground", drop.over && "bg-sidebar-accent text-foreground")}><Icon name="Pin" className="size-3.5" />Drop to pin</div>;
}

const visible = (thread: PluginSidebarThread) => !thread.isArchived && !thread.isHidden;

export function Sidebar({ activeThreadId, onNavigate }: PluginThreadListProps) {
  const call = useCall();
  const { threads, projects: bbProjects } = useSidebarThreads();
  const threadActions = useSidebarThreadActions();
  const navigate = useBbNavigate();
  const pathname = usePathname();
  const { move, targets: moveTargets, work } = useMoveThreads();
  const [problem, setProblem] = useState<string | null>(null);
  const report = (cause: unknown) => { setProblem(cause instanceof Error ? cause.message : String(cause)); work.refresh(); };
  const [showAll, setShowAll] = useState(false);
  const [sort, setSortState] = useState<ThreadSort>(readSort);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const startThread = useStartThread();
  const setSort = (by: ThreadSort["by"]) => {
    // Choosing the current order again flips its direction, as in BB.
    const next = { by, desc: sort.by === by ? !sort.desc : by !== "alpha" };
    setSortState(next);
    try { globalThis.localStorage?.setItem(SORT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  // The Chief of Staff's lead has its own row, not a one-off.
  const chief = useProject(work.chief?.id ?? null);
  const chiefThreadId = chief.data?.leadThreadId ?? null;
  const chiefThread = chiefThreadId ? threads.find((thread) => thread.id === chiefThreadId) : undefined;

  const live = useMemo(() => threads.filter(visible), [threads]);
  const byProject = useMemo(() => {
    const map = new Map<string, PluginSidebarThread[]>();
    for (const thread of live) {
      const projectId = work.projectOf(thread);
      if (projectId) map.set(projectId, [...(map.get(projectId) ?? []), thread]);
    }
    return map;
  }, [live, work]);
  const pinned = useMemo(() => live.filter((thread) => thread.isPinned).sort((a, b) => (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0)), [live]);
  const oneOffs = useMemo(
    () => nest(sortThreads(live.filter((thread) => !thread.isPinned && thread.id !== chiefThreadId && work.projectOf(thread) === null), sort)),
    [live, chiefThreadId, work, sort],
  );
  const shown = showAll ? oneOffs : oneOffs.slice(0, THREADS_SHOWN);
  const order = useMemo(() => [...pinned.map((thread) => thread.id), ...shown.map((row) => row.thread.id)], [pinned, shown]);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const activeProject = activeThread ? work.projectOf(activeThread) : null;

  useEffect(() => {
    if (!selected.size) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(new Set()); };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [selected.size]);

  const openProject = (projectId: string) => { navigate.toPluginPanel(PROJECTS_PANEL, { subPath: projectId }); onNavigate(); };
  const moveThreads = (threadIds: string[], projectId: string | null) => {
    void move(threadIds, projectId).catch(report);
    setSelected(new Set());
  };
  const reorder = (draggedId: string, beforeId: string) => {
    void call("project_reorder", { projectId: draggedId, ...reorderNeighbours(work.order, draggedId, beforeId) }).then(work.refresh, report);
  };
  const clickThread = (thread: PluginSidebarThread) => (event: MouseEvent) => {
    // Shift selects (a range once something is selected); with a selection, ⌘ toggles one. Otherwise ⌘ opens in a split, as in BB.
    if (event.shiftKey || (selected.size && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      setSelected(extendSelection(order, selected, anchor, thread.id, event.shiftKey && selected.size > 0));
      setAnchor(thread.id);
      return;
    }
    setSelected(new Set());
    threadActions.open(thread.id, { split: event.metaKey || event.ctrlKey });
    onNavigate();
  };
  const bulk = (run: (threadId: string) => unknown) => { for (const id of selected) void run(id); setSelected(new Set()); };

  const pinDrop = useDrop((types) => types.includes(THREADS_MIME), (data) => { for (const id of draggedThreads(data)) void threadActions.setPinned(id, true); setSelected(new Set()); });
  const threadsDrop = useDrop((types) => work.canOrganize && types.includes(THREADS_MIME), (data) => moveThreads(draggedThreads(data), null));

  const sortMenu: MenuEntry[][] = [[{
    id: "sort", label: "Sort by", icon: "ArrowUpDown", submenu: [([["updated", "Updated at"], ["created", "Created at"], ["alpha", "Alphabetical"]] as const).map(([by, label]) => ({
      id: by, label: sort.by === by ? `${label} ${sort.desc ? "↓" : "↑"}` : label, icon: by === "alpha" ? "ArrowUpDown" : "Clock", checked: sort.by === by, run: () => setSort(by),
    }))],
  }]];
  const threadRow = (thread: PluginSidebarThread, depth = 0) => (
    <ThreadRow
      key={thread.id}
      thread={thread}
      depth={depth}
      active={thread.id === activeThreadId}
      selected={selected.has(thread.id)}
      selection={selected}
      moveTargets={moveTargets(thread)}
      onClick={clickThread(thread)}
      onMove={(projectId) => moveThreads([thread.id], projectId)}
    />
  );
  const chiefActive = (work.chief !== null && pathname === projectPath(work.chief.id)) || (chiefThreadId !== null && activeThreadId === chiefThreadId);
  const personal = bbProjects.find((project) => project.isPersonal);

  return (
    <div className="flex flex-col px-2 pb-6">
      {work.chief
        ? <div className="mt-1 space-y-px">
            <button type="button" onClick={() => openProject(work.chief!.id)} aria-current={chiefActive ? "page" : undefined} className={cn(ROW, chiefActive && ROW_ACTIVE)}>
              <span className={ROW_GLYPH}><Icon name="Bot" /></span>
              <span className={ROW_LABEL}>Chief of Staff</span>
              {chiefThread ? <ThreadGlyph thread={chiefThread} /> : null}
            </button>
          </div>
        : null}
      <Section
        title="Projects"
        action={<button type="button" aria-label="New project" title="New project" onClick={() => setCreating(true)} className={cn(SECTION_ACTION, "ml-0")}><Icon name="Plus" /></button>}
      >
        {work.projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            threads={byProject.get(project.id) ?? []}
            // On the project's page, or in one of its threads.
            active={pathname === projectPath(project.id) || activeProject === project.id}
            canOrganize={work.canOrganize}
            onOpen={() => openProject(project.id)}
            onNewThread={() => startThread.start(project.id)}
            onMoveThreads={moveThreads}
            onReorder={reorder}
            onChanged={work.refresh}
          />
        ))}
        {!work.projects.length ? <button type="button" onClick={() => setCreating(true)} className={cn(ROW, "text-muted-foreground")}><span className={ROW_GLYPH}><Icon name="Plus" /></span>New project</button> : null}
      </Section>
      {pinned.length ? <Section title="Pinned" drop={pinDrop}>{pinned.map((thread) => threadRow(thread))}</Section> : null}
      <Section
        title="Threads"
        drop={threadsDrop}
        menu={sortMenu}
        action={<button type="button" aria-label="New thread" title="New thread" onClick={() => { threadActions.openNewThread({ ...(personal ? { projectId: personal.id } : {}), focusPrompt: true }); onNavigate(); }} className={cn(SECTION_ACTION, "ml-0")}><Icon name="Plus" /></button>}
      >
        {shown.map(({ thread, depth }) => threadRow(thread, depth))}
        {oneOffs.length > THREADS_SHOWN
          ? <button type="button" onClick={() => setShowAll(!showAll)} className={cn(ROW, "text-muted-foreground")}>{showAll ? "Show less" : `Show ${oneOffs.length - THREADS_SHOWN} more`}</button>
          : null}
        {!pinned.length ? <PinTarget drop={pinDrop} /> : null}
      </Section>
      {selected.size
        ? <BulkBar
            count={selected.size}
            onPin={() => bulk((id) => threadActions.setPinned(id, true))}
            onRead={() => bulk((id) => threadActions.setRead(id, true))}
            onArchive={() => bulk((id) => threadActions.archive(id))}
            onClear={() => setSelected(new Set())}
            moveMenu={work.canOrganize ? [moveTargets(null)!.map((target) => ({ id: target.id ?? "none", label: target.name, icon: target.id ? "Folder" : "MessageSquare", run: () => moveThreads([...selected], target.id) }))] : null}
          />
        : null}
      {problem ? <p role="alert" className="mx-2 mt-2 flex items-start gap-2 text-xs text-destructive"><span className="flex-1">{problem}</span><button type="button" aria-label="Dismiss" onClick={() => setProblem(null)}><Icon name="X" className="size-3.5" /></button></p> : null}
      {startThread.dialog}
      <NewProjectDialog open={creating} onOpenChange={setCreating} onCreated={(id) => { work.refresh(); openProject(id); }} />
    </div>
  );
}
