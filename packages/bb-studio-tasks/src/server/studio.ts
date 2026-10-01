// Tasks as a Studio add-on: the `studio_*` methods Studio calls to list and
// manage tasks in its collection.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { copyTitle, eachId, fillTemplate, type StudioBadge, type StudioItem, type StudioKind, type StudioSchemas } from "@bb-studio/kit/contract";
import { createStoreProvider, mustGet as requireItem } from "@bb-studio/kit/server";
import {
  HANDOFF_SHORT,
  HANDOFF_TONES,
  PLUGIN_ID,
  STATUSES,
  STATUS_LABELS,
  TASK_ICON,
  formatDue,
  isOpenHandoff,
  isOverdue,
  taskHref,
  type TaskStatus,
} from "../shared";
import { firstLine } from "./handoff";
import type { HandoffRow, TaskRow, TaskStore } from "./store";

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

export function taskBadge(task: TaskRow, handoff: HandoffRow | null): StudioBadge {
  if (handoff && task.status !== "done" && isOpenHandoff(handoff.state) && LOUD.has(handoff.state)) {
    return { label: HANDOFF_SHORT[handoff.state], tone: HANDOFF_TONES[handoff.state] };
  }
  if (task.due && isOverdue(task.due, task.status)) return { label: "Overdue", tone: "danger" };
  return { label: STATUS_LABELS[task.status] ?? task.status, tone: STATUS_TONES[task.status] ?? "neutral" };
}

export function toStudioItem(task: TaskRow, handoff: HandoffRow | null): StudioItem {
  return {
    id: task.id,
    kind: TASK_KIND.id,
    title: task.title,
    icon: null,
    projectId: task.project_id,
    parentId: null,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    updatedBy: task.updated_by === "user" || task.updated_by === "agent" ? task.updated_by : null,
    preview: firstLine(task.description) ?? handoff?.note ?? null,
    facts: [
      { id: "status", value: STATUS_LABELS[task.status] ?? task.status, sort: (STATUSES as readonly string[]).indexOf(task.status) },
      { id: "due", value: task.due ? formatDue(task.due) : "", sort: task.due ? Date.parse(`${task.due}T00:00:00Z`) : null },
      { id: "assignee", value: assigneeLabel(task), sort: task.assignee === "me" ? 0 : task.assignee === "agent" ? 1 : null },
    ],
    badge: taskBadge(task, handoff),
    thumbnailUrl: null,
    href: taskHref(task.id),
    archived: task.archived_at !== null,
    template: Boolean(task.template),
  };
}

export function registerStudio(
  bb: Pick<BbPluginApi, "rpc">,
  schemas: StudioSchemas,
  deps: {
    store: TaskStore;
    changed(id: string): void;
    /** Moves a task the way the board does, archiving its threads on Done when that's on. */
    move(id: string, status: TaskStatus): Promise<void>;
  },
): void {
  const { store } = deps;
  const mustGet = (id: string) => requireItem((key) => store.get(key), id, "Task not found.");
  const duplicate = (id: string, projectId: string | null, variables?: Record<string, string>) => {
    const source = mustGet(id);
    const render = (value: string) => variables ? fillTemplate(value, variables) : value;
    const row = store.create({ title: render(variables ? source.title : copyTitle(source.title)), description: render(source.description),
      projectId, due: source.due, assignee: source.assignee, priority: source.priority,
      labels: JSON.parse(source.labels) as string[], by: "user" });
    deps.changed(row.id);
    return toStudioItem(row, null);
  };

  createStoreProvider(bb, schemas, {
    studio_describe: () => ({ pluginId: PLUGIN_ID, version: 2, panel: "tasks", kinds: [TASK_KIND] }),
    studio_get: ({ ids }) => ({ items: ids.flatMap((id) => { const row = store.get(id); return row ? [toStudioItem(row, store.latestHandoff(id))] : []; }) }),
    studio_read: ({ id }) => { const row = store.get(id); return { content: row ? [`# ${row.title}`, row.description].filter(Boolean).join("\n\n") : null }; },
    studio_list: () => ({
      items: store.list({ includeArchived: true }).map((task) => toStudioItem(task, store.latestHandoff(task.id))),
    }),
    studio_create: ({ kind, projectId }) => {
      if (kind !== TASK_KIND.id) throw new Error(`Tasks can't make a "${kind}".`);
      const task = store.create({ title: "", projectId, by: "user" });
      deps.changed(task.id);
      return { item: toStudioItem(task, null) };
    },
    studio_duplicate: ({ id, projectId }) => ({ item: duplicate(id, projectId) }),
    studio_template: ({ id, template }) => { mustGet(id); store.setTemplate(id, template); deps.changed(id); return { item: toStudioItem(mustGet(id), store.latestHandoff(id)) }; },
    studio_instantiate: ({ id, projectId, variables }) => { if (!mustGet(id).template) throw new Error("Task is not a template."); return { item: duplicate(id, projectId, variables) }; },
    studio_export: ({ id, format }) => {
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
    move: (id: string, projectId: string | null) => {
      mustGet(id);
      store.update(id, { projectId }, "user");
      deps.changed(id);
    },
    archive: (id: string, archived: boolean) => {
      store.setArchived(id, archived);
      deps.changed(id);
    },
    delete: (id: string) => {
      mustGet(id);
      store.delete(id);
      deps.changed(id);
    },
  }, {
    find: (query) => store.list()
      .map((task) => ({ id: task.id, text: [task.description, ...store.handoffs(task.id).map((handoff) => handoff.note)].filter(Boolean).join("\n") }))
      .filter((task) => task.text.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 200),
    text: (task) => task.text,
  });
}
