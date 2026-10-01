// Items from the other Studio add-ons, for embeds and mentions, and what
// their live embeds show and edit: an artifact's content, a table, a task, a
// board, a recording. A plugin's UI can only call its own RPCs, so Pages asks each
// add-on on its behalf.
import { untitled } from "@bb-studio/kit/format";
import type { StudioSchemas } from "@bb-studio/kit/contract";
import { indexItem, studioIndex, type StudioIndexItem } from "@bb-studio/kit/server";
import { TABLES_PLUGIN_ID, tablesContract } from "@bb-studio/kit/tables";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { PLUGIN_ID, spaceWidgetSchema, type BoardCard, type RecordingCard, type TaskCard, type TaskColumn } from "./contract";

const MAX_TEXT = 20_000;
const TASKS_PLUGIN_ID = "studio-tasks";
const TALK_PLUGIN_ID = "talk";
const STUDIO_PLUGIN_ID = "studio";

const taskFields = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  /** Tasks from before boards have none. */
  boardId: z.string().optional(),
  projectId: z.string().nullable(),
  due: z.string().nullable(),
  assignee: z.string().nullable(),
  priority: z.string(),
  labels: z.array(z.string()),
  subtasks: z.object({ total: z.number(), done: z.number() }),
  archived: z.boolean(),
});
const taskSchema = z.object({ task: taskFields.nullable() });
const columnSchema = z.object({ id: z.string(), label: z.string() });
const columnsSchema = z.object({ columns: z.array(columnSchema) });
const boardSchema = z.object({
  board: z.object({ id: z.string(), title: z.string(), projectId: z.string().nullable(), columns: z.array(columnSchema), archived: z.boolean() }).nullable(),
  tasks: z.array(taskFields),
});
const okSchema = z.object({ ok: z.boolean() });

const recordingSchema = z.object({
  recording: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    durationMs: z.number(),
    createdAt: z.number(),
    meetingNotes: z.object({ summary: z.string(), decisions: z.array(z.string()) }).nullable().optional(),
  }),
  segments: z.array(z.object({ id: z.string(), offsetMs: z.number(), durationMs: z.number(), status: z.string(), text: z.string().nullable() })),
});

const artifactSchema = z.object({
  artifact: z
    .object({
      id: z.string(),
      version: z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(["image", "html", "markdown", "code", "text", "pdf", "other"]),
      }),
    })
    .nullable(),
});

type Sdk = BbPluginApi["sdk"];

