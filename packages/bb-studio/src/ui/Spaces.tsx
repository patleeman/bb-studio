// Spaces in Studio: the dialogs that make a space and fill it with threads
// and projects. A space itself opens on its lead's thread (ui/space). Spaces
// are meta-projects (src/spaces.ts); only the user makes one here.
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  GHOST_BUTTON,
  Icon,
  ItemLinkTextarea,
  OUTLINE_BUTTON,
  projectName,
  type Project,
} from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "@bb-studio/kit/ui";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { STUDIO_PLUGIN_ID } from "@bb-studio/kit/contract";
import type { rpcContract, SpaceThreadView, SpaceView } from "../contract";
import { spaceViewHref } from "./space/routes";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

const PROJECT_REF = "bb-project";
const THREAD_REF = "bb-thread";

function threadIcon(thread: SpaceThreadView) {
  return thread.status === "active" || thread.status === "starting" ? "Loading" : "MessageSquare";
}

/** Where a space opens: the Space view, which goes to its lead's thread (ui/space). */
export function spaceLink(space: SpaceView): string {
  return spaceViewHref(space.id);
}

export function SpaceGlyph({ space, className }: { space: Pick<SpaceView, "icon" | "color">; className?: string }) {
  return space.icon ? (
    <span className={className}>{space.icon}</span>
  ) : (
    <span className={`inline-block size-2.5 shrink-0 rounded-full ${className ?? ""}`} style={{ backgroundColor: space.color }} />
  );
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

/** Makes a space, or edits one. */
export function SpaceDialog({
  rpc,
  space,
  projects,
  onClose,
  onSaved,
  onDelete,
}: {
  rpc: Rpc;
  /** null makes a new one. */
  space: SpaceView | null;
  projects: readonly Project[];
  onClose(): void;
  onSaved(space: SpaceView): void;
  /** Asks to delete the space being edited. */
  onDelete?(): void;
}) {
  const [name, setName] = useState(space?.name ?? "");
  const [icon, setIcon] = useState(space?.icon ?? "");
  const [description, setDescription] = useState(space?.description ?? "");
  // A new space gets a folder of its own unless the user picks a project, which then moves into it.
  const [project, setProject] = useState(space?.defaultProjectId ?? "");
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
          <DialogDescription>A space gathers projects, with their threads and Studio items, in one place.</DialogDescription>
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
              {space?.defaultProjectId ? null : <option value="">{space ? "None" : "A new folder in ~/Spaces"}</option>}
              {projects.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">New items and threads go here. A project you pick moves into the space with its items and threads.</span>
          </label>
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

/** Picks open threads to add to a space. */
export function AddThreadsDialog({
  rpc,
  space,
  projects,
  onClose,
  onChanged,
}: {
  rpc: Rpc;
  space: SpaceView;
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
          <DialogDescription>Threads in the space's projects are already in it. A thread is in one space at a time, so adding it moves it here.</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={query} placeholder="Search threads" onChange={(event) => setQuery(event.target.value)} />
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
          {threads && !listed.length ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {text ? "No threads match." : "No open threads."}
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
