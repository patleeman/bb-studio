// Every board, newest first: the Tasks panel's home. A board opens on its own
// page; New board makes one in the project BB has open.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CopyReferenceMenuItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  ItemTile,
  ItemHeader,
  OUTLINE_BUTTON,
  PRIMARY_BUTTON,
  cn,
  projectName,
  useProjects,
} from "@bb-studio/kit/app";
import { errorMessage, plural, relativeTime, untitled } from "@bb-studio/kit/format";
import { useBbContext } from "@get-bb/plugin-sdk/app";
import { BOARD_ICON, boardHref, type BoardView } from "../src/shared";
import { SPIN, useTasksRpc, type Board } from "./types";

export function BoardsIndex({ refreshKey, onOpen }: { refreshKey: unknown; onOpen(id: string): void }) {
  const rpc = useTasksRpc();
  const context = useBbContext();
  const projects = useProjects();
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refetch = useCallback(() => {
    void rpc.call("boards", {}).then(
      (result) => {
        setBoards(result.boards.filter((board) => !board.template).sort((a, b) => b.updatedAt - a.updatedAt));
        setError(null);
      },
      (failure) => setError(errorMessage(failure)),
    );
  }, [rpc]);
  useEffect(refetch, [refetch, refreshKey]);

  async function create() {
    setCreating(true);
    try {
      const { board } = await rpc.call("boardCreate", { title: "", projectId: context.projectId ?? null });
      onOpen(board.id);
    } catch (failure) {
      toast.error(`Couldn't make the board: ${errorMessage(failure)}`);
    } finally {
      setCreating(false);
    }
  }

  function archive(board: Board) {
    void rpc.call("boardArchive", { id: board.id, archived: true }).then(
      () => {
        toast.success("Board archived", {
          action: { label: "Undo", onClick: () => void rpc.call("boardArchive", { id: board.id, archived: false }).then(refetch) },
        });
        refetch();
      },
      (failure) => toast.error(errorMessage(failure)),
    );
  }

  function remove(board: Board) {
    const count = board.open + board.done;
    if (!window.confirm(`Delete "${untitled(board.title)}"${count ? ` and its ${plural(count, "task")}` : ""}? This can't be undone.`)) return;
    void rpc.call("boardDelete", { id: board.id }).then(refetch, (failure) => toast.error(errorMessage(failure)));
  }

  const newButton = (
    <button type="button" className={PRIMARY_BUTTON} disabled={creating} onClick={() => void create()}>
      <Icon name={creating ? "Loading" : "Plus"} className={cn(creating && SPIN)} /> New board
    </button>
  );

  return (
    <div className="studio-root flex h-full min-h-0 flex-col overflow-auto bg-background text-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 pt-10 pb-4 max-md:px-3 max-md:pt-4">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">Boards</h1>
        {newButton}
      </div>
      {error && !boards ? (
        <div role="alert" className="px-6 text-sm text-destructive">
          {error}
        </div>
      ) : !boards ? (
        <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loading" className={cn("size-4", SPIN)} /> Loading boards…
        </div>
      ) : !boards.length ? (
        <EmptyState icon={BOARD_ICON} title="No boards yet" actions={newButton}>
          A board holds tasks in columns. Hand a task to an agent and its card follows the work.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 px-6 pb-6 max-md:px-3">
          {boards.map((board) => (
            <li key={board.id} className="group relative">
              <button
                type="button"
                className="flex h-full w-full flex-col gap-3 rounded-lg border border-border/70 bg-background p-4 text-left shadow-xs hover:border-border hover:bg-state-hover"
                onClick={() => onOpen(board.id)}
              >
                <span className="flex min-w-0 items-center gap-2.5 pr-7">
                  <ItemTile icon={null} kindIcon={BOARD_ICON} />
                  <span className="min-w-0 truncate font-medium">{untitled(board.title)}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {board.columns.map((column) => (
                    <span key={column.id} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {column.label}
                    </span>
                  ))}
                </span>
                <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{board.open} open</span>
                  <span>{board.done} done</span>
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Icon name={board.projectId ? "Folder" : "Globe"} className="size-3.5 shrink-0" />
                    <span className="truncate">{projectName(projects, board.projectId)}</span>
                  </span>
                  <span className="ml-auto">{relativeTime(board.updatedAt)}</span>
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${untitled(board.title)} actions`}
                    className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
                  >
                    <Icon name="MoreHorizontal" className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <CopyReferenceMenuItem item={{ href: boardHref(board.id), title: untitled(board.title), icon: BOARD_ICON }} />
                  <DropdownMenuItem onSelect={() => archive(board)}>
                    <Icon name="Archive" className="size-4" /> Archive
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => remove(board)}>
                    <Icon name="Trash2" className="size-4" /> Delete…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      {boards?.length ? <p className="px-6 pb-6 text-xs text-muted-foreground max-md:px-3">{plural(boards.length, "board")}</p> : null}
    </div>
  );
}

/** A board's title, project and menu, above any of its views. */
export function BoardHeader({
  board,
  view = "board",
  onBack,
  onChanged,
  children,
}: {
  board: Board;
  view?: BoardView;
  onBack(replace?: boolean): void;
  onChanged(): void;
  children?: React.ReactNode;
}) {
  const rpc = useTasksRpc();
  const projects = useProjects();
  const save = (patch: { title?: string; projectId?: string | null }) =>
    void rpc.call("boardUpdate", { id: board.id, ...patch }).then(onChanged, (failure) => toast.error(`Couldn't save the board: ${errorMessage(failure)}`));

  return (
    <div className="flex shrink-0 flex-col gap-2 px-6 pt-6 pb-4 max-md:px-3 max-md:pt-4">
      <ItemHeader
        className="relative items-center p-0 max-md:p-0"
        backLabel="Boards"
        onBack={() => onBack()}
        thread={{ href: boardHref(board.id), title: untitled(board.title) }}
        item={{ href: boardHref(board.id, view), title: untitled(board.title) }}
        trailing={<>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={OUTLINE_BUTTON}>
                <Icon name={board.projectId ? "Folder" : "Globe"} /> <span className="max-w-40 truncate">{projectName(projects, board.projectId)}</span>
                <Icon name="ChevronDown" className="text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
              {[{ id: null as string | null, name: "Global" }, ...projects].map((project) => (
                <DropdownMenuItem key={project.id ?? "global"} onSelect={() => project.id !== board.projectId && save({ projectId: project.id })}>
                  <Icon name={project.id ? "Folder" : "Globe"} className="size-4" /> <span className="truncate">{project.name}</span>
                  {project.id === board.projectId ? <Icon name="Check" className="ml-auto size-4" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Board actions" className={cn(OUTLINE_BUTTON, "px-2")}>
                <Icon name="MoreHorizontal" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <CopyReferenceMenuItem item={{ href: boardHref(board.id), title: untitled(board.title), icon: BOARD_ICON }} />
              <DropdownMenuItem
                onSelect={() =>
                  void rpc.call("boardArchive", { id: board.id, archived: !board.archived }).then(
                    () => (board.archived ? onChanged() : onBack(true)),
                    (failure) => toast.error(errorMessage(failure)),
                  )
                }
              >
                <Icon name="Archive" className="size-4" /> {board.archived ? "Unarchive" : "Archive"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  const count = board.open + board.done;
                  if (!window.confirm(`Delete "${untitled(board.title)}"${count ? ` and its ${plural(count, "task")}` : ""}? This can't be undone.`)) return;
                  void rpc.call("boardDelete", { id: board.id }).then(() => onBack(true), (failure) => toast.error(errorMessage(failure)));
                }}
              >
                <Icon name="Trash2" className="size-4" /> Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Board title"
          defaultValue={board.title}
          key={board.title}
          autoFocus={!board.title}
          placeholder="Untitled board"
          maxLength={200}
          className="mr-auto min-w-48 flex-1 bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.currentTarget.value = board.title;
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => {
            const next = event.currentTarget.value.trim();
            if (next !== board.title) save({ title: next });
          }}
        />
        {children}
      </div>
    </div>
  );
}

/** A board that's gone, or still loading. */
export function BoardMissing({ error, onBack }: { error: string | null; onBack(): void }) {
  return (
    <div className="studio-root flex h-full flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
      {error ? (
        <>
          <span role="alert">{error}</span>
          <button type="button" className={OUTLINE_BUTTON} onClick={onBack}>
            <Icon name="ChevronLeft" /> Boards
          </button>
        </>
      ) : (
        <span role="status" className="flex items-center gap-2">
          <Icon name="Loading" className={cn("size-4", SPIN)} /> Loading board…
        </span>
      )}
    </div>
  );
}