export function studioEmbeds(sdk: Sdk, studio: StudioSchemas) {
  const index = studioIndex(sdk, studio, { exclude: [PLUGIN_ID] });
  const call = <T extends z.ZodType>(pluginId: string, method: string, input: unknown, outputSchema: T): Promise<z.infer<T>> =>
    sdk.plugins.callRpc({ pluginId, method, input: input as never, outputSchema }) as Promise<z.infer<T>>;
  type Tables = typeof tablesContract;
  /** Calls Studio Tables with its own contract's schemas. */
  const table = <M extends keyof Tables>(method: M, input: z.input<Tables[M]["input"]>) =>
    call(TABLES_PLUGIN_ID, method, input, tablesContract[method].output) as Promise<z.infer<Tables[M]["output"]>>;

  return {
    items: index.items,
    /** A new item from an add-on's Studio contract, as the index lists it. */
    async create(pluginId: string, kind: string, projectId: string | null): Promise<StudioIndexItem> {
      const [{ item }, info] = await Promise.all([
        call(pluginId, "studio_create", { kind, projectId }, studio.provider.studio_create.output),
        call(pluginId, "studio_describe", null, studio.info),
      ]);
      index.invalidate();
      return indexItem(pluginId, item, info);
    },
    table,
    async createTable(input: z.input<Tables["create"]["input"]>) {
      const result = await table("create", input);
      index.invalidate();
      return result;
    },
    async task(id: string): Promise<{ task: TaskCard | null; columns: TaskColumn[] }> {
      const { task } = await call(TASKS_PLUGIN_ID, "get", { id }, taskSchema);
      if (!task) return { task: null, columns: [] };
      const { columns } = await call(TASKS_PLUGIN_ID, "statuses", task.boardId ? { boardId: task.boardId } : { projectId: task.projectId }, columnsSchema);
      return { task, columns };
    },
    async updateTask({ id, status, index, ...fields }: { id: string; title?: string; status?: string; index?: number; due?: string | null }) {
      if (Object.keys(fields).length) await call(TASKS_PLUGIN_ID, "update", { id, ...fields }, okSchema);
      if (status) await call(TASKS_PLUGIN_ID, "move", { id, status, ...(index !== undefined ? { index } : {}) }, okSchema.extend({ archivedThreads: z.number() }));
      return { ok: true };
    },
    /** A board and its open tasks, top-level and subtasks alike, in board order. */
    async board(id: string): Promise<{ board: BoardCard | null; tasks: TaskCard[] }> {
      const { board, tasks } = await call(TASKS_PLUGIN_ID, "board", { boardId: id }, boardSchema);
      return { board, tasks: board ? tasks.filter((task) => !task.archived) : [] };
    },
    async renameBoard(id: string, title: string) {
      await call(TASKS_PLUGIN_ID, "boardUpdate", { id, title }, okSchema);
      index.invalidate();
      return { ok: true };
    },
    async createBoardTask(boardId: string, title: string, status?: string) {
      const { task } = await call(TASKS_PLUGIN_ID, "create", { boardId, title, ...(status ? { status } : {}) }, z.object({ task: z.object({ id: z.string() }) }));
      index.invalidate();
      return { taskId: task.id };
    },
    /** A space widget's data; null when Studio or the space is gone. */
    space(id: string) {
      return call(STUDIO_PLUGIN_ID, "spaceWidget", { id }, spaceWidgetSchema).catch(() => null);
    },
    /** The space whose page this is; null when it's none's or Studio is gone. */
    async spaceOfPage(pageId: string) {
      const schema = z.object({ spaces: z.array(z.object({ id: z.string(), name: z.string(), pageId: z.string().nullable().optional() })) });
      const result = await call(STUDIO_PLUGIN_ID, "spaces", null, schema).catch(() => null);
      const space = result?.spaces.find((each) => each.pageId === pageId);
      return space ? { id: space.id, name: space.name } : null;
    },
    async createInSpace(id: string, pluginId: string, kind: string) {
      const result = await call(STUDIO_PLUGIN_ID, "createInSpace", { id, pluginId, kind }, z.object({ href: z.string() }));
      index.invalidate();
      return result;
    },
    async recording(id: string): Promise<RecordingCard | null> {
      const result = await call(TALK_PLUGIN_ID, "recording_get", { id }, recordingSchema).catch(() => null);
      if (!result) return null;
      const { recording, segments } = result;
      let budget = MAX_TEXT;
      return {
        id: recording.id,
        title: untitled(recording.title),
        status: recording.status,
        durationMs: recording.durationMs,
        createdAt: recording.createdAt,
        summary: recording.meetingNotes?.summary || null,
        decisions: recording.meetingNotes?.decisions ?? [],
        segments: segments.flatMap((segment) => {
          const text = segment.status === "done" ? (segment.text ?? "").trim() : "";
          if (!text || budget <= 0) return [];
          budget -= text.length;
          const query = `recording=${encodeURIComponent(recording.id)}&segment=${encodeURIComponent(segment.id)}`;
          return [{ id: segment.id, offsetMs: segment.offsetMs, durationMs: segment.durationMs, text, url: `/api/v1/plugins/talk/http/audio?${query}` }];
        }),
      };
    },
    async artifactView(id: string) {
      const { artifact } = await sdk.plugins.callRpc({ pluginId: "artifacts", method: "get", input: { id } as never, outputSchema: artifactSchema });
      if (!artifact) return null;
      const { version } = artifact;
      let text: string | null = null;
      if (version.type === "markdown" || version.type === "code" || version.type === "text") {
        const result = await sdk.plugins.callRpc({
          pluginId: "artifacts",
          method: "studio_read",
          input: { id, format: "markdown" } as never,
          outputSchema: studio.provider.studio_read.output,
        });
        text = result.content === null ? null : result.content.slice(0, MAX_TEXT) + (result.content.length > MAX_TEXT ? "\n…" : "");
      }
      const query = `artifact=${encodeURIComponent(artifact.id)}&version=${encodeURIComponent(version.id)}`;
      return { type: version.type, name: version.name, url: `/api/v1/plugins/artifacts/http/content?${query}`, text };
    },
  };
}
