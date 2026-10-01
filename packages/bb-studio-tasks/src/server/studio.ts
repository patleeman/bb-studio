// Tasks as a Studio add-on: the `studio_*` methods Studio calls to list and
// manage boards and tasks in its collection. A task's parent is its board.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { copyTitle, eachId, fillTemplate, type StudioBadge, type StudioItem, type StudioKind, type StudioSchemas } from "@bb-studio/kit/contract";
import { createStoreProvider, mustGet as requireItem } from "@bb-studio/kit/server";
import {
  BOARD_ICON,
  HANDOFF_SHORT,
  HANDOFF_TONES,
  PLUGIN_ID,
  STATUS_LABELS,
  TASK_ICON,
  boardHref,
  formatDue,
  isBoardId,
  isOpenHandoff,
  isOverdue,
  taskHref,
  type TaskStatus,
} from "../shared";
import { firstLine } from "./handoff";
import type { BoardColumn, BoardRow, HandoffRow, TaskRow, TaskStore } from "./store";

export const BOARD_KIND: StudioKind = {
  id: "board",
  label: "Board",
  plural: "Boards",
  icon: BOARD_ICON,
  columns: [
    { id: "open", label: "Open" },
    { id: "done", label: "Done" },
  ],
  actions: [],
  create: { mode: "rpc" },
  canArchive: true,
  capabilities: { create: true, move: true, archive: true, delete: true, rename: true, duplicate: true, export: true, comments: false, versions: false, links: true, templates: true },
  blurb: "Columns of tasks, for you or an agent.",
  agentHint: "List its tasks with tasks_list and its boardId, and add one with tasks_create.",
};

export const TASK_KIND: StudioKind = {
  id: "task",
  label: "Task",
  plural: "Tasks",
  icon: TASK_ICON,
  columns: [
    { id: "status", label: "Status" },
    { id: "due", label: "Due" },
    { id: "assignee", label: "Assignee" },
  ],
  actions: [
    { id: "mark-done", label: "Mark {count} done", icon: "CircleCheck", result: "toast" },
    { id: "reopen", label: "Move {count} to To do", icon: "RotateCcw", result: "toast" },
  ],
  create: { mode: "rpc" },
  canArchive: true,
  capabilities: { create: true, move: true, archive: true, delete: true, rename: true, duplicate: true, export: true, comments: false, versions: false, links: true, templates: true },
  mentionProviderId: "task",

  blurb: "Things to do, for you or an agent.",
  agentHint: "Read it with tasks_get and change it with tasks_update.",
};

const STATUS_TONES: Record<string, StudioBadge["tone"]> = {
  todo: "neutral",
  in_progress: "progress",
  review: "warning",
  done: "success",
};

/** Handoff states worth a badge instead of the status. */
const LOUD = new Set(["working", "needs-input", "failed"]);

export function assigneeLabel(task: Pick<TaskRow, "assignee">): string {
  return task.assignee === "me" ? "Me" : task.assignee === "agent" ? "Agent" : task.assignee?.startsWith("bot:") ? "Bot" : "Unassigned";
}

export function taskBadge(task: TaskRow, handoff: HandoffRow | null, statusLabel = STATUS_LABELS[task.status] ?? task.status): StudioBadge {
  if (handoff && task.status !== "done" && isOpenHandoff(handoff.state) && LOUD.has(handoff.state)) {
    return { label: HANDOFF_SHORT[handoff.state], tone: HANDOFF_TONES[handoff.state] };
  }
  if (task.due && isOverdue(task.due, task.status)) return { label: "Overdue", tone: "danger" };
  return { label: statusLabel, tone: STATUS_TONES[task.status] ?? "neutral" };
}

/** `columns` is the task's board, which names and orders its status. */
export function toStudioItem(task: TaskRow, handoff: HandoffRow | null, columns: readonly { id: string; label: string }[]): StudioItem {
  const column = columns.findIndex((each) => each.id === task.status);
  const statusLabel = columns[column]?.label ?? STATUS_LABELS[task.status] ?? task.status;
  return {
    id: task.id,
    kind: TASK_KIND.id,
    title: task.title,
    icon: null,
    projectId: task.project_id,
    parentId: task.board_id,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    updatedBy: task.updated_by === "user" || task.updated_by === "agent" ? task.updated_by : null,
    preview: firstLine(task.description) ?? handoff?.note ?? null,
    facts: [
      { id: "status", value: statusLabel, sort: column },
      { id: "due", value: task.due ? formatDue(task.due) : "", sort: task.due ? Date.parse(`${task.due}T00:00:00Z`) : null },
      { id: "assignee", value: assigneeLabel(task), sort: task.assignee === "me" ? 0 : task.assignee === "agent" ? 1 : null },
    ],
    badge: taskBadge(task, handoff, statusLabel),
    thumbnailUrl: null,
    href: taskHref(task.id),
    archived: task.archived_at !== null,
    template: Boolean(task.template),
  };
}

