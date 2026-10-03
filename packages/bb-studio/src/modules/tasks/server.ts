import { OfficeTaskSchedules } from "../../office/scheduling";
import { TaskReportOutbox } from "../../office/report-outbox";
import { parseFlags, subcommand } from "@bb-studio/kit/cli";
export { parseFlags } from "@bb-studio/kit/cli";
import { defineItemMention } from "@bb-studio/kit/server";
import { errorMessage, untitled } from "@bb-studio/kit/format";
import { pageCheckboxes, setPageCheckbox } from "@bb-studio/kit/page-checkbox";
// Studio Tasks (plugin id `studio-tasks`): boards of tasks you can hand to agents.
//
// Backend entry. Boards and their tasks live in the plugin's SQLite database
// (src/server/store.ts). Each project has a main board, where tasks go when
// no board is named. Handing a task off spawns a thread with the task as
// its first message (src/server/prompt.ts); BB's thread events then move the
// handoff and its task between In progress and Review
// (src/server/handoff.ts). With BB Studio installed, tasks list in Studio's
// collection (src/server/studio.ts), boards as well as tasks.
import { studioSchemas } from "@bb-studio/kit/contract";
import { createChangeBus } from "@bb-studio/kit/server";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { mentionContext } from "./lib/mention";
import { firstLine, nextHandoff, type ThreadSignal } from "./src/server/handoff";
import { handoffInput } from "./src/server/prompt";
import { primaryHostId } from "@bb-studio/kit/server";
import { assigneeLabel, boardSummary, registerStudio } from "./src/server/studio";
import { MIGRATIONS, TaskStore, type BoardRow, type HandoffRow, type LinkRow, type TaskRow, type Writer } from "./src/server/store";
import { studioServices } from "@bb-studio/kit/server";
import {
  HANDOFF_LABELS,
  HANDOFF_STATES,
  PLUGIN_ID,
  REALTIME_CHANNEL,
  PRIORITIES,
  RECURRENCES,
  TASK_UPDATE_TYPE,
  boardHref,
  columnId,
  formatDue,
  isBoardId,
  isDay,
  isOpenHandoff,
  isStatus,
  studioHref,
  taskHref,
  type TaskStatus,
} from "./src/shared";

/** The other Studio add-ons whose items a task can link to. */
const LINKABLE_PLUGINS = ["pages", "talk", "excalidraw", "artifacts"];

const idSchema = z.string().min(1).max(100);
const boardIdSchema = z.string().refine(isBoardId, "Use a board id, like brd_….");
const threadIdSchema = z.string().min(1).max(200);
const projectIdSchema = z.string().min(1).max(200);
const statusSchema = z.string().min(1).max(60).regex(/^[a-z][a-z0-9_-]*$/);
const assigneeSchema = z.string().refine((value) => value === "me" || value === "agent" || /^bot:[a-zA-Z0-9_-]+$/.test(value), "Use me, agent or bot:<id>.").nullable();
const daySchema = z.string().refine(isDay, "Use a day like 2026-10-01.").nullable();
const prioritySchema = z.enum(PRIORITIES);
const recurrenceSchema = z.enum(RECURRENCES).nullable();
const labelsSchema = z.array(z.string().trim().min(1).max(60)).max(20);
const fieldsSchema = {
  priority: prioritySchema.optional(), labels: labelsSchema.optional(), parentId: idSchema.nullable().optional(),
  recurrence: recurrenceSchema.optional(), reminderAt: z.number().int().nonnegative().nullable().optional(),
};

/** A new worktree keeps the agent's changes apart; "folder" works in the project's folder. */
const workspaceSchema = z.enum(["worktree", "folder"]);

const handoffSchema = z.object({
  threadId: z.string(),
  state: z.enum(HANDOFF_STATES),
  note: z.string().nullable(),
  agent: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: statusSchema,
  /** The status's column name on the task's board. */
  statusLabel: z.string(),
  boardId: z.string(),
  projectId: z.string().nullable(),
  due: z.string().nullable(),
  assignee: assigneeSchema,
  priority: prioritySchema,
  labels: labelsSchema,
  parentId: z.string().nullable(),
  subtasks: z.object({ total: z.number(), done: z.number() }),
  recurrence: recurrenceSchema,
  schedule: z.string().nullable().optional(),
  reminderAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  updatedBy: z.string().nullable(),
  doneAt: z.number().nullable(),
  archived: z.boolean(),
  /** The newest handoff, which is the one that moves the task. */
  handoff: handoffSchema.nullable(),
  /** Handoffs whose thread is still around (not archived or deleted). */
  openThreads: z.number(),
  links: z.number(),
});

const linkSchema = z.object({
  target: z.enum(["thread", "item"]),
  pluginId: z.string().nullable(),
  itemId: z.string(),
  label: z.string(),
  href: z.string().nullable(),
});

const linkableSchema = linkSchema.extend({ kind: z.string(), icon: z.string().nullable() });

const columnSchema = z.object({ id: statusSchema, label: z.string() });
const columnsInput = z.array(z.object({ id: statusSchema, label: z.string().trim().min(1).max(60) })).min(2).max(12);

const boardSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  columns: z.array(columnSchema),
  open: z.number(),
  done: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archived: z.boolean(),
  template: z.boolean(),
});

