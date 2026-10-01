// Spaces in Studio: an open space's home, with tabs for its overview, items,
// threads and projects, and the dialogs that make a space and fill it. Spaces
// are protected tags (src/spaces.ts); only the user makes one here.
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  GHOST_BUTTON,
  Icon,
  ItemTile,
  OUTLINE_BUTTON,
  PageColumn,
  openAppPath,
  projectName,
  type CollectionItem,
  type CollectionKind,
  type Project,
} from "@bb-studio/kit/app";
import { errorMessage, plural, relativeTime, untitled } from "@bb-studio/kit/format";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Textarea } from "@bb-studio/kit/ui";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { rpcContract, SpaceThreadView, SpaceView } from "../contract";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

const PROJECT_REF = "bb-project";
const THREAD_REF = "bb-thread";
const SHOWN_THREADS = 6;

/** The app path that opens a space; a new thread that links it joins it. */
export function spaceHref(id: string): string {
  return `/plugins/studio/studio/space/${encodeURIComponent(id)}`;
}

/** A composer draft that files the new thread in the space. */
export function spacePrompt(space: SpaceView, rest = ""): string {
  return `${rest}${rest ? "\n\n" : ""}Space: ${space.name} (${spaceHref(space.id)})\n\n`;
}

export function SpaceGlyph({ space, className }: { space: SpaceView; className?: string }) {
  return space.icon ? (
    <span className={className}>{space.icon}</span>
  ) : (
    <span className={`inline-block size-2.5 shrink-0 rounded-full ${className ?? ""}`} style={{ backgroundColor: space.color }} />
  );
}

export type SpaceTab = "overview" | "items" | "threads" | "projects";
const SPACE_TABS: readonly { id: SpaceTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "items", label: "Items" },
  { id: "threads", label: "Threads" },
  { id: "projects", label: "Projects" },
];
const SHOWN_ITEMS = 8;

/** The tab a space's sub-path names; any other segment is a kind in Items. */
export function spaceTab(segment: string | undefined): { tab: SpaceTab; kind: string } {
  if (!segment) return { tab: "overview", kind: "all" };
  if (SPACE_TABS.some((each) => each.id === segment)) return { tab: segment as SpaceTab, kind: "all" };
  return { tab: "items", kind: segment };
}

