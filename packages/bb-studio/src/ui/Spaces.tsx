// Spaces in the Studio collection: the switcher above it, the header of an
// open space with its projects and threads, and the dialogs that make a space
// and fill it. Spaces are protected tags (src/spaces.ts); only the user makes
// one here.
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
  PILL,
  projectName,
  type CollectionItem,
  type CollectionKind,
  type Project,
} from "@bb-studio/kit/app";
import { errorMessage, untitled } from "@bb-studio/kit/format";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Textarea } from "@bb-studio/kit/ui";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState } from "react";
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

function SpaceGlyph({ space, className }: { space: SpaceView; className?: string }) {
  return space.icon ? (
    <span className={className}>{space.icon}</span>
  ) : (
    <span className={`inline-block size-2.5 shrink-0 rounded-full ${className ?? ""}`} style={{ backgroundColor: space.color }} />
  );
}

/** "All items" and one pill per space, plus New space. */
export function SpaceBar({ spaces, current, onPick, onNew }: { spaces: readonly SpaceView[]; current: string | null; onPick(id: string | null): void; onNew(): void }) {
  return (
    <nav aria-label="Spaces" className="mb-3 flex items-center gap-1 overflow-x-auto">
      <button type="button" className={PILL} aria-pressed={current === null} onClick={() => onPick(null)}>
        All items
      </button>
      {spaces.map((space) => (
        <button key={space.id} type="button" className={`${PILL} flex items-center gap-1.5`} aria-pressed={current === space.id} onClick={() => onPick(space.id)}>
          <SpaceGlyph space={space} />
          <span className="max-w-48 truncate">{space.name}</span>
        </button>
      ))}
      <button type="button" className={GHOST_BUTTON} onClick={onNew}>
        <Icon name="Plus" /> New space
      </button>
    </nav>
  );
}

function useSpaceThreads(rpc: Rpc, space: SpaceView) {
  const [threads, setThreads] = useState<SpaceThreadView[] | null>(null);
  const key = `${space.id}|${space.projectIds.join(",")}|${space.threadIds.join(",")}`;
  useEffect(() => {
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
  return threads;
}

/** An open space: what it's for, its projects and threads, and how to fill it. */
export function SpaceHeader({
  rpc,
  space,
  projects,
  onEdit,
  onAddItems,
  onAddThreads,
  onChanged,
}: {
  rpc: Rpc;
  space: SpaceView;
  projects: readonly Project[];
  onEdit(): void;
  onAddItems(): void;
  onAddThreads(): void;
  onChanged(): void;
}) {
  const navigate = useBbNavigate();
  const threads = useSpaceThreads(rpc, space);
  const [showAll, setShowAll] = useState(false);
  const members = async (add: { pluginId: string; id: string }[], remove: { pluginId: string; id: string }[]) => {
    try {
      await rpc.call("spaceMembers", { id: space.id, add, remove });
      onChanged();
    } catch (cause) {
      toast.error(`Couldn't change the space: ${errorMessage(cause)}`);
    }
  };
  const addable = projects.filter((project) => !space.projectIds.includes(project.id));
  const shown = showAll ? threads : threads?.slice(0, SHOWN_THREADS);

  return (
    <section aria-label={`Space ${space.name}`} className="mb-4 flex flex-col gap-3 rounded-lg border border-border px-4 py-3">
      {space.description ? <p className="text-sm text-muted-foreground">{space.description}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Projects</span>
        {space.projectIds.map((id) => (
          <span key={id} className="flex h-7 items-center gap-1 rounded-md border border-border pr-1 pl-2 text-sm">
            <Icon name="Folder" className="size-3.5 text-muted-foreground" />
            {projectName(projects, id)}
            {space.defaultProjectId === id ? <span className="text-xs text-muted-foreground">· default</span> : null}
            <button
              type="button"
              aria-label={`Remove ${projectName(projects, id)} from the space`}
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground"
              onClick={() => void members([], [{ pluginId: PROJECT_REF, id }])}
            >
              <Icon name="X" className="size-3" />
            </button>
          </span>
        ))}
        {!space.projectIds.length ? <span className="text-sm text-muted-foreground">None. Add one to bring in its items and threads.</span> : null}
        {addable.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={GHOST_BUTTON}>
                <Icon name="Plus" /> Add project
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Everything in it joins the space</DropdownMenuLabel>
              {addable.map((project) => (
                <DropdownMenuItem key={project.id} onSelect={() => void members([{ pluginId: PROJECT_REF, id: project.id }], [])}>
                  <Icon name="Folder" className="size-4" /> {project.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Threads</span>
          <span className="flex-1" />
          <button type="button" className={GHOST_BUTTON} onClick={onAddThreads}>
            <Icon name="Plus" /> Add thread
          </button>
          <button type="button" className={OUTLINE_BUTTON} onClick={() => navigate.toCompose({ initialPrompt: spacePrompt(space), focusPrompt: true })}>
            <Icon name="MessageSquarePlus" /> New thread
          </button>
        </div>
        {threads === null ? <p className="text-sm text-muted-foreground">Loading threads…</p> : null}
        {threads?.length === 0 ? <p className="text-sm text-muted-foreground">No threads yet. Start one here, or add a project.</p> : null}
        {shown?.map((thread) => (
          <div key={thread.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-state-hover">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => navigate.toThread(thread.id)}>
              <Icon name={thread.status === "active" || thread.status === "starting" ? "Loader" : "MessageSquare"} className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm">{thread.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{projectName(projects, thread.projectId)}</span>
            </button>
            {thread.direct ? (
              <button
                type="button"
                aria-label={`Remove ${thread.title} from the space`}
                className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                onClick={() => void members([], [{ pluginId: THREAD_REF, id: thread.id }])}
              >
                <Icon name="X" className="size-3.5" />
              </button>
            ) : null}
          </div>
        ))}
        {threads && threads.length > SHOWN_THREADS ? (
          <button type="button" className={`${GHOST_BUTTON} self-start`} onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show fewer" : `Show all ${threads.length}`}
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <button type="button" className={OUTLINE_BUTTON} onClick={onAddItems}>
          <Icon name="Plus" /> Add items
        </button>
        <button type="button" className={GHOST_BUTTON} onClick={onEdit}>
          <Icon name="Pencil" /> Edit space
        </button>
      </div>
    </section>
  );
}

/** The space's options menu, beside New. */
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