export const rpcContract = defineRpcContract({
  /** Explicitly tracks an Explore finding; lookup never creates work. */
  trackFinding: {
    input: z.object({ key: z.string().min(1).max(200), threadId: threadIdSchema, messageId: z.string().min(1).max(200), title: z.string().trim().min(1).max(300), pageId: idSchema.nullable().optional(), create: z.boolean().default(false) }),
    output: z.object({ task: taskSchema.nullable() }),
  },
  boards: {
    input: z.object({ includeArchived: z.boolean().optional() }),
    output: z.object({ boards: z.array(boardSchema) }),
  },
  /** One board and its tasks, or without `boardId` every task. */
  board: {
    input: z.object({ boardId: idSchema.optional(), includeArchived: z.boolean().optional() }),
    output: z.object({ board: boardSchema.nullable(), tasks: z.array(taskSchema) }),
  },
  boardCreate: { input: z.object({ title: z.string().trim().max(200), projectId: projectIdSchema.nullable() }), output: z.object({ board: boardSchema }) },
  /** Renames a board, or moves it and its tasks to another project. */
  boardUpdate: { input: z.object({ id: idSchema, title: z.string().trim().max(200).optional(), projectId: projectIdSchema.nullable().optional() }), output: z.object({ ok: z.boolean() }) },
  boardArchive: { input: z.object({ id: idSchema, archived: z.boolean() }), output: z.object({ ok: z.boolean() }) },
  /** Deletes a board and its tasks. */
  boardDelete: { input: z.object({ id: idSchema }), output: z.object({ ok: z.boolean() }) },
  /** A board's columns. Given a project instead, its main board's (or the defaults, when it has none). */
  statuses: { input: z.object({ boardId: idSchema.optional(), projectId: projectIdSchema.nullable().optional() }), output: z.object({ columns: z.array(columnSchema) }) },
  setStatuses: { input: z.object({ boardId: idSchema, columns: columnsInput }), output: z.object({ ok: z.boolean() }) },
  get: {
    input: z.object({ id: idSchema }),
    output: z.object({ task: taskSchema.nullable(), links: z.array(linkSchema), handoffs: z.array(handoffSchema) }),
  },
  create: {
    input: z.object({
      title: z.string().trim().max(300),
      description: z.string().max(64_000).optional(),
      status: statusSchema.optional(),
      /** Without one, the project's main board. */
      boardId: idSchema.optional(),
      projectId: projectIdSchema.nullable().optional(),
      due: daySchema.optional(),
      assignee: assigneeSchema.optional(),
      ...fieldsSchema,
    }),
    output: z.object({ task: taskSchema }),
  },
  update: {
    input: z.object({
      id: idSchema,
      title: z.string().trim().max(300).optional(),
      description: z.string().max(64_000).optional(),
      /** Puts the task, and its subtasks, on another board. */
      boardId: idSchema.optional(),
      projectId: projectIdSchema.nullable().optional(),
      due: daySchema.optional(),
      assignee: assigneeSchema.optional(),
      ...fieldsSchema,
    }),
    output: z.object({ ok: z.boolean() }),
  },
  /** Puts a task in a column; `index` is its position among the column's other tasks. */
  move: {
    input: z.object({ id: idSchema, status: statusSchema, index: z.number().int().nonnegative().optional() }),
    output: z.object({ ok: z.boolean(), archivedThreads: z.number() }),
  },
  archive: {
    input: z.object({ id: idSchema, archived: z.boolean() }),
    output: z.object({ ok: z.boolean() }),
  },
  delete: {
    input: z.object({ id: idSchema }),
    output: z.object({ ok: z.boolean() }),
  },
  link: {
    input: z.object({ id: idSchema, link: linkSchema }),
    output: z.object({ ok: z.boolean() }),
  },
  unlink: {
    input: z.object({ id: idSchema, target: z.enum(["thread", "item"]), itemId: z.string().min(1).max(200) }),
    output: z.object({ ok: z.boolean() }),
  },
  /** Studio items and recent threads a task can link to. */
  linkables: {
    input: z.object({ projectId: projectIdSchema.nullable() }),
    output: z.object({ items: z.array(linkableSchema), errors: z.array(z.string()) }),
  },
  /** The project's default agent, to preselect in the handoff picker. */
  handoffDefaults: {
    input: z.object({ projectId: projectIdSchema }),
    output: z.object({
      providerId: z.string().nullable(),
      model: z.string().nullable(),
      reasoningLevel: z.string().nullable(),
    }),
  },
  handOff: {
    input: z.object({
      id: idSchema,
      projectId: projectIdSchema.nullable(),
      providerId: z.string().min(1).max(200).nullable(),
      model: z.string().min(1).max(200).nullable(),
      reasoningLevel: z.string().min(1).max(50).nullable(),
      note: z.string().max(20_000).nullable(),
      workspace: workspaceSchema,
    }),
    output: z.object({ threadId: z.string() }),
  },
  bots: { input: z.null(), output: z.object({ bots: z.array(z.object({ id: z.string(), name: z.string() })) }) },
  scheduleBot: { input: z.object({ id: idSchema, botId: z.string().min(1), schedule: z.enum(["hourly", "daily", "weekdays", "weekly"]) }), output: z.object({ threadId: z.string() }) },
  handOffBot: { input: z.object({ id: idSchema, note: z.string().max(20_000).nullable() }), output: z.object({ threadId: z.string() }) },
  syncCheckbox: { input: z.object({ id: idSchema, checked: z.boolean() }), output: z.object({ ok: z.boolean() }) },
  /** Sends the latest handoff's thread a follow-up, e.g. review feedback. */
  sendBack: {
    input: z.object({ id: idSchema, message: z.string().trim().min(1).max(20_000) }),
    output: z.object({ threadId: z.string() }),
  },
  archiveThreads: {
    input: z.object({ id: idSchema }),
    output: z.object({ archived: z.number(), failed: z.number() }),
  },
  settings: {
    input: z.null(),
    output: z.object({ archiveThreadsOnDone: z.boolean() }),
  },
});

type TaskDto = z.infer<typeof taskSchema>;
type BoardDto = z.infer<typeof boardSchema>;

function toHandoffDto(handoff: HandoffRow) {
  return {
    threadId: handoff.thread_id,
    state: handoff.state,
    note: handoff.note,
    agent: handoff.agent,
    createdAt: handoff.created_at,
    updatedAt: handoff.updated_at,
  };
}

function toLinkDto(link: LinkRow) {
  return { target: link.target, pluginId: link.plugin_id, itemId: link.item_id, label: link.label, href: link.href };
}

