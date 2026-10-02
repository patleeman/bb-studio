// Spaces in Studio: an open space's home page, with its items, threads,
// channels and projects, and the dialogs that make a space and fill it. Spaces are
// protected tags (src/spaces.ts); only the user makes one here.
import {
  CopyReferenceMenuItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  GHOST_BUTTON,
  Icon,
  ItemLinkText,
  ItemLinkTextarea,
  ItemTile,
  OUTLINE_BUTTON,
  PageColumn,
  openAppPath,
  projectName,
  studioItemProps,
  studioThreadProps,
  type CollectionItem,
  type CollectionKind,
  type Project,
  type StudioItemLink,
} from "@bb-studio/kit/app";
import { errorMessage, plural, relativeTime, untitled } from "@bb-studio/kit/format";
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "@bb-studio/kit/ui";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { STUDIO_PLUGIN_ID } from "@bb-studio/kit/contract";
import type { rpcContract, SpaceThreadView, SpaceView } from "../contract";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

const PROJECT_REF = "bb-project";
const THREAD_REF = "bb-thread";
const SHOWN_THREADS = 6;

/** Threads, or Studio Teams' channels and direct messages, which are threads too. */
export type ThreadKind = "threads" | "conversations";
const ofKind = (thread: SpaceThreadView, kind: ThreadKind) => (thread.kind === "thread") === (kind === "threads");

function threadIcon(thread: SpaceThreadView) {
  if (thread.status === "active" || thread.status === "starting") return "Loader";
  return thread.kind === "channel" ? "Hash" : thread.kind === "dm" ? "Bot" : "MessageSquare";
}

/** Where a thread lives, or who a direct message is with. */
function threadPlace(thread: SpaceThreadView, projects: readonly Project[]) {
  if (thread.kind === "channel") return "Channel";
  if (thread.kind === "dm") return `With ${thread.botName}`;
  return projectName(projects, thread.projectId);
}

/** The app path that opens a space; a new thread that links it joins it. */
export function spaceHref(id: string): string {
  return `/plugins/studio/studio/space/${encodeURIComponent(id)}`;
}

/** Where a space opens: its page, or Studio's route for it, which makes one. */
export function spaceLink(space: SpaceView): string {
  return space.pageId ? `/plugins/pages/pages/${encodeURIComponent(space.pageId)}` : spaceHref(space.id);
}

/** A composer draft that files the new thread in the space. */
export function spacePrompt(space: SpaceView, rest = ""): string {
  return `${rest}${rest ? "\n\n" : ""}Space: ${space.name} (${spaceHref(space.id)})\n\n`;
}

export function SpaceGlyph({ space, className }: { space: Pick<SpaceView, "icon" | "color">; className?: string }) {
  return space.icon ? (
    <span className={className}>{space.icon}</span>
  ) : (
    <span className={`inline-block size-2.5 shrink-0 rounded-full ${className ?? ""}`} style={{ backgroundColor: space.color }} />
  );
}

const SHOWN_ITEMS = 8;

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
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => navigate.toThread(thread.id)}
        {...studioThreadProps(thread.id, thread.title)}
      >
        <Icon name={threadIcon(thread)} className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm">{thread.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {threadPlace(thread, projects)} · {relativeTime(thread.updatedAt)}
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
    <button
      type="button"
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-state-hover"
      onClick={() => openAppPath(item.href)}
      {...studioItemProps({ href: item.href, title: untitled(item.title), icon: kind?.icon })}
    >
      <ItemTile icon={item.icon} kindIcon={kind?.icon ?? "File"} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm">{untitled(item.title)}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {kind?.label ?? item.kind} · {projectName(projects, item.projectId)} · {relativeTime(item.updatedAt)}
      </span>
    </button>
  );
}