/** "To do 3 · In progress 1": the board's columns that have tasks. */
export function boardSummary(columns: readonly BoardColumn[], byStatus: Record<string, number>): string {
  return columns.filter((column) => byStatus[column.id]).map((column) => `${column.label} ${byStatus[column.id]}`).join(" · ");
}

export function boardToStudioItem(board: BoardRow, columns: readonly BoardColumn[], counts: { open: number; done: number; byStatus: Record<string, number> }): StudioItem {
  return {
    id: board.id,
    kind: BOARD_KIND.id,
    title: board.title,
    icon: null,
    projectId: board.project_id,
    parentId: null,
    createdAt: board.created_at,
    updatedAt: board.updated_at,
    updatedBy: board.updated_by === "user" || board.updated_by === "agent" ? board.updated_by : null,
    preview: boardSummary(columns, counts.byStatus) || null,
    facts: [
      { id: "open", value: String(counts.open), sort: counts.open },
      { id: "done", value: String(counts.done), sort: counts.done },
    ],
    badge: null,
    thumbnailUrl: null,
    href: boardHref(board.id),
    archived: board.archived_at !== null,
    template: Boolean(board.template),
  };
}

/** A board as Markdown: each column and its tasks. */
export function boardMarkdown(store: TaskStore, board: BoardRow): string {
  const tasks = store.list({ boardId: board.id });
  const sections = store.statuses(board.id).map((column) => {
    const rows = tasks.filter((task) => task.status === column.id);
    return `## ${column.label}\n\n${rows.length ? rows.map((task) => `- [${task.status === "done" ? "x" : " "}] ${task.title || "Untitled task"}`).join("\n") : "_No tasks_"}`;
  });
  return [`# ${board.title || "Untitled board"}`, ...sections].join("\n\n");
}

