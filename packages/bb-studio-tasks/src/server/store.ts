import type { Actor } from "@bb-studio/kit/server";
// Tasks in the plugin's SQLite database: the boards that hold them, the
// tasks, what they link to, and the threads they were handed to.
import { newId } from "@bb-studio/kit/ids";
import type Database from "better-sqlite3";
import { nextDue, STATUSES, STATUS_LABELS, type Assignee, type HandoffState, type Priority, type Recurrence, type TaskStatus } from "../shared";

/**
 * Append-only: statement index is the migration id, and BB checks each
 * statement against the hash it recorded, so never edit one (not even its
 * whitespace).
 */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS tasks (
       id TEXT PRIMARY KEY,
       title TEXT NOT NULL,
       description TEXT NOT NULL DEFAULT '',
       status TEXT NOT NULL,
       rank REAL NOT NULL,
       project_id TEXT,
       due TEXT,
       assignee TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       updated_by TEXT,
       done_at INTEGER,
       archived_at INTEGER
     );
   CREATE INDEX IF NOT EXISTS tasks_board ON tasks (status, rank);
   CREATE TABLE IF NOT EXISTS task_links (
       task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
       target TEXT NOT NULL,
       plugin_id TEXT,
       item_id TEXT NOT NULL,
       label TEXT NOT NULL,
       href TEXT,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (task_id, target, item_id)
     );
   CREATE TABLE IF NOT EXISTS task_handoffs (
       thread_id TEXT PRIMARY KEY,
       task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
       state TEXT NOT NULL,
       note TEXT,
       agent TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );
   CREATE INDEX IF NOT EXISTS task_handoffs_task ON task_handoffs (task_id, created_at);`,
  `ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'none';
   ALTER TABLE tasks ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE tasks ADD COLUMN parent_id TEXT REFERENCES tasks (id) ON DELETE SET NULL;
   ALTER TABLE tasks ADD COLUMN recurrence TEXT;
   ALTER TABLE tasks ADD COLUMN reminder_at INTEGER;
   CREATE INDEX tasks_parent ON tasks (parent_id);
   CREATE TABLE task_statuses (project_id TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (project_id, id));`,
  `ALTER TABLE tasks ADD COLUMN template INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE boards (
       id TEXT PRIMARY KEY,
       title TEXT NOT NULL,
       project_id TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       updated_by TEXT,
       archived_at INTEGER,
       template INTEGER NOT NULL DEFAULT 0
     );
   CREATE TABLE board_columns (board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE, id TEXT NOT NULL, label TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (board_id, id));
   ALTER TABLE tasks ADD COLUMN board_id TEXT REFERENCES boards (id) ON DELETE CASCADE;
   CREATE INDEX tasks_board_column ON tasks (board_id, status, rank);`,
];

export type BoardRow = {
  id: string;
  title: string;
  project_id: string | null;
  created_at: number;
  updated_at: number;
  updated_by: string | null;
  archived_at: number | null;
  template: number;
};

export type BoardColumn = { id: string; label: string };

export type TaskRow = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  rank: number;
  board_id: string;
  project_id: string | null;
  /** A day, "2026-10-01". */
  due: string | null;
  assignee: Assignee;
  priority: Priority;
  labels: string;
  parent_id: string | null;
  recurrence: Recurrence | null;
  reminder_at: number | null;
  created_at: number;
  updated_at: number;
  /** "user" or "agent". */
  updated_by: string | null;
  done_at: number | null;
  archived_at: number | null;
  template: number;
};

/** A link to a thread, or to another Studio item (a page, an artifact…). */
export type LinkRow = {
  task_id: string;
  target: "thread" | "item";
  /** The Studio add-on for an item; null for a thread. */
  plugin_id: string | null;
  item_id: string;
  label: string;
  href: string | null;
  created_at: number;
};

export type HandoffRow = {
  thread_id: string;
  task_id: string;
  state: HandoffState;
  /** The last reply's first line, the agent's own note, or the error. */
  note: string | null;
  /** "Claude · Opus 5.5", for the handoff list. */
  agent: string | null;
  created_at: number;
  updated_at: number;
};

/** The CLI counts as an agent: agents are its main users. */
export type Writer = Extract<Actor["kind"], "user" | "agent">;

export interface NewTask {
  title: string;
  description?: string;
  status?: TaskStatus;
  /** Without one, the project's main board. */
  boardId?: string;
  /** Without one, the board's project. */
  projectId?: string | null;
  due?: string | null;
  assignee?: Assignee;
  priority?: Priority;
  labels?: string[];
  parentId?: string | null;
  recurrence?: Recurrence | null;
  reminderAt?: number | null;
  by: Writer;
}

export interface TaskPatch {
  title?: string;
  description?: string;
  projectId?: string | null;
  due?: string | null;
  assignee?: Assignee;
  priority?: Priority;
  labels?: string[];
  parentId?: string | null;
  recurrence?: Recurrence | null;
  reminderAt?: number | null;
}

/** Ranks closer than this are spread out again. */
const MIN_GAP = 1e-6;

export function newTaskId(): string {
  return newId("tsk");
}

export function newBoardId(): string {
  return newId("brd");
}

/**
 * Before boards, columns belonged to a project, or were the defaults (key
 * ""). A project's first board starts with the columns it had.
 */
const LEGACY_DEFAULTS = "";

export class TaskStore {
  setTemplate(id: string, template: boolean): void {
    this.db.prepare("UPDATE tasks SET template = ? WHERE id = ?").run(template ? 1 : 0, id);
  }
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {
    db.pragma("foreign_keys = ON");
  }

  get(id: string): TaskRow | null {
    return (this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined) ?? null;
  }

  subtasks(id: string): { total: number; done: number } {
    return this.db.prepare("SELECT count(*) AS total, coalesce(sum(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done FROM tasks WHERE parent_id = ? AND archived_at IS NULL")
      .get(id) as { total: number; done: number };
  }

  // Boards ------------------------------------------------------------

  getBoard(id: string): BoardRow | null {
    return (this.db.prepare("SELECT * FROM boards WHERE id = ?").get(id) as BoardRow | undefined) ?? null;
  }

  boards(options: { includeArchived?: boolean } = {}): BoardRow[] {
    return this.db
      .prepare(`SELECT * FROM boards ${options.includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY created_at, rowid`)
      .all() as BoardRow[];
  }

  /** New boards start with the columns their project had before boards, else the defaults. */
  createBoard(input: { title: string; projectId: string | null; columns?: BoardColumn[]; by: Writer }): BoardRow {
    const at = this.now();
    const board: BoardRow = { id: newBoardId(), title: input.title.trim(), project_id: input.projectId, created_at: at, updated_at: at, updated_by: input.by, archived_at: null, template: 0 };
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO boards (id, title, project_id, created_at, updated_at, updated_by, archived_at, template)
        VALUES (@id, @title, @project_id, @created_at, @updated_at, @updated_by, @archived_at, @template)`).run(board);
      this.writeColumns(board.id, input.columns ?? this.legacyColumns(input.projectId));
    })();
    return board;
  }

  /** A board's title or project. Its tasks follow it to the new project. */
  updateBoard(id: string, patch: { title?: string; projectId?: string | null }, by: Writer): BoardRow {
    const board = this.mustGetBoard(id);
    const projectId = patch.projectId !== undefined ? patch.projectId : board.project_id;
    this.db.transaction(() => {
      this.db.prepare("UPDATE boards SET title = ?, project_id = ?, updated_at = ?, updated_by = ? WHERE id = ?")
        .run(patch.title !== undefined ? patch.title.trim() : board.title, projectId, this.now(), by, id);
      if (projectId !== board.project_id) this.db.prepare("UPDATE tasks SET project_id = ?, updated_at = ? WHERE board_id = ?").run(projectId, this.now(), id);
    })();
    return this.mustGetBoard(id);
  }

  setBoardArchived(id: string, archived: boolean): void {
    this.mustGetBoard(id);
    this.db.prepare("UPDATE boards SET archived_at = ?, updated_at = ? WHERE id = ?").run(archived ? this.now() : null, this.now(), id);
  }

  setBoardTemplate(id: string, template: boolean): void {
    this.db.prepare("UPDATE boards SET template = ? WHERE id = ?").run(template ? 1 : 0, id);
  }

  /** Deletes a board and its tasks. Returns the tasks it deleted. */
  deleteBoard(id: string): string[] {
    return this.db.transaction(() => {
      const tasks = (this.db.prepare("SELECT id FROM tasks WHERE board_id = ?").all(id) as { id: string }[]).map((row) => row.id);
      this.db.prepare("DELETE FROM tasks WHERE board_id = ?").run(id);
      this.db.prepare("DELETE FROM boards WHERE id = ?").run(id);
      return tasks;
    })();
  }

  /** The board a project's new tasks go to when no board is named: its first, made when it has none. */
  mainBoard(projectId: string | null, by: Writer = "user"): BoardRow {
    return this.findMainBoard(projectId) ?? this.createBoard({ title: "Tasks", projectId, by });
  }

  findMainBoard(projectId: string | null): BoardRow | null {
    return (this.db
      .prepare("SELECT * FROM boards WHERE project_id IS ? AND archived_at IS NULL AND template = 0 ORDER BY created_at, rowid LIMIT 1")
      .get(projectId) as BoardRow | undefined) ?? null;
  }

  /**
   * Puts tasks from before boards on their project's main board. Returns the
   * boards it made.
   */
  adoptLooseTasks(): BoardRow[] {
    const made: BoardRow[] = [];
    this.db.transaction(() => {
      const projects = this.db.prepare("SELECT DISTINCT project_id FROM tasks WHERE board_id IS NULL").all() as { project_id: string | null }[];
      for (const { project_id } of projects) {
        const existing = this.findMainBoard(project_id);
        const board = existing ?? this.mainBoard(project_id);
        if (!existing) made.push(board);
        this.db.prepare("UPDATE tasks SET board_id = ? WHERE board_id IS NULL AND project_id IS ?").run(board.id, project_id);
        this.remapStatuses(board.id, this.statuses(board.id));
      }
    })();
    return made;
  }

  /** Open and done tasks on each board, and how many are in each column. */
  boardCounts(id: string): { open: number; done: number; byStatus: Record<string, number> } {
    const rows = this.db.prepare("SELECT status, count(*) AS n FROM tasks WHERE board_id = ? AND archived_at IS NULL AND template = 0 GROUP BY status")
      .all(id) as { status: string; n: number }[];
    const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.n]));
    const done = byStatus.done ?? 0;
    return { open: rows.reduce((sum, row) => sum + row.n, 0) - done, done, byStatus };
  }

  /** Copies a board's columns and tasks, without their links or handoffs. */
  duplicateBoard(id: string, input: { title: string; projectId: string | null; render?: (value: string) => string; by: Writer }): BoardRow {
    const source = this.mustGetBoard(id);
    const render = input.render ?? ((value: string) => value);
    return this.db.transaction(() => {
      const board = this.createBoard({ title: input.title, projectId: input.projectId, columns: this.statuses(source.id), by: input.by });
      const tasks = this.db.prepare("SELECT * FROM tasks WHERE board_id = ? AND archived_at IS NULL ORDER BY rank, created_at").all(source.id) as TaskRow[];
      const copies = new Map<string, string>();
      // Parents first, so subtasks can point at their copies.
      const ordered = [...tasks.filter((task) => !task.parent_id), ...tasks.filter((task) => task.parent_id)];
      for (const task of ordered) {
        const copy = this.create({ title: render(task.title), description: render(task.description), status: task.status, boardId: board.id,
          due: task.due, assignee: task.assignee, priority: task.priority, labels: JSON.parse(task.labels) as string[],
          parentId: task.parent_id ? (copies.get(task.parent_id) ?? null) : null, recurrence: task.recurrence, by: input.by });
        this.db.prepare("UPDATE tasks SET rank = ? WHERE id = ?").run(task.rank, copy.id);
        copies.set(task.id, copy.id);
      }
      return board;
    })();
  }

  private mustGetBoard(id: string): BoardRow {
    const board = this.getBoard(id);
    if (!board) throw new Error(`Board ${id} not found.`);
    return board;
  }

  // Columns -------------------------------------------------------------

  private legacyColumns(projectId: string | null): BoardColumn[] {
    const read = (key: string) => this.db.prepare("SELECT id, label FROM task_statuses WHERE project_id = ? ORDER BY position").all(key) as BoardColumn[];
    const own = projectId ? read(projectId) : [];
    if (own.length) return own;
    const defaults = read(LEGACY_DEFAULTS);
    return defaults.length ? defaults : STATUSES.map((id) => ({ id, label: STATUS_LABELS[id]! }));
  }

  /** A board's columns, in order. */
  statuses(boardId: string | null): BoardColumn[] {
    const own = boardId ? (this.db.prepare("SELECT id, label FROM board_columns WHERE board_id = ? ORDER BY position").all(boardId) as BoardColumn[]) : [];
    return own.length ? own : STATUSES.map((id) => ({ id, label: STATUS_LABELS[id]! }));
  }

  /** The name of the column a task is in, as its board shows it. */
  statusLabel(task: Pick<TaskRow, "board_id" | "status">): string {
    return this.statuses(task.board_id).find((column) => column.id === task.status)?.label ?? STATUS_LABELS[task.status] ?? task.status;
  }

  /** Sets a board's columns. Tasks in a removed column move to the first one. */
  setStatuses(boardId: string, columns: BoardColumn[]): void {
    if (!columns.some((column) => column.id === "done")) throw new Error("A Done column is required.");
    if (new Set(columns.map((column) => column.id)).size !== columns.length) throw new Error("Column ids must be unique.");
    if (!columns.some((column) => column.id !== "done")) throw new Error("Add a column before Done.");
    this.mustGetBoard(boardId);
    this.db.transaction(() => {
      this.writeColumns(boardId, columns);
      this.remapStatuses(boardId, columns);
    })();
  }

  private writeColumns(boardId: string, columns: BoardColumn[]): void {
    this.db.prepare("DELETE FROM board_columns WHERE board_id = ?").run(boardId);
    const insert = this.db.prepare("INSERT INTO board_columns (board_id, id, label, position) VALUES (?, ?, ?, ?)");
    columns.forEach((column, index) => insert.run(boardId, column.id, column.label, index));
  }

  private remapStatuses(boardId: string, columns: { id: string }[]): void {
    const ids = columns.map((column) => column.id);
    const first = columns.find((column) => column.id !== "done")!.id;
    this.db.prepare(`UPDATE tasks SET status = ? WHERE board_id = ? AND status NOT IN (${ids.map(() => "?").join(", ")})`).run(first, boardId, ...ids);
  }

  // Tasks ---------------------------------------------------------------

  /** Board order: by status, then rank. With `boardId`, one board's tasks. */
  list(options: { includeArchived?: boolean; boardId?: string } = {}): TaskRow[] {
    const where = [options.includeArchived ? "" : "archived_at IS NULL", options.boardId ? "board_id = @boardId" : ""].filter(Boolean);
    return this.db
      .prepare(`SELECT * FROM tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY rank, created_at`)
      .all(options.boardId ? { boardId: options.boardId } : {}) as TaskRow[];
  }

  /** New tasks go to the top of their column. */
  create(input: NewTask): TaskRow {
    const parent = input.parentId ? this.mustGet(input.parentId) : null;
    // A subtask goes on its parent's board unless it names another.
    const board = input.boardId ? this.mustGetBoard(input.boardId) : parent ? this.mustGetBoard(parent.board_id) : this.mainBoard(input.projectId ?? null, input.by);
    const at = this.now();
    const status = input.status ?? this.statuses(board.id).find((column) => column.id !== "done")!.id;
    const task: TaskRow = {
      id: newTaskId(),
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      status,
      rank: this.edgeRank(board.id, status, "top"),
      board_id: board.id,
      project_id: input.projectId !== undefined ? input.projectId : board.project_id,
      due: input.due ?? null,
      assignee: input.assignee ?? null,
      priority: input.priority ?? "none",
      labels: JSON.stringify(input.labels ?? []),
      parent_id: input.parentId ?? null,
      recurrence: input.recurrence ?? null,
      reminder_at: input.reminderAt ?? null,
      created_at: at,
      updated_at: at,
      updated_by: input.by,
      done_at: status === "done" ? at : null,
      archived_at: null,
      template: 0,
    };
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, description, status, rank, board_id, project_id, due, assignee, priority, labels, parent_id, recurrence, reminder_at, created_at, updated_at, updated_by, done_at, archived_at)
         VALUES (@id, @title, @description, @status, @rank, @board_id, @project_id, @due, @assignee, @priority, @labels, @parent_id, @recurrence, @reminder_at, @created_at, @updated_at, @updated_by, @done_at, @archived_at)`,
      )
      .run(task);
    return task;
  }

  update(id: string, patch: TaskPatch, by: Writer): TaskRow {
    const task = this.mustGet(id);
    if (patch.parentId) {
      let parent: TaskRow | null = this.mustGet(patch.parentId);
      while (parent) {
        if (parent.id === id) throw new Error("A task cannot be its own subtask.");
        parent = parent.parent_id ? this.get(parent.parent_id) : null;
      }
    }
    const next = {
      title: patch.title !== undefined ? patch.title.trim() : task.title,
      description: patch.description !== undefined ? patch.description.trim() : task.description,
      project_id: patch.projectId !== undefined ? patch.projectId : task.project_id,
      due: patch.due !== undefined ? patch.due : task.due,
      assignee: patch.assignee !== undefined ? patch.assignee : task.assignee,
      priority: patch.priority ?? task.priority,
      labels: patch.labels !== undefined ? JSON.stringify(patch.labels) : task.labels,
      parent_id: patch.parentId !== undefined ? patch.parentId : task.parent_id,
      recurrence: patch.recurrence !== undefined ? patch.recurrence : task.recurrence,
      reminder_at: patch.reminderAt !== undefined ? patch.reminderAt : task.reminder_at,
    };
    this.db
      .prepare(
        `UPDATE tasks SET title = @title, description = @description, project_id = @project_id, due = @due,
           assignee = @assignee, priority = @priority, labels = @labels, parent_id = @parent_id,
           recurrence = @recurrence, reminder_at = @reminder_at, updated_at = @at, updated_by = @by WHERE id = @id`,
      )
      .run({ ...next, id, at: this.now(), by });
    return this.mustGet(id);
  }

  /**
   * Puts a task in a column. With `index`, at that position among the
   * column's other tasks (0 is the top); without, at the top, or where it is
   * when the status doesn't change.
   */
  move(id: string, status: TaskStatus, by: Writer, index?: number): TaskRow {
    const task = this.mustGet(id);
    return this.db.transaction(() => {
      let rank = task.rank;
      if (index !== undefined) rank = this.rankAt(task.board_id, status, index, id);
      else if (status !== task.status) rank = this.edgeRank(task.board_id, status, "top");
      const doneAt = status === "done" ? (task.status === "done" ? task.done_at : this.now()) : null;
      this.db
        .prepare("UPDATE tasks SET status = ?, rank = ?, done_at = ?, updated_at = ?, updated_by = ? WHERE id = ?")
        .run(status, rank, doneAt, this.now(), by, id);
      return this.mustGet(id);
    })();
  }

  /**
   * Puts a task on another board, at the top of the column with the same id,
   * else the board's first. Its subtasks go with it.
   */
  moveToBoard(id: string, boardId: string, by: Writer): string[] {
    const board = this.mustGetBoard(boardId);
    const moved: string[] = [];
    this.db.transaction(() => {
      const visit = (taskId: string) => {
        const task = this.mustGet(taskId);
        if (task.board_id === board.id) return;
        const columns = this.statuses(board.id);
        const status = columns.some((column) => column.id === task.status) ? task.status : columns.find((column) => column.id !== "done")!.id;
        this.db.prepare("UPDATE tasks SET board_id = ?, project_id = ?, status = ?, rank = ?, updated_at = ?, updated_by = ? WHERE id = ?")
          .run(board.id, board.project_id, status, this.edgeRank(board.id, status, "top"), this.now(), by, taskId);
        moved.push(taskId);
        for (const child of this.db.prepare("SELECT id FROM tasks WHERE parent_id = ?").all(taskId) as { id: string }[]) visit(child.id);
      };
      visit(id);
    })();
    return moved;
  }

  /** Completion creates the next instance once, with its own due day. */
  completeRecurring(task: TaskRow, by: Writer): TaskRow | null {
    if (!task.recurrence || !task.due) return null;
    return this.create({ title: task.title, description: task.description, boardId: task.board_id, projectId: task.project_id,
      due: nextDue(task.due, task.recurrence), assignee: task.assignee, priority: task.priority,
      labels: JSON.parse(task.labels) as string[], parentId: task.parent_id,
      recurrence: task.recurrence, reminderAt: null, by });
  }

  setArchived(id: string, archived: boolean): void {
    this.mustGet(id);
    this.db.prepare("UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ?").run(archived ? this.now() : null, this.now(), id);
  }

  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id).changes > 0;
  }

  // Links -------------------------------------------------------------

  links(taskId: string): LinkRow[] {
    return this.db.prepare("SELECT * FROM task_links WHERE task_id = ? ORDER BY created_at").all(taskId) as LinkRow[];
  }

  /** Adds a link, or relabels it when it's already there. */
  link(taskId: string, link: Omit<LinkRow, "task_id" | "created_at">): void {
    this.mustGet(taskId);
    this.db
      .prepare(
        `INSERT INTO task_links (task_id, target, plugin_id, item_id, label, href, created_at)
         VALUES (@task_id, @target, @plugin_id, @item_id, @label, @href, @created_at)
         ON CONFLICT (task_id, target, item_id) DO UPDATE SET label = excluded.label, href = excluded.href`,
      )
      .run({ ...link, task_id: taskId, created_at: this.now() });
  }

  unlink(taskId: string, target: LinkRow["target"], itemId: string): boolean {
    return this.db.prepare("DELETE FROM task_links WHERE task_id = ? AND target = ? AND item_id = ?").run(taskId, target, itemId).changes > 0;
  }

  /** Keeps a thread link's label in step with the thread's title. Returns the tasks it changed. */
  relabelThread(threadId: string, label: string): string[] {
    const rows = this.db
      .prepare("SELECT task_id FROM task_links WHERE target = 'thread' AND item_id = ? AND label != ?")
      .all(threadId, label) as { task_id: string }[];
    if (rows.length) this.db.prepare("UPDATE task_links SET label = ? WHERE target = 'thread' AND item_id = ?").run(label, threadId);
    return rows.map((row) => row.task_id);
  }

  // Handoffs ------------------------------------------------------------

  handoffs(taskId: string): HandoffRow[] {
    return this.db.prepare("SELECT * FROM task_handoffs WHERE task_id = ? ORDER BY created_at DESC, rowid DESC").all(taskId) as HandoffRow[];
  }

  handoff(threadId: string): HandoffRow | null {
    return (this.db.prepare("SELECT * FROM task_handoffs WHERE thread_id = ?").get(threadId) as HandoffRow | undefined) ?? null;
  }

  latestHandoff(taskId: string): HandoffRow | null {
    return this.handoffs(taskId)[0] ?? null;
  }

  /** Every handoff whose thread may still change: for reconciling after a restart. */
  openHandoffs(): HandoffRow[] {
    return this.db.prepare("SELECT * FROM task_handoffs WHERE state NOT IN ('archived', 'deleted')").all() as HandoffRow[];
  }

  addHandoff(taskId: string, threadId: string, agent: string | null): HandoffRow {
    this.mustGet(taskId);
    const at = this.now();
    this.db
      .prepare(
        `INSERT INTO task_handoffs (thread_id, task_id, state, note, agent, created_at, updated_at)
         VALUES (?, ?, 'starting', NULL, ?, ?, ?)`,
      )
      .run(threadId, taskId, agent, at, at);
    return this.handoff(threadId)!;
  }

  setHandoff(threadId: string, state: HandoffState, note: string | null): void {
    this.db.prepare("UPDATE task_handoffs SET state = ?, note = ?, updated_at = ? WHERE thread_id = ?").run(state, note, this.now(), threadId);
  }

  // Ranks ---------------------------------------------------------------

  private mustGet(id: string): TaskRow {
    const task = this.get(id);
    if (!task) throw new Error(`Task ${id} not found.`);
    return task;
  }

  private column(boardId: string, status: TaskStatus, except?: string): { id: string; rank: number }[] {
    return this.db
      .prepare("SELECT id, rank FROM tasks WHERE board_id = ? AND status = ? AND id != ? AND archived_at IS NULL ORDER BY rank, created_at")
      .all(boardId, status, except ?? "") as { id: string; rank: number }[];
  }

  private edgeRank(boardId: string, status: TaskStatus, edge: "top" | "bottom"): number {
    const column = this.column(boardId, status);
    if (!column.length) return 0;
    return edge === "top" ? column[0]!.rank - 1 : column[column.length - 1]!.rank + 1;
  }

  /** The rank that puts a task at `index` among the column's other tasks. */
  private rankAt(boardId: string, status: TaskStatus, index: number, except: string): number {
    let column = this.column(boardId, status, except);
    const at = Math.max(0, Math.min(index, column.length));
    const between = () => {
      const before = column[at - 1];
      const after = column[at];
      if (!before && !after) return 0;
      if (!before) return after!.rank - 1;
      if (!after) return before.rank + 1;
      return after.rank - before.rank < MIN_GAP ? null : (before.rank + after.rank) / 2;
    };
    const rank = between();
    if (rank !== null) return rank;
    // Too close to split: spread the column out and try again.
    const spread = this.db.prepare("UPDATE tasks SET rank = ? WHERE id = ?");
    column.forEach((row, position) => spread.run(position, row.id));
    column = this.column(boardId, status, except);
    return between()!;
  }
}