function AddThreadActions({ space, onAddThreads }: { space: SpaceView; onAddThreads(kind: ThreadKind): void }) {
  const navigate = useBbNavigate();
  return (
    <>
      <button type="button" className={GHOST_BUTTON} onClick={() => onAddThreads("threads")}>
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

/** Kinds a space can make, from every add-on but Studio's own spaces. */
export function creatableKinds(kinds: readonly CollectionKind[]): CollectionKind[] {
  return kinds.filter((kind) => kind.create && (kind.capabilities?.create ?? true) && kind.pluginId !== "studio");
}

/** One tile per thing to make in the space: each add-on's kinds, and a thread. */
function CreateGrid({ space, kinds, onCreate }: { space: SpaceView; kinds: readonly CollectionKind[]; onCreate(kind: CollectionKind): void }) {
  const navigate = useBbNavigate();
  const tile = "flex h-10 min-w-0 items-center gap-2.5 rounded-md border border-border px-3 text-left text-sm hover:bg-state-hover";
  return (
    <section aria-label="Create" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      <button type="button" className={tile} onClick={() => navigate.toCompose({ initialPrompt: spacePrompt(space), focusPrompt: true })}>
        <ItemTile icon={null} kindIcon="MessageSquarePlus" size="sm" />
        <span className="truncate">Thread</span>
      </button>
      {creatableKinds(kinds).map((kind) => (
        <button key={`${kind.pluginId}:${kind.id}`} type="button" className={tile} onClick={() => onCreate(kind)}>
          <ItemTile icon={null} kindIcon={kind.icon} size="sm" />
          <span className="truncate">{kind.label}</span>
        </button>
      ))}
    </section>
  );
}

/** Rows for a list of threads, the ones added directly removable. */
function ThreadRows({ threads, projects, onRemove }: { threads: readonly SpaceThreadView[]; projects: readonly Project[]; onRemove(id: string): void }) {
  return (
    <>
      {threads.map((thread) => (
        <ThreadRow key={thread.id} thread={thread} projects={projects} onRemove={thread.direct ? () => onRemove(thread.id) : undefined} />
      ))}
    </>
  );
}

/** A space's page, to work from: what it's for, things to make, then its recent items, threads, channels and projects. */
export function SpaceHome({
  rpc,
  space,
  items,
  threads,
  kinds,
  projects,
  onEdit,
  onDelete,
  onAddItems,
  onAddThreads,
  onShowItems,
  onCreate,
  onChanged,
}: {
  rpc: Rpc;
  space: SpaceView;
  /** The space's items, archived ones left out. */
  items: readonly CollectionItem[];
  threads: readonly SpaceThreadView[] | null;
  kinds: readonly CollectionKind[];
  projects: readonly Project[];
  onEdit(): void;
  onDelete(): void;
  onAddItems(): void;
  onAddThreads(kind: ThreadKind): void;
  /** Opens the Studio collection filtered to the space. */
  onShowItems(): void;
  /** Makes one of a kind in the space, and opens it. */
  onCreate(kind: CollectionKind): void;
  onChanged(): void;
}) {
  const members = useMembers(rpc, space, onChanged);
  const [allThreads, setAllThreads] = useState(false);
  const recent = useMemo(() => items.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SHOWN_ITEMS), [items]);
  const plain = threads?.filter((thread) => ofKind(thread, "threads")) ?? null;
  const talk = threads?.filter((thread) => ofKind(thread, "conversations")) ?? null;
  const shownThreads = allThreads ? plain : plain?.slice(0, SHOWN_THREADS);
  const removeThread = (id: string) => void members([], [{ pluginId: THREAD_REF, id }]);
  return (
    <PageColumn>
      <div className="flex items-start gap-3">
        <h1 className="min-w-0 flex-1 text-[28px] leading-tight font-semibold tracking-tight">
          {space.icon ? `${space.icon} ` : ""}
          {space.name}
        </h1>
        <SpaceMenu reference={{ href: spaceHref(space.id), title: space.name, ...(space.icon ? { icon: space.icon } : {}) }} onEdit={onEdit} onDelete={onDelete} />
      </div>
      {space.description ? (
        <p className="mt-2 whitespace-pre-wrap text-muted-foreground"><ItemLinkText text={space.description} /></p>
      ) : (
        <button type="button" className={`${GHOST_BUTTON} mt-1 -ml-2.5 text-muted-foreground`} onClick={onEdit}>
          Say what this space is for
        </button>
      )}
      <div className="mt-6 flex flex-col gap-8">
        <CreateGrid space={space} kinds={kinds} onCreate={onCreate} />
        <Section
          title="Recent"
          actions={
            <button type="button" className={OUTLINE_BUTTON} onClick={onAddItems}>
              <Icon name="Plus" /> Add items
            </button>
          }
          footer={
            items.length > recent.length ? (
              <button type="button" className={`${GHOST_BUTTON} self-start`} onClick={onShowItems}>
                Show all {items.length} in Studio
              </button>
            ) : null
          }
        >
          {recent.map((item) => (
            <ItemRow key={`${item.pluginId}:${item.id}`} item={item} kinds={kinds} projects={projects} />
          ))}
          {!recent.length ? <Empty>No items yet. Add some, or add a project.</Empty> : null}
        </Section>
        <Section
          title="Threads"
          actions={<AddThreadActions space={space} onAddThreads={onAddThreads} />}
          footer={
            plain && plain.length > SHOWN_THREADS ? (
              <button type="button" className={`${GHOST_BUTTON} self-start`} onClick={() => setAllThreads(!allThreads)}>
                {allThreads ? "Show fewer" : `Show all ${plain.length}`}
              </button>
            ) : null
          }
        >
          {plain === null ? <Empty>Loading threads…</Empty> : null}
          <ThreadRows threads={shownThreads ?? []} projects={projects} onRemove={removeThread} />
          {plain?.length === 0 ? <Empty>No threads yet. Start one here, or add a project.</Empty> : null}
        </Section>
        <Section
          title="Channels and messages"
          actions={
            <button type="button" className={OUTLINE_BUTTON} onClick={() => onAddThreads("conversations")}>
              <Icon name="Plus" /> Add channel
            </button>
          }
        >
          {talk === null ? <Empty>Loading channels…</Empty> : null}
          <ThreadRows threads={talk ?? []} projects={projects} onRemove={removeThread} />
          {talk?.length === 0 ? <Empty>No channels or direct messages yet. Add a Studio Teams channel or a chat with a bot.</Empty> : null}
        </Section>
        <Section
          title="Projects"
          actions={<AddProjectMenu space={space} projects={projects} onAdd={(id) => void members([{ pluginId: PROJECT_REF, id }], [])} />}
        >
          <ProjectRows space={space} projects={projects} items={items} threads={threads} onRemove={(id) => void members([], [{ pluginId: PROJECT_REF, id }])} />
        </Section>
      </div>
    </PageColumn>
  );
}

/** The space's options menu, beside its title. */
export function SpaceMenu({ reference, onEdit, onDelete }: { reference: StudioItemLink; onEdit(): void; onDelete(): void }) {
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
        <CopyReferenceMenuItem item={reference} />
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
  onDelete,
}: {
  rpc: Rpc;
  /** null makes a new one. */
  space: SpaceView | null;
  projects: readonly Project[];
  defaultProjectId: string | null;
  onClose(): void;
  onSaved(space: SpaceView): void;
  /** Asks to delete the space being edited. */
  onDelete?(): void;
}) {
  const [name, setName] = useState(space?.name ?? "");
  const [icon, setIcon] = useState(space?.icon ?? "");
  const [description, setDescription] = useState(space?.description ?? "");
  const [project, setProject] = useState(space ? (space.defaultProjectId ?? "") : (defaultProjectId ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  const restore = async () => {
    if (!space) return;
    setBusy(true);
    setError(null);
    try {
      const { added } = await rpc.call("restoreSpaceWidgets", { id: space.id });
      setRestored(added ? `Added ${added} ${added === 1 ? "widget" : "widgets"} to the page.` : "The page has every widget.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

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
              <SpaceIconPicker icon={icon} onChange={setIcon} />
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Name</span>
              <Input autoFocus value={name} maxLength={40} placeholder="Q4 launch" onChange={(event) => setName(event.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">What it's for</span>
            <ItemLinkTextarea
              rows={2}
              value={description}
              maxLength={500}
              placeholder="Type @ to link a page, board or other item"
              onValueChange={setDescription}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            />
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
          {space?.pageId ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Page</span>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void restore()}>
                  Restore missing widgets
                </Button>
                <span className="text-xs text-muted-foreground">{restored ?? "Puts back widgets taken off the space's page."}</span>
              </div>
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
          <DialogFooter>
            {space && onDelete ? (
              <Button type="button" variant="ghost" className="text-destructive sm:mr-auto" disabled={busy} onClick={onDelete}>
                Delete space
              </Button>
            ) : null}
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
export function AddThreadsDialog({
  rpc,
  space,
  kind,
  projects,
  onClose,
  onChanged,
}: {
  rpc: Rpc;
  space: SpaceView;
  kind: ThreadKind;
  projects: readonly Project[];
  onClose(): void;
  onChanged(): void;
}) {
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
  const listed =
    threads?.filter((thread) => ofKind(thread, kind) && (!text || `${thread.title} ${thread.botName ?? ""}`.toLowerCase().includes(text))) ?? [];
  const noun = kind === "threads" ? "threads" : "channels and messages";

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
          <DialogTitle>
            Add {noun} to {space.name}
          </DialogTitle>
          <DialogDescription>
            {kind === "threads"
              ? "Threads in the space's projects are already in it. A thread stays in its project."
              : "Studio Teams channels and direct messages with bots. Each stays where it is, and links back to the space."}
          </DialogDescription>
        </DialogHeader>
        <Input autoFocus value={query} placeholder={`Search ${noun}`} onChange={(event) => setQuery(event.target.value)} />
        <div className="-mx-2 flex max-h-96 flex-col overflow-y-auto">
          {threads === null ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</p> : null}
          {listed.map((thread) => {
            const added = space.threadIds.includes(thread.id);
            const viaProject = !added && thread.projectId !== null && space.projectIds.includes(thread.projectId);
            return (
              <div key={thread.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-state-hover">
                <Icon name={threadIcon(thread)} className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{thread.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{threadPlace(thread, projects)}</div>
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
          {threads && !listed.length ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {text ? `No ${noun} match.` : kind === "threads" ? "No open threads." : "No channels or direct messages. They come from Studio Teams."}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Adds BB projects to a space, or takes them out; everything in one joins with it. */
export function SpaceProjectsDialog({ rpc, space, projects, onClose, onChanged }: { rpc: Rpc; space: SpaceView; projects: readonly Project[]; onClose(): void; onChanged(): void }) {
  const members = useMembers(rpc, space, onChanged);
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = async (id: string, add: boolean) => {
    setBusy(id);
    const ref = [{ pluginId: PROJECT_REF, id }];
    await members(add ? ref : [], add ? [] : ref);
    setBusy(null);
  };
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Projects in {space.name}</DialogTitle>
          <DialogDescription>A project's items and threads, now and later, belong to the space too. They stay in the project.</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 flex max-h-96 flex-col overflow-y-auto">
          {projects.map((project) => {
            const added = space.projectIds.includes(project.id);
            return (
              <div key={project.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-state-hover">
                <Icon name="Folder" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{project.name}</span>
                {space.defaultProjectId === project.id ? <span className="text-xs text-muted-foreground">Default</span> : null}
                <button type="button" className={added ? GHOST_BUTTON : OUTLINE_BUTTON} disabled={busy === project.id} onClick={() => void toggle(project.id, !added)}>
                  {added ? "Remove" : "Add"}
                </button>
              </div>
            );
          })}
          {!projects.length ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">No projects.</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SPACE_ICONS = [
  "🚀", "🎯", "📣", "💡", "🧪", "🛠️", "📚", "🗓️", "📊", "📈", "🧭", "🗺️", "🏗️", "🔥", "⭐", "🧠",
  "🤖", "💼", "💰", "📦", "🎨", "🎬", "🎵", "📷", "✈️", "🏠", "🌱", "🌍", "❤️", "🏆", "🧩", "🔒",
];

/** Picks a space's emoji; "" is none. */
function SpaceIconPicker({ icon, onChange }: { icon: string; onChange(icon: string): void }) {
  const [open, setOpen] = useState(false);
  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={icon ? `Icon ${icon}, change` : "Choose an icon"}
          className="flex h-9 items-center justify-center rounded-md border border-border bg-background text-lg hover:bg-state-hover"
        >
          {icon || <Icon name="Plus" className="size-4 text-muted-foreground" />}
        </button>
      </DropdownMenuTrigger>
      {/* Portaled out of Studio's styles, as on a space's page in Pages: bring them along. */}
      <DropdownMenuContent align="start" className="w-72 p-2" data-bb-plugin={STUDIO_PLUGIN_ID} data-bb-plugin-root="">
        <div className="grid grid-cols-8 gap-1">
          {SPACE_ICONS.map((each) => (
            <button
              key={each}
              type="button"
              aria-label={each}
              aria-pressed={each === icon}
              className={cn("rounded p-1 text-lg hover:bg-state-hover", each === icon && "bg-state-active")}
              onClick={() => pick(each)}
            >
              {each}
            </button>
          ))}
        </div>
        {icon ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => pick("")}>No icon</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
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
