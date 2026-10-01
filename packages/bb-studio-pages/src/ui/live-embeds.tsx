// Embeds that stay live: a table edited in place, a task checked off or moved
// between its board's columns, a board whose cards drag between columns, a
// recording played with its transcript. Each reads and writes its add-on
// through Pages and refreshes while it's shown.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, cn } from "@bb-studio/kit/ui";
import { parseTableSubPath, tableHref, tableSubPath, type Table } from "@bb-studio/kit/tables";
import { TableView, type TableHost } from "@bb-studio/kit/table-grid";
import { toast } from "sonner";
import type { BoardCard, RecordingCard, StudioEmbedItem, TaskCard, TaskColumn } from "../contract";
import { STUDIO_EMBEDS, boardTarget, parseBoardTarget, type BoardEmbedView } from "../schema-config";
import { usePagesUi } from "./context";
import { useStudioItems } from "./studio-embeds";

const POLL_MS = 5_000;
const DONE = "done";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Loads a value and reloads it every few seconds while the page is visible. */
function useLive<T>(load: () => Promise<T>, key: string): { value: T | undefined; failed: boolean; reload(): void } {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(() => {
    void loadRef.current().then(
      (next) => {
        setValue(next);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(() => {
    setValue(undefined);
    reload();
    const timer = setInterval(() => document.visibilityState === "visible" && reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [key, reload]);
  return { value, failed, reload };
}

// ---- Tables ----

/** A table edited in place; `target` is `<table id>` or `<table id>/view/<view id>`. */
export function TableEmbed({ target, onTargetChange }: { target: string; onTargetChange?(target: string): void }) {
  const ui = usePagesUi();
  const linked = parseTableSubPath(target);
  const tableId = linked?.tableId ?? "";
  const { value: table, failed } = useLive<Table | null>(() => ui.table(tableId), tableId);
  const items = useStudioItems();
  const api = useMemo(() => ui.tableApi(tableId), [ui, tableId]);
  const host = useMemo<TableHost>(
    () => ({
      openUrl: ui.openUrl,
      openItem: (relation) => {
        const item = items?.find((each) => each.pluginId === relation.pluginId && each.id === relation.itemId);
        if (item) ui.openPath(item.href);
      },
      items: (items ?? []).map((item: StudioEmbedItem) => ({
        pluginId: item.pluginId,
        itemId: item.id,
        title: item.title,
        kindLabel: item.kindLabel,
        kindIcon: item.kindIcon,
        icon: item.icon,
        href: item.href,
      })),
      bots: ui.bots.map((bot) => bot.name),
      copyLink: ({ viewId, rowId }) =>
        void navigator.clipboard.writeText(new URL(tableHref({ tableId, viewId, rowId }), window.location.origin).href).then(
          () => toast.success(rowId ? "Copied a link to the row." : viewId ? "Copied a link to the view." : "Copied a link to the table."),
          (error) => toast.error(message(error)),
        ),
      onError: (error) => toast.error(message(error)),
    }),
    [ui, items, tableId],
  );

  if (!table) {
    return (
      <p role={failed || table === null ? "alert" : "status"} className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
        <Icon name="Rows2" className="size-4" />
        {table === null ? "This table was deleted." : failed ? "Studio Tables isn't available." : "Loading table…"}
      </p>
    );
  }
  return (
    <div className="pages-table-embed">
      <header className="flex items-center gap-2 px-3 pt-2.5">
        <Icon name="Rows2" className="size-4 shrink-0 text-muted-foreground" />
        <button
          type="button"
          className="min-w-0 truncate text-sm font-medium text-foreground hover:underline"
          title="Open in Tables"
          onClick={() => ui.openPath(tableHref({ tableId, viewId: linked?.viewId }))}
        >
          {table.title}
        </button>
        <button
          type="button"
          aria-label="Open in Tables"
          className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={() => ui.openPath(tableHref({ tableId, viewId: linked?.viewId }))}
        >
          <Icon name="ArrowUpRight" className="size-4" />
        </button>
      </header>
      <TableView
        embedded
        table={table}
        api={api}
        host={host}
        viewId={linked?.viewId}
        onViewChange={onTargetChange ? (viewId) => onTargetChange(tableSubPath({ tableId, viewId })) : undefined}
      />
    </div>
  );
}

// ---- Tasks ----

function formatDue(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * A task as one live row: done, title, column, due date, assignee and
 * subtasks, all editable but the last two, and a button that opens it.
 */
/** Tasks just made from the page, whose titles take focus once they show. */
const NEW_TASKS = new Set<string>();
export const focusNewTask = (id: string) => void NEW_TASKS.add(id);

export function TaskBody({ id, onOpen }: { id: string; onOpen(): void }) {
  const ui = usePagesUi();
  const { value, reload } = useLive(() => ui.task(id), id);
  const [draft, setDraft] = useState<Partial<TaskCard> | null>(null);
  const [isNew] = useState(() => NEW_TASKS.delete(id));
  if (!value?.task) return null;
  const task = { ...value.task, ...draft };
  const columns: TaskColumn[] = value.columns.some((column) => column.id === task.status)
    ? value.columns
    : [...value.columns, { id: task.status, label: task.statusLabel }];
  const done = task.status === DONE;
  const save = (change: { title?: string; status?: string; due?: string | null }) => {
    setDraft((current) => ({ ...current, ...change }));
    void ui.updateTask({ id, ...change }).then(
      () => {
        setDraft(null);
        reload();
      },
      (error) => {
        setDraft(null);
        toast.error(message(error));
      },
    );
  };
  const reopen = columns.find((column) => column.id !== DONE)?.id;
  const bot = task.assignee?.startsWith("bot:") ? ui.bots.find((each) => each.id === task.assignee!.slice(4)) : undefined;
  const assignee = task.assignee === "me" ? "You" : task.assignee === "agent" ? "Agent" : bot ? bot.name : task.assignee;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-xs text-muted-foreground">
      <label className="flex min-w-0 flex-1 basis-60 items-center gap-2">
        <input
          type="checkbox"
          aria-label={done ? "Mark not done" : "Mark done"}
          className="size-4 shrink-0 accent-primary"
          checked={done}
          disabled={!done && !columns.some((column) => column.id === DONE)}
          onChange={() => (done ? reopen && save({ status: reopen }) : save({ status: DONE }))}
        />
        <input
          aria-label="Task title"
          key={value.task.title}
          defaultValue={task.title}
          placeholder="Untitled task"
          autoFocus={isNew}
          maxLength={300}
          className={cn("min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm text-foreground outline-none hover:bg-state-hover focus:bg-state-hover", done && "text-muted-foreground line-through")}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.currentTarget.value = value.task!.title;
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => {
            const title = event.currentTarget.value.trim();
            if (title && title !== value.task!.title) save({ title });
            else event.currentTarget.value = value.task!.title;
          }}
        />
      </label>
      <select
        aria-label="Status"
        className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
        value={task.status}
        onChange={(event) => save({ status: event.target.value })}
      >
        {columns.map((column) => (
          <option key={column.id} value={column.id}>
            {column.label}
          </option>
        ))}
      </select>
      <label className="relative flex h-7 items-center gap-1 rounded-md px-1.5 hover:bg-state-hover" title="Due date">
        <Icon name="Calendar" className="size-3.5" />
        <span className={cn(task.due && task.due < new Date().toISOString().slice(0, 10) && !done && "text-destructive")}>{task.due ? formatDue(task.due) : "No date"}</span>
        <input
          type="date"
          aria-label="Due date"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={task.due ?? ""}
          onChange={(event) => save({ due: event.target.value || null })}
        />
      </label>
      {assignee ? (
        <span className="flex items-center gap-1">
          {bot ? <span>{bot.avatar}</span> : <Icon name={task.assignee === "agent" ? "AiBrain01" : "UserRound"} className="size-3.5" />}
          {assignee}
        </span>
      ) : null}
      {task.subtasks.total ? (
        <span className="flex items-center gap-1 tabular-nums" title="Subtasks done">
          <Icon name="ListTodo" className="size-3.5" />
          {task.subtasks.done}/{task.subtasks.total}
        </span>
      ) : null}
      {task.labels.map((label) => (
        <span key={label} className="rounded bg-muted px-1.5 py-0.5">
          {label}
        </span>
      ))}
      <button type="button" aria-label="Open task" title="Open in Tasks" className="flex size-7 items-center justify-center rounded-md hover:bg-state-hover hover:text-foreground" onClick={onOpen}>
        <Icon name="ArrowUpRight" className="size-4" />
      </button>
    </div>
  );
}

// ---- Boards ----

const TASK_DRAG = "application/x-bb-pages-task";
/** Columns show this many cards before "Show more". */
const BOARD_PAGE = 8;

function tasksHref(id: string, view: BoardEmbedView = "board"): string {
  return `/plugins/${STUDIO_EMBEDS.board.pluginId}/${STUDIO_EMBEDS.board.panel}/${id}${view === "list" ? "/list" : ""}`;
}

/**
 * A board in a page: its columns side by side with cards you drag between
 * them or add to, or its tasks as a checklist grouped by column. `target` is
 * `<board id>` or `<board id>/view/list`; switching views keeps it with the page.
 */
export function BoardEmbed({ target, onTargetChange }: { target: string; onTargetChange?(target: string): void }) {
  const ui = usePagesUi();
  const { boardId, view: linkedView } = parseBoardTarget(target);
  const [localView, setLocalView] = useState<BoardEmbedView | null>(null);
  const view = onTargetChange ? linkedView : (localView ?? linkedView);
  const { value, failed, reload } = useLive<{ board: BoardCard | null; tasks: TaskCard[] }>(() => ui.board(boardId), boardId);
  /** Moves shown before the server confirms them. */
  const [moved, setMoved] = useState<{ id: string; status: string; index: number } | null>(null);

  const tasks = useMemo(() => {
    const all = value?.tasks ?? [];
    if (!moved) return all;
    const task = all.find((each) => each.id === moved.id);
    if (!task) return all;
    const others = all.filter((each) => each.id !== moved.id);
    const column = others.filter((each) => each.status === moved.status);
    const before = column[moved.index];
    const at = before ? others.indexOf(before) : column.length ? others.indexOf(column[column.length - 1]!) + 1 : others.length;
    return [...others.slice(0, at), { ...task, status: moved.status }, ...others.slice(at)];
  }, [value, moved]);

  const board = value?.board;
  if (!board) {
    return (
      <p role={failed || board === null ? "alert" : "status"} className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
        <Icon name="GridView" className="size-4" />
        {board === null ? "This board was deleted." : failed ? "Studio Tasks isn't available." : "Loading board…"}
      </p>
    );
  }

  const move = (id: string, status: string, index?: number) => {
    setMoved({ id, status, index: index ?? 0 });
    void ui.updateTask({ id, status, ...(index !== undefined ? { index } : {}) }).then(
      () => reload(),
      (error) => toast.error(message(error)),
    ).finally(() => setMoved(null));
  };
  const add = (title: string, status?: string) =>
    void ui.createBoardTask({ boardId, title, status }).then(
      () => reload(),
      (error) => toast.error(message(error)),
    );
  const switchTo = (next: BoardEmbedView) => (onTargetChange ? onTargetChange(boardTarget(boardId, next)) : setLocalView(next));

  return (
    <div className="pages-board-embed">
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <Icon name="GridView" className="size-4 shrink-0 text-muted-foreground" />
        <input
          aria-label="Board title"
          key={board.title}
          defaultValue={board.title}
          placeholder="Untitled board"
          maxLength={200}
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm font-medium text-foreground outline-none hover:bg-state-hover focus:bg-state-hover"
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.currentTarget.value = board.title;
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => {
            const title = event.currentTarget.value.trim();
            if (title !== board.title) void ui.renameBoard(boardId, title).then(reload, (error) => toast.error(message(error)));
          }}
        />
        <div role="group" aria-label="View" className="flex h-7 items-center rounded-md border border-border p-0.5">
          {(["board", "list"] as const).map((each) => (
            <button
              key={each}
              type="button"
              aria-pressed={view === each}
              aria-label={each === "board" ? "Board" : "List"}
              title={each === "board" ? "Board" : "List"}
              className="flex h-6 items-center rounded-[5px] px-1.5 text-muted-foreground hover:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground"
              onClick={() => switchTo(each)}
            >
              <Icon name={each === "board" ? "GridView" : "ListView"} className="size-3.5" />
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Open in Tasks"
          title="Open in Tasks"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={() => ui.openPath(tasksHref(boardId, view))}
        >
          <Icon name="ArrowUpRight" className="size-4" />
        </button>
      </header>
      {view === "list" ? (
        <BoardList columns={board.columns} tasks={tasks} onMove={move} onAdd={add} onOpen={(id) => ui.openPath(tasksHref(id))} />
      ) : (
        <div className="flex gap-2 overflow-x-auto px-3 pb-3">
          {board.columns.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              tasks={tasks.filter((task) => task.status === column.id)}
              onMove={move}
              onAdd={(title) => add(title, column.id)}
              onOpen={(id) => ui.openPath(tasksHref(id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BoardColumn({ column, tasks, onMove, onAdd, onOpen }: {
  column: TaskColumn;
  tasks: TaskCard[];
  onMove(id: string, status: string, index: number): void;
  onAdd(title: string): void;
  onOpen(id: string): void;
}) {
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState(BOARD_PAGE);
  const list = useRef<HTMLDivElement>(null);
  const indexAt = (clientY: number) => {
    const cards = [...(list.current?.querySelectorAll<HTMLElement>("[data-board-card]") ?? [])];
    const at = cards.findIndex((card) => {
      const box = card.getBoundingClientRect();
      return clientY < box.top + box.height / 2;
    });
    return at < 0 ? cards.length : at;
  };
  const visible = tasks.slice(0, shown);
  return (
    <section
      aria-label={column.label}
      className={cn("flex w-56 shrink-0 flex-col rounded-md bg-muted/50", dropAt !== null && "ring-1 ring-border")}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(TASK_DRAG)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropAt(indexAt(event.clientY));
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropAt(null);
      }}
      onDrop={(event) => {
        const id = event.dataTransfer.getData(TASK_DRAG);
        const index = indexAt(event.clientY);
        setDropAt(null);
        if (!id) return;
        event.preventDefault();
        // The dragged card itself doesn't count as a position.
        const from = tasks.findIndex((task) => task.id === id);
        onMove(id, column.id, from >= 0 && from < index ? index - 1 : index);
      }}
    >
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1.5 text-xs font-medium text-foreground">
        <span className="truncate">{column.label}</span>
        <span className="text-muted-foreground tabular-nums">{tasks.length}</span>
        <button
          type="button"
          aria-label={`Add to ${column.label}`}
          className="ml-auto flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={() => setAdding(true)}
        >
          <Icon name="Plus" className="size-3.5" />
        </button>
      </div>
      <div ref={list} className="flex min-h-10 flex-col gap-1.5 px-1.5 pb-1.5">
        {adding ? (
          <NewTaskInput
            onDone={(title) => {
              setAdding(false);
              if (title) onAdd(title);
            }}
          />
        ) : null}
        {visible.map((task, index) => (
          <div key={task.id} className="relative">
            {dropAt === index ? <div aria-hidden className="absolute inset-x-0 -top-1 h-0.5 rounded-full bg-primary" /> : null}
            <button
              type="button"
              data-board-card
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(TASK_DRAG, task.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onOpen(task.id)}
              className="block w-full cursor-grab rounded border border-border/70 bg-background px-2 py-1.5 text-left text-xs shadow-xs hover:border-border active:cursor-grabbing"
            >
              <span className={cn("line-clamp-3 break-words text-foreground", task.status === DONE && "text-muted-foreground line-through")}>{task.title || "Untitled"}</span>
              {task.due || task.subtasks.total ? (
                <span className="mt-1 flex gap-2 text-muted-foreground">
                  {task.due ? <span className={cn(task.due < new Date().toISOString().slice(0, 10) && task.status !== DONE && "text-destructive")}>{formatDue(task.due)}</span> : null}
                  {task.subtasks.total ? <span className="tabular-nums">{task.subtasks.done}/{task.subtasks.total}</span> : null}
                </span>
              ) : null}
            </button>
          </div>
        ))}
        {dropAt !== null && dropAt >= visible.length ? <div aria-hidden className="h-0.5 rounded-full bg-primary" /> : null}
        {tasks.length > shown ? (
          <button type="button" className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={() => setShown((n) => n + BOARD_PAGE)}>
            Show more ({tasks.length - shown})
          </button>
        ) : null}
      </div>
    </section>
  );
}

function NewTaskInput({ onDone }: { onDone(title: string | null): void }) {
  return (
    <input
      autoFocus
      aria-label="New task title"
      placeholder="What needs doing?"
      maxLength={300}
      className="h-8 w-full rounded border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
      onKeyDown={(event) => {
        if (event.key === "Enter") onDone(event.currentTarget.value.trim() || null);
        if (event.key === "Escape") onDone(null);
      }}
      onBlur={(event) => onDone(event.currentTarget.value.trim() || null)}
    />
  );
}

/** A board's tasks as a checklist, grouped by column; Done comes last. */
function BoardList({ columns, tasks, onMove, onAdd, onOpen }: {
  columns: TaskColumn[];
  tasks: TaskCard[];
  onMove(id: string, status: string): void;
  onAdd(title: string): void;
  onOpen(id: string): void;
}) {
  const reopen = columns.find((column) => column.id !== DONE)?.id;
  const hasDone = columns.some((column) => column.id === DONE);
  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      {columns.map((column) => {
        const rows = tasks.filter((task) => task.status === column.id);
        if (!rows.length) return null;
        return (
          <section key={column.id} aria-label={column.label}>
            <h4 className="px-1 pb-0.5 text-xs font-medium text-muted-foreground">
              {column.label} <span className="tabular-nums">{rows.length}</span>
            </h4>
            <ul>
              {rows.map((task) => {
                const done = task.status === DONE;
                return (
                  <li key={task.id} className="group flex items-center gap-2 rounded px-1 py-0.5 hover:bg-state-hover">
                    <input
                      type="checkbox"
                      aria-label={done ? "Mark not done" : "Mark done"}
                      className="size-4 shrink-0 accent-primary"
                      checked={done}
                      disabled={!done && !hasDone}
                      onChange={() => (done ? reopen && onMove(task.id, reopen) : onMove(task.id, DONE))}
                    />
                    <button type="button" className={cn("min-w-0 flex-1 truncate text-left text-sm text-foreground", done && "text-muted-foreground line-through")} onClick={() => onOpen(task.id)}>
                      {task.title || "Untitled"}
                    </button>
                    {task.due ? <span className="shrink-0 text-xs text-muted-foreground">{formatDue(task.due)}</span> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {tasks.length ? null : <p className="px-1 text-xs text-muted-foreground">No tasks yet.</p>}
      <NewTaskRow onAdd={onAdd} />
    </div>
  );
}

function NewTaskRow({ onAdd }: { onAdd(title: string): void }) {
  const [adding, setAdding] = useState(false);
  return adding ? (
    <NewTaskInput
      onDone={(title) => {
        setAdding(false);
        if (title) onAdd(title);
      }}
    />
  ) : (
    <button type="button" className="flex w-fit items-center gap-1.5 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={() => setAdding(true)}>
      <Icon name="Plus" className="size-3.5" /> Add a task
    </button>
  );
}

// ---- Recordings ----

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const rest = `${String(Math.floor((seconds % 3600) / 60)).padStart(hours ? 2 : 1, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${rest}` : rest;
}

const EXCERPT = 4;

/** A recording's player, notes and transcript; each line plays from where it was said. */
export function RecordingBody({ id }: { id: string }) {
  const ui = usePagesUi();
  const { value: recording } = useLive<RecordingCard | null>(() => ui.recording(id), id);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [paused, setPaused] = useState(true);
  const [expanded, setExpanded] = useState(false);
  if (!recording) return null;
  const { segments } = recording;
  const play = (index: number) => {
    const element = audio.current;
    const segment = segments[index];
    if (!element || !segment) {
      setPlaying(null);
      return;
    }
    if (playing !== index) element.src = segment.url;
    setPlaying(index);
    void element.play().catch((error) => toast.error(message(error)));
  };
  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (playing === null) play(0);
    else if (element.paused) void element.play();
    else element.pause();
  };
  const shown = expanded ? segments : segments.slice(0, EXCERPT);
  return (
    <div className="flex flex-col gap-2 border-t border-border px-3 py-2.5 text-sm">
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={() => (playing !== null && playing + 1 < segments.length ? play(playing + 1) : setPlaying(null))}
      />
      {segments.length ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={paused ? "Play" : "Pause"}
            className="flex size-8 items-center justify-center rounded-full bg-foreground text-background hover:opacity-90"
            onClick={toggle}
          >
            <Icon name={paused ? "Play" : "Pause"} className="size-4" />
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {playing === null ? clock(recording.durationMs) : `${clock(segments[playing]!.offsetMs)} / ${clock(recording.durationMs)}`}
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{recording.status === "done" ? "Nothing was transcribed." : "Transcribing…"}</p>
      )}
      {recording.summary ? <p className="text-sm leading-relaxed text-foreground">{recording.summary}</p> : null}
      {recording.decisions.length ? (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {recording.decisions.slice(0, 5).map((decision) => (
            <li key={decision}>{decision}</li>
          ))}
        </ul>
      ) : null}
      {shown.length ? (
        <ol className={cn("flex flex-col gap-0.5", expanded && "max-h-72 overflow-y-auto")}>
          {shown.map((segment, index) => (
            <li key={segment.id}>
              <button
                type="button"
                className={cn("flex w-full gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-state-hover", playing === index && "bg-primary/10")}
                onClick={() => play(index)}
              >
                <span className="w-10 shrink-0 text-muted-foreground tabular-nums">{clock(segment.offsetMs)}</span>
                <span className={cn("min-w-0 flex-1 text-foreground", !expanded && "line-clamp-2")}>{segment.text}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {segments.length > EXCERPT ? (
        <button type="button" className="self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Show less" : `Show full transcript (${segments.length} parts)`}
        </button>
      ) : null}
    </div>
  );
}