export function registerStudio(
  bb: Pick<BbPluginApi, "rpc">,
  schemas: StudioSchemas,
  deps: {
    store: TaskStore;
    /** A task or a board changed. */
    changed(id: string): void;
    /** Moves a task the way the board does, archiving its threads on Done when that's on. */
    move(id: string, status: TaskStatus): Promise<void>;
  },
): void {
  const { store } = deps;
  const item = (task: TaskRow, handoff: HandoffRow | null) => toStudioItem(task, handoff, store.statuses(task.board_id));
  const boardItem = (board: BoardRow) => boardToStudioItem(board, store.statuses(board.id), store.boardCounts(board.id));
  /** A board or a task, as Studio lists it. */
  const anyItem = (id: string) => {
    if (isBoardId(id)) { const board = store.getBoard(id); return board ? boardItem(board) : null; }
    const task = store.get(id);
    return task ? item(task, store.latestHandoff(id)) : null;
  };
  const mustGet = (id: string) => requireItem((key) => store.get(key), id, "Task not found.");
  const mustGetBoard = (id: string) => requireItem((key) => store.getBoard(key), id, "Board not found.");
  const duplicate = (id: string, projectId: string | null, variables?: Record<string, string>) => {
    const render = (value: string) => variables ? fillTemplate(value, variables) : value;
    if (isBoardId(id)) {
      const source = mustGetBoard(id);
      const board = store.duplicateBoard(id, { title: variables ? render(source.title) : copyTitle(source.title), projectId, render: variables ? render : undefined, by: "user" });
      deps.changed(board.id);
      return boardItem(board);
    }
    const source = mustGet(id);
    // A copy stays on its board, unless it moves to another project.
    const boardId = projectId === source.project_id && !variables ? source.board_id : undefined;
    const row = store.create({ title: render(variables ? source.title : copyTitle(source.title)), description: render(source.description),
      boardId, projectId, due: source.due, assignee: source.assignee, priority: source.priority,
      labels: JSON.parse(source.labels) as string[], by: "user" });
    deps.changed(row.id);
    return item(row, null);
  };

  createStoreProvider(bb, schemas, {
    studio_describe: () => ({ pluginId: PLUGIN_ID, version: 2, panel: "tasks", kinds: [BOARD_KIND, TASK_KIND] }),
    studio_get: ({ ids }) => ({ items: ids.flatMap((id) => anyItem(id) ?? []) }),
    studio_read: ({ id, format }) => {
      if (isBoardId(id)) { const board = store.getBoard(id); return { content: board ? boardMarkdown(store, board) : null }; }
      const row = store.get(id);
      return { content: row ? [format === "markdown" ? `# ${row.title}` : row.title, row.description].filter(Boolean).join("\n\n") : null };
    },
    studio_list: () => ({
      items: [
        ...store.boards({ includeArchived: true }).map(boardItem),
        ...store.list({ includeArchived: true }).map((task) => item(task, store.latestHandoff(task.id))),
      ],
    }),
    studio_create: ({ kind, projectId }) => {
      if (kind === BOARD_KIND.id) {
        const board = store.createBoard({ title: "", projectId, by: "user" });
        deps.changed(board.id);
        return { item: boardItem(board) };
      }
      if (kind !== TASK_KIND.id) throw new Error(`Tasks can't make a "${kind}".`);
      const task = store.create({ title: "", projectId, by: "user" });
      deps.changed(task.id);
      return { item: item(task, null) };
    },
    studio_duplicate: ({ id, projectId }) => ({ item: duplicate(id, projectId) }),
    studio_template: ({ id, template }) => {
      if (isBoardId(id)) { mustGetBoard(id); store.setBoardTemplate(id, template); }
      else { mustGet(id); store.setTemplate(id, template); }
      deps.changed(id);
      return { item: anyItem(id)! };
    },
    studio_instantiate: ({ id, projectId, variables }) => {
      if (!(isBoardId(id) ? mustGetBoard(id) : mustGet(id)).template) throw new Error(isBoardId(id) ? "Board is not a template." : "Task is not a template.");
      return { item: duplicate(id, projectId, variables) };
    },
    studio_export: ({ id, format }) => {
      if (isBoardId(id)) {
        const board = mustGetBoard(id);
        const name = board.title || "Untitled board";
        if (format === "markdown") return { files: [{ name: `${name}.md`, mime: "text/markdown", data: Buffer.from(`${boardMarkdown(store, board)}\n`).toString("base64") }] };
        if (format === "csv") {
          const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
          const rows = store.list({ boardId: id }).map((task) => [task.title, task.description, store.statusLabel(task), task.due ?? "", task.assignee ?? "", task.priority].map(cell).join(","));
          return { files: [{ name: `${name}.csv`, mime: "text/csv", data: Buffer.from(["title,description,status,due,assignee,priority", ...rows].join("\r\n")).toString("base64") }] };
        }
        throw new Error(`Unsupported board format: ${format}`);
      }
      const row = mustGet(id);
      if (format === "markdown") return { files: [{ name: `${row.title || "Untitled task"}.md`, mime: "text/markdown", data: Buffer.from(`# ${row.title}\n\n${row.description}\n`).toString("base64") }] };
      if (format === "csv") {
        const csv = ["title,description,status,due,assignee", [row.title, row.description, row.status, row.due ?? "", row.assignee ?? ""].map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")].join("\r\n");
        return { files: [{ name: `${row.title || "Untitled task"}.csv`, mime: "text/csv", data: Buffer.from(csv).toString("base64") }] };
      }
      throw new Error(`Unsupported task format: ${format}`);
    },
    studio_action: async ({ action, ids }) => {
      if (action !== "mark-done" && action !== "reopen") throw new Error(`Unknown action "${action}".`);
      const status: TaskStatus = action === "mark-done" ? "done" : "todo";
      const { done } = await eachId(ids, async (id) => {
        mustGet(id);
        await deps.move(id, status);
      });
      const count = done.length === 1 ? "1 task" : `${done.length} tasks`;
      return { message: action === "mark-done" ? `Marked ${count} done` : `Moved ${count} to To do`, text: null };
    },
  }, {
    // A board takes its tasks along; a task goes to the project's main board.
    move: (id: string, projectId: string | null) => {
      if (isBoardId(id)) {
        mustGetBoard(id);
        store.updateBoard(id, { projectId }, "user");
        deps.changed(id);
        for (const task of store.list({ boardId: id, includeArchived: true })) deps.changed(task.id);
        return;
      }
      const task = mustGet(id);
      if (task.project_id === projectId) return;
      const board = store.mainBoard(projectId);
      for (const moved of store.moveToBoard(id, board.id, "user")) deps.changed(moved);
      deps.changed(task.board_id);
    },
    archive: (id: string, archived: boolean) => {
      if (isBoardId(id)) store.setBoardArchived(id, archived);
      else store.setArchived(id, archived);
      deps.changed(id);
    },
    delete: (id: string) => {
      if (isBoardId(id)) {
        mustGetBoard(id);
        for (const task of store.deleteBoard(id)) deps.changed(task);
      } else {
        mustGet(id);
        store.delete(id);
      }
      deps.changed(id);
    },
  }, {
    find: (query) => [
      ...store.boards().map((board) => ({ id: board.id, text: store.list({ boardId: board.id }).map((task) => task.title).join("\n") })),
      ...store.list().map((task) => ({ id: task.id, text: [task.description, ...store.handoffs(task.id).map((handoff) => handoff.note)].filter(Boolean).join("\n") })),
    ]
      .filter((each) => each.text.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 200),
    text: (task) => task.text,
  });
}