/** The line an agent puts in its reply to show a task as a card. */
function directive(id: string): string {
  return `::task{id="${id}"}`;
}

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new TaskStore(db);
  const schedules = new OfficeTaskSchedules(db, bb.sdk);
  const reports = new TaskReportOutbox(db, async report => {
    await bb.sdk.plugins.callRpc({ pluginId: "feed", method: "publish", input: {
      title: report.title.slice(0, 200), body: report.body, author: `Bot ${report.botId}`.slice(0, 80),
      story: `task:${report.taskId}`, topic: "Work", threadId: report.threadId, projectId: report.projectId,
    }, outputSchema: z.unknown() });
  }, message => bb.log.warn(message));
  const reportTimer = setInterval(() => { void reports.drain(); }, 60_000);
  reportTimer.unref();
  bb.onDispose(() => clearInterval(reportTimer));

  // Tasks from before boards go on their project's main board.
  const adopted = store.adoptLooseTasks();
  if (adopted.length) bb.log.info(`put existing tasks on ${adopted.length} new board(s)`);

  const settings = bb.settings.define({
    archiveThreadsOnDone: {
      type: "boolean",
      label: "Archive threads when a task is done",
      description: "When you move a task to Done, archive the threads it was handed to.",
      default: false,
    },
  });

  const studio = studioSchemas(z);
  const services = studioServices(bb.sdk);
  /** Tells Studio an agent made a board or task, so it joins the thread's spaces. */
  const created = (id: string, threadId: string) => void services.created({ pluginId: PLUGIN_ID, id }, threadId).catch(() => { /* The hub is optional. */ });
  // Replay source inheritance when Studio was absent or unavailable at creation.
  for (const source of store.sourceThreads()) created(source.task_id, source.thread_id);
  const syncLinks = (id: string) => services.replaceLinks({ pluginId: PLUGIN_ID, id }, PLUGIN_ID,
    store.links(id).filter((link) => link.target === "item" && link.plugin_id).map((link) => ({
      from: { pluginId: PLUGIN_ID, id }, to: { pluginId: link.plugin_id!, id: link.item_id }, kind: "task-link" as const, source: PLUGIN_ID,
    }))).catch(() => { /* The hub is optional. */ });
  for (const task of store.list({ includeArchived: true })) {
    void syncLinks(task.id);
    for (const handoff of store.handoffs(task.id)) void services.linkThread({
      threadId: handoff.thread_id, ref: { pluginId: PLUGIN_ID, id: task.id }, role: "handoff", state: handoff.state,
      createdAt: handoff.created_at, updatedAt: handoff.updated_at, metadata: {},
    }).catch(() => { /* The hub is optional. */ });
  }
  const changeBus = createChangeBus({ bb, channel: REALTIME_CHANNEL, pluginId: PLUGIN_ID, schemas: studio, event: (id) => ({ type: TASK_UPDATE_TYPE, taskId: id }) });

  /** Runs a column change, then announces the tasks it moved to another column. */
  function remapping(change: () => void) {
    const before = new Map(store.list({ includeArchived: true }).map((task) => [task.id, task.status]));
    change();
    for (const task of store.list({ includeArchived: true })) if (before.get(task.id) !== task.status) changed(task.id);
  }

  /** Tells open boards, task views and Studio that a task or a board changed. A task's board changes with it. */
  function changed(id: string) {
    changeBus.changed(id);
    if (isBoardId(id)) {
      const board = store.getBoard(id);
      if (board) void services.recordActivity({
        ref: { pluginId: PLUGIN_ID, id }, actor: { kind: board.updated_by === "agent" ? "agent" : "user" },
        verb: board.created_at === board.updated_at ? "created" : "updated", at: board.updated_at, summary: board.title || "Untitled board",
      }).catch(() => { /* The hub is optional. */ });
      return;
    }
    void syncLinks(id);
    const task = store.get(id);
    if (task) changeBus.changed(task.board_id);
    if (task) {
      void services.versionCreate({
        ref: { pluginId: PLUGIN_ID, id }, bytes: Buffer.from(JSON.stringify(task)).toString("base64"),
        label: task.title || "Task", actor: { kind: task.updated_by === "agent" ? "agent" : "user" },
      }).catch(() => { /* The hub is optional. */ });
      void services.recordActivity({
        ref: { pluginId: PLUGIN_ID, id }, actor: { kind: task.updated_by === "agent" ? "agent" : "user" },
        verb: task.created_at === task.updated_at ? "created" : "updated", at: task.updated_at, summary: task.title || "Untitled task",
      }).catch(() => { /* The hub is optional. */ });
    }
  }

  function mustGet(id: string): TaskRow {
    const task = store.get(id);
    if (!task) throw new Error(`Task ${id} not found.`);
    return task;
  }

  function mustGetBoard(id: string): BoardRow {
    const board = store.getBoard(id);
    if (!board) throw new Error(`Board ${id} not found.`);
    return board;
  }

  function toBoardDto(board: BoardRow): BoardDto {
    const counts = store.boardCounts(board.id);
    return {
      id: board.id,
      title: board.title,
      projectId: board.project_id,
      columns: store.statuses(board.id),
      open: counts.open,
      done: counts.done,
      createdAt: board.created_at,
      updatedAt: board.updated_at,
      archived: board.archived_at !== null,
      template: Boolean(board.template),
    };
  }

  /** Whether a board has a column; agents and the CLI can't use one that isn't there. */
  function hasColumn(boardId: string, status: string): boolean {
    return store.statuses(boardId).some((column) => column.id === status);
  }

  function toDto(task: TaskRow): TaskDto {
    const handoffs = store.handoffs(task.id);
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      statusLabel: store.statusLabel(task),
      boardId: task.board_id,
      projectId: task.project_id,
      due: task.due,
      assignee: task.assignee,
      priority: task.priority,
      labels: JSON.parse(task.labels) as string[],
      parentId: task.parent_id,
      subtasks: store.subtasks(task.id),
      recurrence: task.recurrence,
      schedule: schedules.label(task.id),
      reminderAt: task.reminder_at,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      updatedBy: task.updated_by,
      doneAt: task.done_at,
      archived: task.archived_at !== null,
      handoff: handoffs[0] ? toHandoffDto(handoffs[0]) : null,
      openThreads: handoffs.filter((handoff) => isOpenHandoff(handoff.state)).length,
      links: store.links(task.id).length,
    };
  }

  // -------------------------------------------------------------------
  // Handoffs: thread events move the handoff, and its task
  // -------------------------------------------------------------------

  function apply(threadId: string, signal: ThreadSignal) {
    const handoff = store.handoff(threadId);
    if (!handoff) return;
    const task = store.get(handoff.task_id);
    if (!task) return;
    const latest = store.latestHandoff(task.id)?.thread_id === threadId;
    const next = nextHandoff(handoff, task, latest, signal);
    if (!next) return;
    if (latest && schedules.label(task.id) && ["todo", "done"].includes(task.status)) {
      if (signal.type === "active") next.status = "in_progress";
      else if (["ready", "replied"].includes(next.state)) next.status = "review";
    }
    db.transaction(() => {
      store.setHandoff(threadId, next.state, next.note);
      if (next.status) store.move(task.id, next.status, "agent");
      if (latest && task.assignee?.startsWith("bot:") && ["ready", "replied"].includes(next.state)) {
        const outputs = store.links(task.id).filter(link => link.target === "item");
        reports.enqueue({ taskId: task.id, title: task.title || "Task ready for review", threadId,
          projectId: task.project_id, botId: task.assignee.slice(4),
          body: `[Open task](/plugins/studio/tasks/${task.id})\n\n${next.note ?? "The bot finished its turn. Review its work."}${outputs.length ? "\n\n" + outputs.map(link => `[${link.label.replace(/[\[\]]/g, "")}](${link.href})`).join("\n") : ""}`,
        });
      }
    })();
    void reports.drain();
    changed(task.id);
  }

  /** Thread links follow the thread's title. */
  function relabel(thread: { id: string; title: string | null; titleFallback: string | null }) {
    const label = thread.title ?? thread.titleFallback;
    if (!label) return;
    for (const taskId of store.relabelThread(thread.id, label)) changed(taskId);
  }

  async function hasPendingInput(threadId: string): Promise<boolean> {
    const interactions = await bb.sdk.threads.interactions.list({ threadId });
    return interactions.some((interaction) => interaction.status === "pending");
  }

  // BB drops these listeners when the plugin unloads.
  bb.events.on("thread.active", ({ thread }) => {
    relabel(thread);
    apply(thread.id, { type: "active" });
  });
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    relabel(thread);
    apply(thread.id, { type: "idle", text: lastAssistantText });
  });
  bb.events.on("thread.failed", ({ thread, error }) => apply(thread.id, { type: "failed", error }));
  bb.events.on("thread.archived", ({ thread }) => apply(thread.id, { type: "archived" }));
  bb.events.on("thread.unarchived", ({ thread }) => apply(thread.id, { type: "unarchived" }));
  bb.events.on("thread.deleted", ({ thread }) => apply(thread.id, { type: "deleted" }));
  bb.events.on("interaction.pending", ({ thread }) => apply(thread.id, { type: "needs-input" }));
  // BB has no event for an answered question, so watch the thread while
  // it's waiting on one.
  bb.events.on("experimental_thread.events", async ({ thread }) => {
    if (store.handoff(thread.id)?.state !== "needs-input") return;
    try {
      if (!(await hasPendingInput(thread.id))) apply(thread.id, { type: "input-resolved" });
    } catch (error) {
      bb.log.warn(`couldn't check ${thread.id} for pending input: ${String(error)}`);
    }
  });

  /**
   * Moves a handoff to its thread's current state, for events it missed. A
   * thread just spawned may read idle before its first turn starts, so `fresh`
   * doesn't count idle as finished.
   */
  async function catchUp(handoff: { thread_id: string; state: string }, fresh = false) {
    try {
      const thread = await bb.sdk.threads.get({ threadId: handoff.thread_id });
      if (thread.deletedAt !== null) apply(thread.id, { type: "deleted" });
      else if (thread.archivedAt !== null) apply(thread.id, { type: "archived" });
      else if (thread.status === "error") apply(thread.id, { type: "failed", error: null });
      else if (thread.status === "active" || thread.status === "starting" || thread.status === "pending") {
        apply(thread.id, { type: "active" });
        if (await hasPendingInput(thread.id)) apply(thread.id, { type: "needs-input" });
      } else if (!fresh && thread.status === "idle" && (handoff.state === "working" || handoff.state === "needs-input" || handoff.state === "starting")) {
        apply(thread.id, { type: "idle", text: null });
      }
      relabel(thread);
    } catch (error) {
      if (/not found|404/i.test(String(error))) apply(handoff.thread_id, { type: "deleted" });
      else bb.log.warn(`couldn't reconcile handoff ${handoff.thread_id}: ${String(error)}`);
    }
  }

  /** Events aren't replayed while the plugin is off: catch up on every open handoff. */
  async function reconcile() {
    for (const handoff of store.openHandoffs()) await catchUp(handoff);
  }
  void reconcile();

  async function agentLabel(providerId: string, model: string | null): Promise<string> {
    let name = providerId;
    try {
      name = (await bb.sdk.providers.list()).find((provider) => provider.id === providerId)?.displayName ?? providerId;
    } catch {
      // the id will do
    }
    return model ? `${name} · ${model}` : name;
  }

  function recordHandoff(taskId: string, threadId: string, agent: string | null): HandoffRow {
    const existing = store.handoff(threadId);
    if (existing && existing.task_id !== taskId) throw new Error("This thread is already working on another task.");
    const handoff = existing ?? store.addHandoff(taskId, threadId, agent);
    void services.linkThread({ threadId, ref: { pluginId: PLUGIN_ID, id: taskId }, role: "handoff", state: handoff.state,
      createdAt: handoff.created_at, updatedAt: handoff.updated_at, metadata: {} }).catch(() => { /* The hub is optional. */ });
    return handoff;
  }

  async function taskInput(task: TaskRow, note: string | null) {
    const linked = store.links(task.id);
    const mentionProviders = new Map<string, string>();
    await Promise.all([...new Set(linked.map((link) => link.plugin_id).filter((id): id is string => !!id))].map(async (pluginId) => {
      try {
        const info = await bb.sdk.plugins.callRpc({ pluginId, method: "studio_describe", input: null as never, outputSchema: studio.info });
        const kind = info.kinds[0];
        if (kind?.mentionProviderId) mentionProviders.set(pluginId, kind.mentionProviderId);
      } catch { /* A link still works without a mention provider. */ }
    }));
    return handoffInput(task, linked, note, new Date(), mentionProviders);
  }

  async function handOff(input: {
    id: string;
    projectId: string | null;
    providerId?: string | null;
    model?: string | null;
    reasoningLevel?: string | null;
    note?: string | null;
    workspace: "worktree" | "folder";
    by: Writer;
  }): Promise<{ threadId: string }> {
    let task = mustGet(input.id);
    const projectId = input.projectId ?? task.project_id;
    if (!projectId) throw new Error("Pick a project for the agent to work in.");
    if (task.project_id !== projectId) task = store.update(task.id, { projectId }, input.by);
    const thread = await bb.sdk.threads.spawn({
      projectId,
      input: [await taskInput(task, input.note ?? null)],
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.reasoningLevel ? { reasoningLevel: input.reasoningLevel as never } : {}),
      ...(task.title ? { title: task.title } : {}),
      environment: {
        type: "host",
        hostId: await primaryHostId(bb),
        workspace: input.workspace === "worktree" ? { type: "managed-worktree", baseBranch: { kind: "default" } } : { type: "unmanaged", path: null },
      },
      pluginMetadata: { taskId: task.id },
    });
    recordHandoff(task.id, thread.id, await agentLabel(thread.providerId, input.model ?? null));
    // The thread may have started, or failed, before the handoff was recorded.
    const recorded = store.handoff(thread.id);
    if (recorded) void catchUp(recorded, true);
    store.link(task.id, { target: "thread", plugin_id: null, item_id: thread.id, label: thread.title ?? (task.title || "Thread"), href: `/threads/${thread.id}` });
    if (task.status !== "in_progress" && hasColumn(task.board_id, "in_progress")) store.move(task.id, "in_progress", input.by);
    store.update(task.id, { assignee: "agent" }, input.by);
    changed(task.id);
    return { threadId: thread.id };
  }

  const botHandoffs = new Map<string, Promise<{ threadId: string }>>();
  async function handOffBot(id: string, note: string | null, prepareOnly = false): Promise<{ threadId: string }> {
    // Concurrent clicks/assignments share one send; later explicit handoffs can
    // still send review feedback to the existing thread.
    const key = `${id}:${mustGet(id).assignee}:${prepareOnly}`;
    const pending = botHandoffs.get(key);
    if (pending) return pending;
    const work = runBotHandoff(id, note, prepareOnly);
    botHandoffs.set(key, work);
    try { return await work; } finally { if (botHandoffs.get(key) === work) botHandoffs.delete(key); }
  }
  async function runBotHandoff(id: string, note: string | null, prepareOnly: boolean) {
      const task = mustGet(id);
      const botId = task.assignee?.startsWith("bot:") ? task.assignee.slice(4) : null;
      if (!botId) throw new Error("Assign a Studio Teams bot first.");
      const latest = store.latestHandoff(id);
      const existing = store.links(id).find((link) => {
        if (link.target !== "thread" || !link.label.startsWith("Bot work:")) return false;
        const handoff = store.handoff(link.item_id);
        // A thread can identify one task, and only its newest handoff moves it.
        return !handoff || (handoff.task_id === id && latest?.thread_id === link.item_id);
      });
      let threadId = latest?.thread_id ?? existing?.item_id;
      if (threadId) {
        const profile = await bb.sdk.plugins.callRpc({ pluginId: "bot-teams", method: "threadProfile", input: { threadId } as never,
          outputSchema: z.object({ botId: z.string().nullable() }).nullable() });
        if (profile?.botId !== botId) threadId = undefined;
        else {
          try {
            const thread = await bb.sdk.threads.get({ threadId });
            if (thread.deletedAt !== null || thread.archivedAt !== null) threadId = undefined;
          } catch { threadId = undefined; }
        }
      }
      if (!threadId) {
        const thread = await bb.sdk.plugins.callRpc({ pluginId: "bot-teams", method: "newConversation", input: { id: botId } as never,
          outputSchema: z.object({ threadId: z.string() }) });
        threadId = thread.threadId;
      }
      const input = await taskInput(task, note ?? null);
      recordHandoff(id, threadId, `Bot ${botId}`);
      store.setHandoff(threadId, "starting", null);
      store.link(id, { target: "thread", plugin_id: null, item_id: threadId, label: `Bot work: ${task.title || "Task"}`, href: `/threads/${threadId}` });
      if (prepareOnly) { changed(id); return { threadId }; }
      if (task.status !== "in_progress" && hasColumn(task.board_id, "in_progress")) store.move(id, "in_progress", "user");
      changed(id);
      try {
        await bb.sdk.threads.send({ threadId, input: [input], mode: "auto" });
      } catch (error) {
        apply(threadId, { type: "failed", error: errorMessage(error) });
        throw error;
      }
      const recorded = store.handoff(threadId);
      if (recorded) await catchUp(recorded, true);
      return { threadId };
    }

  async function dispatchAssignment(id: string, previousAssignee: string | null = null) {
    const task = mustGet(id);
    if (task.archived_at !== null || task.status === "done" || !task.assignee?.startsWith("bot:") || task.assignee === previousAssignee) return;
    try { await handOffBot(id, null); }
    catch (cause) { throw new Error(`Task ${id} was saved, but its bot could not start: ${errorMessage(cause)}`); }
  }

  async function archiveThreads(id: string): Promise<{ archived: number; failed: number }> {
    let archived = 0;
    let failed = 0;
    for (const handoff of store.handoffs(id).filter((each) => isOpenHandoff(each.state))) {
      try {
        await bb.sdk.threads.archive({ threadId: handoff.thread_id });
        store.setHandoff(handoff.thread_id, "archived", handoff.note);
        archived += 1;
      } catch (error) {
        bb.log.warn(`couldn't archive ${handoff.thread_id}: ${String(error)}`);
        failed += 1;
      }
    }
    if (archived) changed(id);
    return { archived, failed };
  }

  /** Moves a task, and archives its threads when it's done and the setting is on. */
  async function move(id: string, status: TaskStatus, by: Writer, index?: number): Promise<{ archivedThreads: number }> {
    const before = mustGet(id);
    if (!hasColumn(before.board_id, status)) throw new Error("This board has no such column.");
    store.move(id, status, by, index);
    changed(id);
    if (status === "done" || before.status === "done") {
      for (const link of store.links(id).filter((row) => row.plugin_id === "pages" && row.href?.includes("#"))) {
        try {
          const markdown = await bb.sdk.plugins.callRpc({ pluginId: "pages", method: "editableMarkdown", input: { id: link.item_id } as never,
            outputSchema: z.object({ markdown: z.string() }) });
          const blockId = link.href!.split("#").at(-1)!;
          const checkbox = pageCheckboxes(markdown.markdown).find((row) => row.blockId === blockId && row.taskId === id);
          if (!checkbox || checkbox.checked === (status === "done")) continue;
          await bb.sdk.plugins.callRpc({ pluginId: "pages", method: "editBlock",
            input: { id: link.item_id, expected: markdown.markdown, block: blockId, markdown: setPageCheckbox(checkbox.line, status === "done") } as never,
            outputSchema: z.object({ markdown: z.string() }) });
        } catch (error) { bb.log.warn(`couldn't sync page checkbox for ${id}: ${String(error)}`); }
      }
    }
    if (status === "done" && before.status !== "done") {
      const next = store.completeRecurring(before, by);
      if (next) changed(next.id);
    }
    if (status !== "done" || before.status === "done" || schedules.label(id) || !(await settings.get()).archiveThreadsOnDone) return { archivedThreads: 0 };
    return { archivedThreads: (await archiveThreads(id)).archived };
  }

  /** The task a thread is working on: from its handoff. */
  function threadTask(threadId: string): TaskRow | null {
    const handoff = store.handoff(threadId);
    return handoff ? store.get(handoff.task_id) : null;
  }

  /** Board order: by board, then the task's column on it, then its place in the column. */
  function byColumn(a: TaskRow, b: TaskRow): number {
    const at = (task: TaskRow) => store.statuses(task.board_id).findIndex((column) => column.id === task.status);
    return a.board_id.localeCompare(b.board_id) || at(a) - at(b) || a.rank - b.rank;
  }

  function boardName(id: string): string {
    return untitled(store.getBoard(id)?.title ?? "");
  }

  function boardLine(board: BoardRow): string {
    const counts = store.boardCounts(board.id);
    const summary = boardSummary(store.statuses(board.id), counts.byStatus);
    return `${untitled(board.title)} (id ${board.id}${board.project_id ? `, project ${board.project_id}` : ", no project"}): ${summary || "no tasks"}. Columns: ${store.statuses(board.id).map((column) => `${column.label} (${column.id})`).join(", ")}. Link ${boardHref(board.id)}`;
  }

  function taskLine(task: TaskRow): string {
    const handoff = store.latestHandoff(task.id);
    const parts = [`on ${boardName(task.board_id)}`, store.statusLabel(task), assigneeLabel(task), `priority ${task.priority}`];
    if (task.due) parts.push(`due ${formatDue(task.due)} (${task.due})`);
    if (task.recurrence) parts.push(`repeats ${task.recurrence}`);
    if (JSON.parse(task.labels).length) parts.push(`labels ${(JSON.parse(task.labels) as string[]).join(", ")}`);
    if (handoff) parts.push(HANDOFF_LABELS[handoff.state]);
    return `${untitled(task.title)} (id ${task.id}): ${parts.join(", ")}. Link ${taskHref(task.id)}`;
  }

  function taskDetails(task: TaskRow): string {
    const lines = [taskLine(task)];
    if (task.parent_id) lines.push(`Parent: ${task.parent_id}`);
    const subtasks = store.subtasks(task.id);
    if (subtasks.total) lines.push(`Subtasks: ${subtasks.done}/${subtasks.total} done`);
    if (task.reminder_at) lines.push(`Reminder: ${new Date(task.reminder_at).toISOString()}`);
    if (task.description) lines.push(`\n${task.description}`);
    const links = store.links(task.id);
    if (links.length) lines.push(`\nLinked:\n${links.map((link) => `- ${link.label} (${link.target === "thread" ? "thread" : link.plugin_id}${link.href ? `, ${link.href}` : ""})`).join("\n")}`);
    const handoffs = store.handoffs(task.id);
    if (handoffs.length) {
      lines.push(
        `\nHanded to:\n${handoffs
          .map((handoff) => `- thread ${handoff.thread_id}${handoff.agent ? ` (${handoff.agent})` : ""}: ${HANDOFF_LABELS[handoff.state]}${handoff.note ? `. ${handoff.note}` : ""}`)
          .join("\n")}`,
      );
    }
    return lines.join("\n");
  }

  bb.log.info("loaded");

  bb.rpc.register(rpcContract, {
    async trackFinding({ key, threadId, messageId, title, pageId, create }) {
      let task = store.sourceTask(key);
      if (!create) return { task: task ? toDto(task) : null };
      if (!task) {
        const thread = await bb.sdk.threads.get({ threadId });
        task = store.createFromSource(key, threadId, {
          title, projectId: thread.projectId ?? null, by: "user",
          description: `Explore finding: ${title}\n\nSource: [${(thread.title || "Original thread").replace(/[\\[\\]]/g, "")}](/threads/${threadId})\nSource message: ${messageId}`,
        });
      }
      store.link(task.id, { target: "thread", plugin_id: null, item_id: threadId, label: "Finding source", href: `/threads/${threadId}` });
      if (pageId) store.link(task.id, { target: "item", plugin_id: "pages", item_id: pageId, label: "Explore explainer", href: `/plugins/pages/pages/${pageId}` });
      await services.created({ pluginId: PLUGIN_ID, id: task.id }, threadId).catch(() => { /* Studio is optional; sourceThreads replays this on reload. */ });
      await syncLinks(task.id);
      changed(task.id);
      return { task: toDto(task) };
    },
    boards({ includeArchived }) {
      return { boards: store.boards({ includeArchived }).map(toBoardDto) };
    },
    board({ boardId, includeArchived }) {
      const board = boardId ? store.getBoard(boardId) : null;
      if (boardId && !board) return { board: null, tasks: [] };
      return { board: board ? toBoardDto(board) : null, tasks: store.list({ includeArchived, boardId }).map(toDto) };
    },
    boardCreate({ title, projectId }) {
      const board = store.createBoard({ title, projectId, by: "user" });
      changed(board.id);
      return { board: toBoardDto(board) };
    },
    boardUpdate({ id, title, projectId }) {
      const before = mustGetBoard(id);
      store.updateBoard(id, { title, projectId }, "user");
      changed(id);
      if (projectId !== undefined && projectId !== before.project_id) for (const task of store.list({ boardId: id, includeArchived: true })) changed(task.id);
      return { ok: true };
    },
    async boardArchive({ id, archived }) {
      for (const task of store.list({ boardId: id, includeArchived: true })) if (!task.archived_at) await schedules.control(task.id, archived ? "pause" : "resume");
      store.setBoardArchived(id, archived);
      changed(id);
      return { ok: true };
    },
    async boardDelete({ id }) {
      mustGetBoard(id);
      for (const task of store.list({ boardId: id, includeArchived: true })) await schedules.control(task.id, "delete");
      for (const task of store.deleteBoard(id)) changeBus.changed(task);
      changeBus.changed(id);
      return { ok: true };
    },
    statuses({ boardId, projectId }) {
      if (boardId) return { columns: store.statuses(boardId) };
      return { columns: store.statuses(store.findMainBoard(projectId ?? null)?.id ?? null) };
    },
    setStatuses({ boardId, columns }) { remapping(() => store.setStatuses(boardId, columns)); changed(boardId); return { ok: true }; },
    get({ id }) {
      const task = store.get(id);
      if (!task) return { task: null, links: [], handoffs: [] };
      return { task: toDto(task), links: store.links(id).map(toLinkDto), handoffs: store.handoffs(id).map(toHandoffDto) };
    },
    async create({ title, description, status, boardId, projectId, due, assignee, ...fields }) {
      const board = boardId ? mustGetBoard(boardId) : store.mainBoard(projectId ?? null);
      if (status && !hasColumn(board.id, status)) throw new Error("This board has no such column.");
      const task = store.create({ title, description, status, boardId: board.id, projectId, due, assignee: assignee as TaskRow["assignee"], ...fields, by: "user" });
      changed(task.id);
      await dispatchAssignment(task.id);
      return { task: toDto(mustGet(task.id)) };
    },
    async update({ id, boardId, ...patch }) {
      const before = mustGet(id);
      if (boardId && boardId !== before.board_id) {
        for (const moved of store.moveToBoard(id, boardId, "user")) changed(moved);
        changed(before.board_id);
      }
      store.update(id, { ...patch, assignee: patch.assignee as TaskRow["assignee"] }, "user");
      changed(id);
      await dispatchAssignment(id, before.assignee);
      return { ok: true };
    },
    async move({ id, status, index }) {
      const { archivedThreads } = await move(id, status, "user", index);
      return { ok: true, archivedThreads };
    },
    async archive({ id, archived }) {
      await schedules.control(id, archived ? "pause" : "resume");
      store.setArchived(id, archived);
      changed(id);
      return { ok: true };
    },
    async delete({ id }) {
      const task = store.get(id);
      await schedules.control(id, "delete");
      if (store.delete(id)) {
        changeBus.changed(id);
        if (task) changed(task.board_id);
      }
      return { ok: true };
    },
    link({ id, link }) {
      store.link(id, { target: link.target, plugin_id: link.pluginId, item_id: link.itemId, label: link.label, href: link.href });
      changed(id);
      return { ok: true };
    },
    unlink({ id, target, itemId }) {
      if (store.unlink(id, target, itemId)) changed(id);
      return { ok: true };
    },
    async linkables({ projectId }) {
      const errors: string[] = [];
      const lists = await Promise.all(
        LINKABLE_PLUGINS.map(async (pluginId) => {
          try {
            const [{ items }, info] = await Promise.all([
              bb.sdk.plugins.callRpc({ pluginId, method: "studio_list", input: null as never, outputSchema: studio.provider.studio_list.output }),
              bb.sdk.plugins.callRpc({ pluginId, method: "studio_describe", input: null as never, outputSchema: studio.info }),
            ]);
            return items
              .filter((item) => !item.archived)
              .map((item) => {
                const kind = info.kinds.find((each) => each.id === item.kind);
                return {
                  target: "item" as const,
                  pluginId,
                  itemId: item.id,
                  label: untitled(item.title),
                  href: item.href,
                  kind: kind?.label ?? item.kind,
                  icon: item.icon ?? kind?.icon ?? null,
                  updatedAt: item.updatedAt,
                };
              });
          } catch (error) {
            // Not installed, or not a Studio add-on yet.
            if (!/not found|not installed|no rpc|unknown plugin|404/i.test(String(error))) errors.push(`${pluginId}: ${String(error)}`);
            return [];
          }
        }),
      );
      let threads: z.infer<typeof linkableSchema>[] = [];
      try {
        threads = (await bb.sdk.threads.list({ ...(projectId ? { projectId } : {}), limit: 50 })).map((thread) => ({
          target: "thread" as const,
          pluginId: null,
          itemId: thread.id,
          label: thread.title ?? thread.titleFallback ?? "Untitled thread",
          href: `/threads/${thread.id}`,
          kind: "Thread",
          icon: "MessageSquare",
        }));
      } catch (error) {
        errors.push(`threads: ${String(error)}`);
      }
      const items = lists
        .flat()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 300)
        .map(({ updatedAt: _, ...item }) => item);
      return { items: [...items, ...threads], errors };
    },
    async handoffDefaults({ projectId }) {
      const defaults = await bb.sdk.projects.defaultExecutionOptions({ projectId });
      return { providerId: defaults?.providerId ?? null, model: defaults?.model ?? null, reasoningLevel: defaults?.reasoningLevel ?? null };
    },
    handOff(input) {
      return handOff({ ...input, by: "user" });
    },
    async bots() {
      const result = await bb.sdk.plugins.callRpc({ pluginId: "bot-teams", method: "list", input: null as never,
        outputSchema: z.object({ bots: z.array(z.object({ id: z.string(), name: z.string(), retired: z.boolean().optional() })) }) });
      return { bots: result.bots.filter((bot) => !bot.retired).map(({ id, name }) => ({ id, name })) };
    },
    handOffBot: ({ id, note }) => handOffBot(id, note),
    async scheduleBot({ id, botId, schedule }) {
      const task = mustGet(id);
      if (task.assignee && task.assignee !== `bot:${botId}`) throw new Error("This task is assigned to someone else.");
      if (!task.project_id) throw new Error("Choose a folder before scheduling work.");
      const profile = await bb.sdk.plugins.callRpc({ pluginId: "bot-teams", method: "get", input: { id: botId }, outputSchema: z.object({ bot: z.object({ trust: z.enum(["ask", "act"]).default("ask") }) }) });
      store.update(id, { assignee: `bot:${botId}` }, "user");
      const { threadId } = await handOffBot(id, null, true);
      await schedules.ensure({ taskId: id, projectId: task.project_id, threadId, schedule, trust: profile.bot.trust });
      changed(id); return { threadId };
    },
    async syncCheckbox({ id, checked }) {
      const task = store.get(id);
      if (!task) return { ok: false };
      if ((task.status === "done") !== checked) await move(id, checked ? "done" : store.statuses(task.board_id).find((column) => column.id !== "done")!.id, "user");
      return { ok: true };
    },
    async sendBack({ id, message }) {
      const handoff = store.latestHandoff(id);
      if (!handoff || !isOpenHandoff(handoff.state)) throw new Error("This task has no thread to send to. Hand it off again.");
      await bb.sdk.threads.send({ threadId: handoff.thread_id, input: [{ type: "text", text: message, mentions: [] }], mode: "auto" });
      const task = mustGet(id);
      if (task.status !== "in_progress" && hasColumn(task.board_id, "in_progress")) store.move(id, "in_progress", "user");
      changed(id);
      return { threadId: handoff.thread_id };
    },
    archiveThreads({ id }) {
      mustGet(id);
      return archiveThreads(id);
    },
    async settings() {
      return { archiveThreadsOnDone: (await settings.get()).archiveThreadsOnDone };
    },
  });

  registerStudio(bb, studio, {
    store,
    changed,
    move: (id, status) => move(id, status, "user").then(() => undefined),
  });

  // ---------------------------------------------------------------------
  // Agent tools
  // ---------------------------------------------------------------------

  const linkInput = z.object({
    pluginId: z.string().min(1).max(100).describe('The Studio add-on: "pages", "artifacts", "talk" or "excalidraw".'),
    itemId: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
  });

  bb.agents.registerTool({
    name: "tasks_boards",
    description:
      "List the user's Studio Tasks boards: id, title, project, columns, and how many tasks are in each column. " +
      "Each project has a main board, where tasks go when you don't name one.",
    parameters: z.object({ query: z.string().max(200).optional() }),
    execute({ query }) {
      const needle = query?.trim().toLowerCase();
      const rows = store.boards().filter((board) => !needle || board.title.toLowerCase().includes(needle));
      return rows.length ? rows.map((board) => `- ${boardLine(board)}`).join("\n") : "No boards match.";
    },
  });

  bb.agents.registerTool({
    name: "tasks_board_create",
    description:
      "Make a Studio Tasks board, in this thread's project unless you pass `global`. Use it when the user asks for a separate board, " +
      "e.g. for a launch or a sprint. Columns default to To do, In progress, Review and Done; Done is always last.",
    parameters: z.object({
      title: z.string().trim().min(1).max(200),
      global: z.boolean().optional().describe("Make it outside any project."),
      columns: z.array(z.string().trim().min(1).max(60)).min(1).max(11).optional().describe("Column names before Done, e.g. [\"Backlog\", \"Doing\"]."),
    }),
    execute({ title, global, columns }, context) {
      let statuses: { id: string; label: string }[] | undefined;
      if (columns) {
        statuses = [{ id: "done", label: "Done" }];
        for (const label of columns.filter((each) => each.toLowerCase() !== "done")) statuses.splice(-1, 0, { id: columnId(label, statuses), label });
        if (statuses.length < 2) return { content: [{ type: "text", text: "Name at least one column before Done." }], isError: true };
      }
      const board = store.createBoard({ title, projectId: global ? null : (context.projectId ?? null), columns: statuses, by: "agent" });
      changed(board.id);
      created(board.id, context.threadId);
      return `Made ${boardLine(board)}\n\nTo show it in a page, embed it with kind "board" and target "${board.id}".`;
    },
  });

  bb.agents.registerTool({
    name: "tasks_list",
    description:
      "List tasks on the user's Studio Tasks boards: id, title, board, status, assignee, due date, and the handed-off thread's state. " +
      "Pass `boardId` for one board (see tasks_boards).",
    parameters: z.object({ boardId: boardIdSchema.optional(), status: statusSchema.optional(), query: z.string().max(200).optional() }),
    execute({ boardId, status, query }) {
      if (boardId && !store.getBoard(boardId)) return { content: [{ type: "text", text: `Board ${boardId} not found.` }], isError: true };
      const needle = query?.trim().toLowerCase();
      const rows = store
        .list({ boardId })
        .filter((task) => !status || task.status === status)
        .filter((task) => !needle || `${task.title} ${task.description}`.toLowerCase().includes(needle))
        .sort(byColumn)
        .slice(0, 100);
      return rows.length ? rows.map((task) => `- ${taskLine(task)}`).join("\n") : "No tasks match.";
    },
  });

  bb.agents.registerTool({
    name: "tasks_get",
    description: "Read a task: its description, links, and the threads it was handed to. Without an id, reads the task this thread is working on.",
    parameters: z.object({ id: idSchema.optional() }),
    execute({ id }, context) {
      const task = id ? store.get(id) : threadTask(context.threadId);
      if (!task) return { content: [{ type: "text", text: id ? `Task ${id} not found.` : "This thread isn't working on a task. Pass an id." }], isError: true };
      return taskDetails(task);
    },
  });

  bb.agents.registerTool({
    name: "tasks_create",
    description:
      "Add a task to a Studio Tasks board: the one you name with `boardId`, else this project's main board. It goes in the first column " +
      "unless you pass a status. Use it when the user asks you to track something, " +
      "not for your own step-by-step plan. The result includes a line to put in your reply so the task shows as a card.",
    parameters: z.object({
      title: z.string().trim().min(1).max(300),
      boardId: boardIdSchema.optional(),
      description: z.string().max(64_000).optional(),
      status: statusSchema.optional(),
      due: z.string().optional().describe("A day, like 2026-10-01."),
      assignee: assigneeSchema.optional().describe('"me", "agent", or "bot:<id>".'),
      priority: prioritySchema.optional(), labels: labelsSchema.optional(), parentId: idSchema.optional(),
      recurrence: z.enum(RECURRENCES).optional(), reminderAt: z.number().int().nonnegative().optional(),
    }),
    async execute({ title, boardId, description, status, due: rawDue, assignee, priority, labels, parentId, recurrence, reminderAt }, context) {
      const due = rawDue?.trim() || undefined;
      if (due && !isDay(due)) return { content: [{ type: "text", text: "Give `due` as a day, like 2026-10-01." }], isError: true };
      if (boardId && !store.getBoard(boardId)) return { content: [{ type: "text", text: `Board ${boardId} not found. List boards with tasks_boards.` }], isError: true };
      const board = boardId ? store.getBoard(boardId)! : store.mainBoard(context.projectId ?? null, "agent");
      if (status && (status === "done" || !hasColumn(board.id, status))) return { content: [{ type: "text", text: `Use one of the board's columns other than Done: ${store.statuses(board.id).filter((column) => column.id !== "done").map((column) => column.id).join(", ")}.` }], isError: true };
      const task = store.create({ title, description, status, boardId: board.id, due: due ?? null, assignee: assignee ?? null, priority, labels, parentId, recurrence, reminderAt, ...(boardId ? {} : { projectId: context.projectId ?? null }), by: "agent" });
      changed(task.id);
      created(task.id, context.threadId);
      await dispatchAssignment(task.id);
      return `Added ${taskLine(task)}\n\nTo show it in your reply, put this on its own line:\n${directive(task.id)}`;
    },
  });

  bb.agents.registerTool({
    name: "tasks_update",
    description:
      "Update a task. Without an id, updates the task this thread was handed. When the work is ready for the user to review, " +
      'set status "review" with a one-line `note` saying what you did. Link what you made for it with `addLinks` ' +
      "(Studio items, e.g. an artifact's id with pluginId \"artifacts\"). Move it to another board with `boardId`. Only the user marks a task done.",
    parameters: z.object({
      id: idSchema.optional(),
      boardId: boardIdSchema.optional(),
      status: statusSchema.optional(),
      note: z.string().max(2000).optional(),
      title: z.string().trim().min(1).max(300).optional(),
      description: z.string().max(64_000).optional(),
      due: z.string().nullable().optional(),
      priority: prioritySchema.optional(), labels: labelsSchema.optional(), parentId: idSchema.nullable().optional(),
      recurrence: recurrenceSchema.optional(), reminderAt: z.number().int().nonnegative().nullable().optional(),
      assignee: assigneeSchema.optional(),
      addLinks: z.array(linkInput).max(20).optional(),
    }),
    async execute({ id, boardId, status, note, title, description, due: rawDue, priority, labels, parentId, recurrence, reminderAt, assignee, addLinks }, context) {
      // An empty day clears the due date.
      const due = rawDue === undefined ? undefined : rawDue?.trim() || null;
      const task = id ? store.get(id) : threadTask(context.threadId);
      if (!task) return { content: [{ type: "text", text: id ? `Task ${id} not found.` : "This thread isn't working on a task. Pass an id." }], isError: true };
      if (due && !isDay(due)) return { content: [{ type: "text", text: "Give `due` as a day, like 2026-10-01." }], isError: true };
      if (boardId && !store.getBoard(boardId)) return { content: [{ type: "text", text: `Board ${boardId} not found. List boards with tasks_boards.` }], isError: true };
      const targetBoard = boardId ?? task.board_id;
      if (status && (status === "done" || !hasColumn(targetBoard, status))) return { content: [{ type: "text", text: `Use one of the board's columns other than Done: ${store.statuses(targetBoard).filter((column) => column.id !== "done").map((column) => column.id).join(", ")}.` }], isError: true };
      if (boardId && boardId !== task.board_id) {
        for (const moved of store.moveToBoard(task.id, boardId, "agent")) changed(moved);
        changed(task.board_id);
      }
      if (title !== undefined || description !== undefined || due !== undefined || priority !== undefined || labels !== undefined || parentId !== undefined || recurrence !== undefined || reminderAt !== undefined || assignee !== undefined) store.update(task.id, { title, description, due, priority, labels, parentId, recurrence, reminderAt, assignee }, "agent");
      for (const link of addLinks ?? []) {
        store.link(task.id, { target: "item", plugin_id: link.pluginId, item_id: link.itemId, label: link.label, href: studioHref(link.pluginId, link.itemId) });
      }
      const handoff = store.handoff(context.threadId);
      const own = handoff?.task_id === task.id;
      if (status === "review" && own) apply(context.threadId, { type: "ready", note: note ?? null });
      else if (status && status !== task.status) await move(task.id, status, "agent");
      else if (note && own) store.setHandoff(context.threadId, handoff.state, firstLine(note));
      changed(task.id);
      await dispatchAssignment(task.id, task.assignee);
      return `Updated ${taskLine(mustGet(task.id))}`;
    },
  });

  bb.agents.configure(() => ({ tools: ["tasks_boards", "tasks_board_create", "tasks_list", "tasks_get", "tasks_create", "tasks_update"], skills: [] }));

  // `@task` in any composer.
  bb.ui.registerMentionProvider(defineItemMention({
    id: "task",
    label: "Tasks",
    search({ query }) {
      const needle = query.trim().toLowerCase();
      return store
        .list()
        .filter((task) => task.status !== "done")
        .filter((task) => !needle || task.title.toLowerCase().includes(needle))
        .slice(0, 50)
        .map((task) => ({ id: task.id, title: untitled(task.title), subtitle: `${boardName(task.board_id)} · ${store.statusLabel(task)} · ${assigneeLabel(task)}` }));
    },
    resolve(itemId) {
      const task = mustGet(itemId);
      const handoff = store.latestHandoff(task.id);
      return {
        context: mentionContext({
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          statusLabel: store.statusLabel(task),
          due: task.due,
          assignee: task.assignee,
          priority: task.priority,
          labels: JSON.parse(task.labels) as string[],
          recurrence: task.recurrence,
          parentId: task.parent_id,
          subtasks: store.subtasks(task.id),
          reminderAt: task.reminder_at,
          handoff: handoff ? { state: handoff.state, note: handoff.note } : null,
          links: store.links(task.id).map((link) => link.label),
        }),
      };
    },
  }));

  // CLI: `bb studio studio-tasks …`
  const usage = {
    boards: "bb studio studio-tasks boards",
    board: "bb studio studio-tasks board <title> [--global]",
    list: "bb studio studio-tasks list [--board <id>] [--status todo|in_progress|review|done]",
    add: "bb studio studio-tasks add <title> [--board <id>] [--description <text>] [--due <YYYY-MM-DD>] [--priority <level>] [--labels <comma-separated>] [--repeat <frequency>] [--parent <task-id>] [--bot <id>|--me]",
    show: "bb studio studio-tasks show <id>",
    move: "bb studio studio-tasks move <id> <status>",
    hand: "bb studio studio-tasks hand <id> [--note <text>] [--folder]",
    done: "bb studio studio-tasks done <id>",
  };
  bb.cli.register({
    name: "studio-tasks",
    summary: "Studio Tasks: boards of tasks you can hand to agents",
    commands: [
      { name: "boards", summary: "List boards", usage: usage.boards },
      { name: "board", summary: "Make a board in this project", usage: usage.board },
      { name: "list", summary: "List tasks", usage: usage.list },
      { name: "add", summary: "Add a task to a board's first column", usage: usage.add },
      { name: "show", summary: "Show a task, its links and handoffs", usage: usage.show },
      { name: "move", summary: "Move a task to another column", usage: usage.move },
      { name: "hand", summary: "Hand a task to an agent in a new thread, with the project's default agent", usage: usage.hand },
      { name: "done", summary: "Mark a task done", usage: usage.done },
    ],
    async run(argv, ctx) {
      const { command: cmd, rest } = subcommand(argv);
      const flags = parseFlags(rest, ["me", "folder", "global"]);
      const fail = (message: string) => ({ exitCode: 1, stderr: `${message}\n` });
      try {
        switch (cmd) {
          case "boards": {
            const rows = store.boards();
            if (!rows.length) return { exitCode: 0, stdout: "No boards.\n" };
            return { exitCode: 0, stdout: `${rows.map((board) => { const counts = store.boardCounts(board.id); return [board.id, untitled(board.title), board.project_id ?? "", `${counts.open} open`, `${counts.done} done`].join("\t"); }).join("\n")}\n` };
          }
          case "board": {
            const title = flags.positional.join(" ").trim();
            if (!title) return fail(`usage: ${usage.board}`);
            const board = store.createBoard({ title, projectId: flags.values.global !== undefined ? null : (ctx.projectId ?? null), by: "agent" });
            changed(board.id);
            return { exitCode: 0, stdout: `${board.id}\n` };
          }
          case "list": {
            const status = flags.values.status;
            const boardId = flags.values.board;
            if (boardId !== undefined && !store.getBoard(boardId)) return fail(`Board ${boardId} not found.`);
            if (status !== undefined && !store.list().some((task) => task.status === status) && !isStatus(status)) return fail(`usage: ${usage.list}`);
            const rows = store.list({ boardId }).filter((task) => !status || task.status === status);
            if (!rows.length) return { exitCode: 0, stdout: "No tasks.\n" };
            const lines = rows
              .sort(byColumn)
              .map((task) => {
                const handoff = store.latestHandoff(task.id);
                return [task.id, boardName(task.board_id), store.statusLabel(task), untitled(task.title), task.due ?? "", handoff ? HANDOFF_LABELS[handoff.state] : ""].join("\t");
              });
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          }
          case "add": {
            const title = flags.positional.join(" ").trim();
            const due = flags.values.due || null;
            if (!title) return fail(`usage: ${usage.add}`);
            if (due && !isDay(due)) return fail("Give --due as a day, like 2026-10-01.");
            const priority = flags.values.priority ?? "none";
            const recurrence = flags.values.repeat ?? null;
            if (!(PRIORITIES as readonly string[]).includes(priority)) return fail("Unknown priority.");
            if (recurrence && !(RECURRENCES as readonly string[]).includes(recurrence)) return fail("Unknown repeat frequency.");
            const boardId = flags.values.board;
            if (boardId !== undefined && !store.getBoard(boardId)) return fail(`Board ${boardId} not found.`);
            const task = store.create({
              title,
              boardId,
              description: flags.values.description,
              due,
              priority: priority as TaskRow["priority"],
              labels: flags.values.labels?.split(",").map((label) => label.trim()).filter(Boolean),
              parentId: flags.values.parent,
              recurrence: recurrence as TaskRow["recurrence"],
              assignee: flags.values.bot ? `bot:${flags.values.bot}` : flags.values.me !== undefined ? "me" : null,
              ...(boardId ? {} : { projectId: ctx.projectId ?? null }),
              by: "agent",
            });
            changed(task.id);
            await dispatchAssignment(task.id);
            return { exitCode: 0, stdout: `${task.id}\n` };
          }
          case "show": {
            const task = store.get(flags.positional[0] ?? "");
            if (!task) return fail(`usage: ${usage.show}`);
            return { exitCode: 0, stdout: `${taskDetails(task)}\n` };
          }
          case "move":
          case "done": {
            const [id, target] = flags.positional;
            const status = cmd === "done" ? "done" : target;
            if (!id || !store.get(id) || !status || !hasColumn(store.get(id)!.board_id, status)) return fail(`usage: ${usage[cmd]}`);
            const { archivedThreads } = await move(id, status, "agent");
            return { exitCode: 0, stdout: `${id}\t${store.statusLabel(store.get(id)!)}${archivedThreads ? `\tarchived ${archivedThreads} thread(s)` : ""}\n` };
          }
          case "hand": {
            const id = flags.positional[0];
            if (!id || !store.get(id)) return fail(`usage: ${usage.hand}`);
            const { threadId } = await handOff({ id, projectId: store.get(id)!.project_id ?? ctx.projectId ?? null, note: flags.values.note || null, workspace: flags.values.folder !== undefined ? "folder" : "worktree", by: "agent" });
            return { exitCode: 0, stdout: `${threadId}\n` };
          }
          default:
            return fail("unknown command — try: boards | board <title> | list | add <title> | show <id> | move <id> <status> | hand <id> | done <id>");
        }
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  });

  bb.onDispose(() => {
    changeBus.dispose();
    bb.log.info("disposed");
  });
}

export async function registerServer(ctx: import("../runtime").ModuleContext) { await plugin(ctx.bb); }