export function useSpaceThreads(rpc: Rpc, space: SpaceView | null) {
  const [threads, setThreads] = useState<SpaceThreadView[] | null>(null);
  const key = space ? `${space.id}|${space.projectIds.join(",")}|${space.threadIds.join(",")}` : "";
  useEffect(() => {
    if (!space) return;
    let live = true;
    rpc.call("spaceThreads", { id: space.id }).then(
      (result) => live && setThreads(result.threads),
      () => live && setThreads([]),
    );
    return () => {
      live = false;
    };
    // The key covers the space's members.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, key]);
  return space ? threads : null;
}

/** Adds and removes projects and threads, reporting failures. */
function useMembers(rpc: Rpc, space: SpaceView, onChanged: () => void) {
  return async (add: { pluginId: string; id: string }[], remove: { pluginId: string; id: string }[]) => {
    try {
      await rpc.call("spaceMembers", { id: space.id, add, remove });
      onChanged();
    } catch (cause) {
      toast.error(`Couldn't change the space: ${errorMessage(cause)}`);
    }
  };
}

/** What the space is for and its tabs, under its title; the same on every tab. */
export function SpaceSubheader({
  space,
  tab,
  counts,
  onTab,
  onEdit,
  onDelete,
}: {
  space: SpaceView;
  tab: SpaceTab;
  counts: { items: number; threads: number | null; projects: number };
  onTab(tab: SpaceTab): void;
  onEdit(): void;
  onDelete(): void;
}) {
  const navigate = useBbNavigate();
  const count = (id: SpaceTab) => (id === "items" ? counts.items : id === "threads" ? counts.threads : id === "projects" ? counts.projects : null);
  return (
    <>
      {space.description ? <p className="mt-1 text-sm text-muted-foreground">{space.description}</p> : null}
      <div className="mt-4 flex items-end gap-2 border-b border-border">
        <nav aria-label={`${space.name} sections`} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {SPACE_TABS.map((each) => {
            const n = count(each.id);
            return (
              <button
                key={each.id}
                type="button"
                aria-current={tab === each.id ? "page" : undefined}
                className="-mb-px flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 pt-1 pb-2 text-sm text-muted-foreground hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                onClick={() => onTab(each.id)}
              >
                {each.label}
                {n ? <span className="text-xs text-muted-foreground tabular-nums">{n}</span> : null}
              </button>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-1 pb-1.5">
          <button type="button" className={GHOST_BUTTON} onClick={() => navigate.toCompose({ initialPrompt: spacePrompt(space), focusPrompt: true })}>
            <Icon name="MessageSquarePlus" /> New thread
          </button>
          <SpaceMenu onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
    </>
  );
}

/** A space's tab that isn't its item list: the title, the subheader, then the tab. */
export function SpacePage({ title, subheader, children }: { title: string; subheader: ReactNode; children: ReactNode }) {
  return (
    <PageColumn className="max-w-6xl">
      <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{title}</h1>
      {subheader}
      <div className="mt-6">{children}</div>
    </PageColumn>
  );
}

function Section({ title, actions, footer, children }: { title: string; actions?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <div className="flex h-8 items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      <div className="divide-y divide-border rounded-md border border-border">{children}</div>
      {footer}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function ThreadRow({ thread, projects, onRemove }: { thread: SpaceThreadView; projects: readonly Project[]; onRemove?(): void }) {
  const navigate = useBbNavigate();
  return (
    <div className="group flex items-center gap-2 px-3 py-2 hover:bg-state-hover">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => navigate.toThread(thread.id)}>
        <Icon name={thread.status === "active" || thread.status === "starting" ? "Loader" : "MessageSquare"} className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm">{thread.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {projectName(projects, thread.projectId)} · {relativeTime(thread.updatedAt)}
        </span>
      </button>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${thread.title} from the space`}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
          onClick={onRemove}
        >
          <Icon name="X" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function ItemRow({ item, kinds, projects }: { item: CollectionItem; kinds: readonly CollectionKind[]; projects: readonly Project[] }) {
  const kind = kinds.find((each) => each.pluginId === item.pluginId && each.id === item.kind);
  return (
    <button type="button" className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-state-hover" onClick={() => openAppPath(item.href)}>
      <ItemTile icon={item.icon} kindIcon={kind?.icon ?? "File"} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm">{untitled(item.title)}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {kind?.label ?? item.kind} · {projectName(projects, item.projectId)} · {relativeTime(item.updatedAt)}
      </span>
    </button>
  );
}

function AddThreadActions({ space, onAddThreads }: { space: SpaceView; onAddThreads(): void }) {
  const navigate = useBbNavigate();
  return (
    <>
      <button type="button" className={GHOST_BUTTON} onClick={onAddThreads}>
        <Icon name="Plus" /> Add existing
      </button>
      <button type="button" className={OUTLINE_BUTTON} onClick={() => navigate.toCompose({ initialPrompt: spacePrompt(space), focusPrompt: true })}>
        <Icon name="MessageSquarePlus" /> New thread
      </button>
    </>
  );
}

function AddProjectMenu({ space, projects, onAdd }: { space: SpaceView; projects: readonly Project[]; onAdd(id: string): void }) {
  const addable = projects.filter((project) => !space.projectIds.includes(project.id));
  if (!addable.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={OUTLINE_BUTTON}>
          <Icon name="Plus" /> Add project
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Everything in it joins the space</DropdownMenuLabel>
        {addable.map((project) => (
          <DropdownMenuItem key={project.id} onSelect={() => onAdd(project.id)}>
            <Icon name="Folder" className="size-4" /> {project.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectRows({
  space,
  projects,
  items,
  threads,
  onRemove,
}: {
  space: SpaceView;
  projects: readonly Project[];
  items: readonly CollectionItem[];
  threads: readonly SpaceThreadView[] | null;
  onRemove(id: string): void;
}) {
  if (!space.projectIds.length) return <Empty>No projects yet. Add one to bring in its items and threads.</Empty>;
  return (
    <>
      {space.projectIds.map((id) => {
        const itemCount = items.filter((item) => item.projectId === id).length;
        const threadCount = threads?.filter((thread) => thread.projectId === id).length;
        return (
          <div key={id} className="group flex items-center gap-2 px-3 py-2">
            <Icon name="Folder" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-sm">{projectName(projects, id)}</span>
            {space.defaultProjectId === id ? <span className="shrink-0 text-xs text-muted-foreground">Default</span> : null}
            <span className="flex-1" />
            <span className="shrink-0 text-xs text-muted-foreground">
              {plural(itemCount, "item")}
              {threadCount === undefined ? "" : ` · ${plural(threadCount, "thread")}`}
            </span>
            <button
              type="button"
              aria-label={`Remove ${projectName(projects, id)} from the space`}
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
              onClick={() => onRemove(id)}
            >
              <Icon name="X" className="size-3.5" />
            </button>
          </div>
        );
      })}
    </>
  );
}

/** The space's home: its latest items and threads, and its projects. */
export function SpaceOverview({
  rpc,
  space,
  items,
  threads,
  kinds,
  projects,
  onTab,
  onAddItems,
  onAddThreads,
  onChanged,
}: {
  rpc: Rpc;
  space: SpaceView;
  /** The space's items, archived ones left out. */
  items: readonly CollectionItem[];
  threads: readonly SpaceThreadView[] | null;
  kinds: readonly CollectionKind[];
  projects: readonly Project[];
  onTab(tab: SpaceTab): void;
  onAddItems(): void;
  onAddThreads(): void;
  onChanged(): void;
}) {
  const members = useMembers(rpc, space, onChanged);
  const recent = useMemo(() => items.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SHOWN_ITEMS), [items]);
  const viewAll = (tab: SpaceTab, total: number, shown: number) =>
    total > shown ? (
      <button type="button" className={`${GHOST_BUTTON} self-start`} onClick={() => onTab(tab)}>
        View all {total}
      </button>
    ) : null;
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-8 lg:grid-cols-2">
        <Section
          title="Recent items"
          actions={
            <button type="button" className={OUTLINE_BUTTON} onClick={onAddItems}>
              <Icon name="Plus" /> Add items
            </button>
          }
          footer={viewAll("items", items.length, recent.length)}
        >
          {recent.map((item) => (
            <ItemRow key={`${item.pluginId}:${item.id}`} item={item} kinds={kinds} projects={projects} />
          ))}
          {!recent.length ? <Empty>No items yet. Add some, or add a project.</Empty> : null}
        </Section>
        <Section
          title="Threads"
          actions={<AddThreadActions space={space} onAddThreads={onAddThreads} />}
          footer={threads ? viewAll("threads", threads.length, Math.min(threads.length, SHOWN_THREADS)) : null}
        >
          {threads === null ? <Empty>Loading threads…</Empty> : null}
          {threads?.slice(0, SHOWN_THREADS).map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              projects={projects}
              onRemove={thread.direct ? () => void members([], [{ pluginId: THREAD_REF, id: thread.id }]) : undefined}
            />
          ))}
          {threads?.length === 0 ? <Empty>No threads yet. Start one here, or add a project.</Empty> : null}
        </Section>
      </div>
      <Section
        title="Projects"
        actions={<AddProjectMenu space={space} projects={projects} onAdd={(id) => void members([{ pluginId: PROJECT_REF, id }], [])} />}
      >
        <ProjectRows space={space} projects={projects} items={items} threads={threads} onRemove={(id) => void members([], [{ pluginId: PROJECT_REF, id }])} />
      </Section>
    </div>
  );
}

/** Every thread in the space. */
export function SpaceThreads({
  rpc,
  space,
  threads,
  projects,
  onAddThreads,
  onChanged,
}: {
  rpc: Rpc;
  space: SpaceView;
  threads: readonly SpaceThreadView[] | null;
  projects: readonly Project[];
  onAddThreads(): void;
  onChanged(): void;
}) {
  const members = useMembers(rpc, space, onChanged);
  return (
    <Section title="Threads" actions={<AddThreadActions space={space} onAddThreads={onAddThreads} />}>
      {threads === null ? <Empty>Loading threads…</Empty> : null}
      {threads?.map((thread) => (
        <ThreadRow
          key={thread.id}
          thread={thread}
          projects={projects}
          onRemove={thread.direct ? () => void members([], [{ pluginId: THREAD_REF, id: thread.id }]) : undefined}
        />
      ))}
      {threads?.length === 0 ? <Empty>No threads yet. Start one here, or add a project.</Empty> : null}
    </Section>
  );
}

/** The space's projects; everything in one is in the space. */
export function SpaceProjects({
  rpc,
  space,
  items,
  threads,
  projects,
  onChanged,
}: {
  rpc: Rpc;
  space: SpaceView;
  items: readonly CollectionItem[];
  threads: readonly SpaceThreadView[] | null;
  projects: readonly Project[];
  onChanged(): void;
}) {
  const members = useMembers(rpc, space, onChanged);
  return (
    <Section title="Projects" actions={<AddProjectMenu space={space} projects={projects} onAdd={(id) => void members([{ pluginId: PROJECT_REF, id }], [])} />}>
      <ProjectRows space={space} projects={projects} items={items} threads={threads} onRemove={(id) => void members([], [{ pluginId: PROJECT_REF, id }])} />
    </Section>
  );
}

/** The space's options menu, beside its tabs. */
export function SpaceMenu({ onEdit, onDelete }: { onEdit(): void; onDelete(): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Space options"
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active"
        >
          <Icon name="MoreHorizontal" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={onEdit}>
          <Icon name="Pencil" className="size-4" /> Edit space
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
          <Icon name="Trash2" className="size-4" /> Delete space
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Makes a space, or edits one. */
export function SpaceDialog({
  rpc,
  space,
  projects,
  defaultProjectId,
  onClose,
  onSaved,
}: {
  rpc: Rpc;
  /** null makes a new one. */
  space: SpaceView | null;
  projects: readonly Project[];
  defaultProjectId: string | null;
  onClose(): void;
  onSaved(space: SpaceView): void;
}) {
  const [name, setName] = useState(space?.name ?? "");
  const [icon, setIcon] = useState(space?.icon ?? "");
  const [description, setDescription] = useState(space?.description ?? "");
  const [project, setProject] = useState(space ? (space.defaultProjectId ?? "") : (defaultProjectId ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const fields = { name: name.trim(), icon: icon.trim() || null, description: description.trim(), defaultProjectId: project || null };
    try {
      const result = space ? await rpc.call("updateSpace", { id: space.id, ...fields }) : await rpc.call("createSpace", fields);
      onSaved(result.space);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{space ? "Edit space" : "New space"}</DialogTitle>
          <DialogDescription>A space gathers pages, boards, drawings, projects and threads in one place.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !busy) void save();
          }}
        >
          <div className="flex gap-2">
            <label className="flex w-16 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Icon</span>
              <Input value={icon} maxLength={16} placeholder="🚀" onChange={(event) => setIcon(event.target.value)} className="text-center" />
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Name</span>
              <Input autoFocus value={name} maxLength={40} placeholder="Q4 launch" onChange={(event) => setName(event.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">What it's for</span>
            <Textarea rows={2} value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Default project</span>
            <select
              value={project}
              onChange={(event) => setProject(event.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">None (global)</option>
              {projects.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">New items go here, and it joins the space with its items and threads.</span>
          </label>
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {space ? "Save" : "Create space"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Picks items to add to a space or take out of it. */
export function AddItemsDialog({
  rpc,
  space,
  items,
  kinds,
  projects,
  onClose,
  onChanged,
}: {
  rpc: Rpc;
  space: SpaceView;
  items: readonly CollectionItem[];
  kinds: readonly CollectionKind[];
  projects: readonly Project[];
  onClose(): void;
  onChanged(): void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const kindOf = (item: CollectionItem) => kinds.find((kind) => kind.pluginId === item.pluginId && kind.id === item.kind);
  const listed = useMemo(() => {
    const text = query.trim().toLowerCase();
    return items
      .filter((item) => !item.archived && (!text || untitled(item.title).toLowerCase().includes(text)))
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 200);
  }, [items, query]);

  const toggle = async (item: CollectionItem, add: boolean) => {
    const key = `${item.pluginId}:${item.id}`;
    setBusy(key);
    try {
      const ref = [{ pluginId: item.pluginId, id: item.id }];
      await rpc.call("spaceMembers", { id: space.id, add: add ? ref : [], remove: add ? [] : ref });
      onChanged();
    } catch (cause) {
      toast.error(`Couldn't change the space: ${errorMessage(cause)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add items to {space.name}</DialogTitle>
          <DialogDescription>Items in the space's projects are already in it.</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={query} placeholder="Search titles" onChange={(event) => setQuery(event.target.value)} />
        <div className="-mx-2 flex max-h-96 flex-col overflow-y-auto">
          {listed.map((item) => {
            const key = `${item.pluginId}:${item.id}`;
            const added = space.itemKeys.includes(key);
            const viaProject = !added && item.projectId !== null && space.projectIds.includes(item.projectId);
            const kind = kindOf(item);
            return (
              <div key={key} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-state-hover">
                <ItemTile icon={item.icon} kindIcon={kind?.icon ?? "File"} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{untitled(item.title)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {kind?.label ?? item.kind} · {projectName(projects, item.projectId)}
                  </div>
                </div>
                {viaProject ? (
                  <span className="text-xs text-muted-foreground">In a project</span>
                ) : (
                  <button type="button" className={added ? GHOST_BUTTON : OUTLINE_BUTTON} disabled={busy === key} onClick={() => void toggle(item, !added)}>
                    {added ? "Remove" : "Add"}
                  </button>
                )}
              </div>
            );
          })}
          {!listed.length ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">No items match.</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Picks open threads to add to a space. */
export function AddThreadsDialog({ rpc, space, projects, onClose, onChanged }: { rpc: Rpc; space: SpaceView; projects: readonly Project[]; onClose(): void; onChanged(): void }) {
  const [threads, setThreads] = useState<SpaceThreadView[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    rpc.call("recentThreads", null).then(
      (result) => setThreads(result.threads),
      (cause: unknown) => {
        toast.error(`Couldn't list threads: ${errorMessage(cause)}`);
        setThreads([]);
      },
    );
  }, [rpc]);
  const text = query.trim().toLowerCase();
  const listed = threads?.filter((thread) => !text || thread.title.toLowerCase().includes(text)) ?? [];

  const toggle = async (thread: SpaceThreadView, add: boolean) => {
    setBusy(thread.id);
    try {
      const ref = [{ pluginId: THREAD_REF, id: thread.id }];
      await rpc.call("spaceMembers", { id: space.id, add: add ? ref : [], remove: add ? [] : ref });
      onChanged();
    } catch (cause) {
      toast.error(`Couldn't change the space: ${errorMessage(cause)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add threads to {space.name}</DialogTitle>
          <DialogDescription>Threads in the space's projects are already in it. A thread stays in its project.</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={query} placeholder="Search threads" onChange={(event) => setQuery(event.target.value)} />
        <div className="-mx-2 flex max-h-96 flex-col overflow-y-auto">
          {threads === null ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</p> : null}
          {listed.map((thread) => {
            const added = space.threadIds.includes(thread.id);
            const viaProject = !added && thread.projectId !== null && space.projectIds.includes(thread.projectId);
            return (
              <div key={thread.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-state-hover">
                <Icon name="MessageSquare" className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{thread.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{projectName(projects, thread.projectId)}</div>
                </div>
                {viaProject ? (
                  <span className="text-xs text-muted-foreground">In a project</span>
                ) : (
                  <button type="button" className={added ? GHOST_BUTTON : OUTLINE_BUTTON} disabled={busy === thread.id} onClick={() => void toggle(thread, !added)}>
                    {added ? "Remove" : "Add"}
                  </button>
                )}
              </div>
            );
          })}
          {threads && !listed.length ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">No threads match.</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirms deleting a space; its members stay where they are. */
export function DeleteSpaceDialog({ space, onClose, onConfirm }: { space: SpaceView; onClose(): void; onConfirm(): void }) {
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {space.name}?</DialogTitle>
          <DialogDescription>Its items, projects and threads stay where they are; only the space goes.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete space
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
