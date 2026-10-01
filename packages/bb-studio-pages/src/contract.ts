import { defineRpcContract, type NewThreadRequest } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { columnSchema, rowPatchSchema, tableSchema, tableUpdateSchema, valuesSchema } from "@bb-studio/kit/tables";

export * from "./constants";

// RPC surface for the Pages app. Document content does not go through RPC:
// editors sync over the `/sync` WebSocket (src/hub.ts).

const pageId = z.string().regex(/^pg_[a-f0-9]{12}(?:[a-f0-9]{4})?$/);
const projectId = z.string().min(1).max(200).nullable();
const itemId = z.string().min(1).max(100);

export const studioItemSchema = z.object({
  pluginId: z.string(),
  id: z.string(),
  kind: z.string(),
  kindLabel: z.string(),
  kindIcon: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  preview: z.string().nullable(),
  facts: z.array(z.string()),
  badge: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  href: z.string(),
  updatedAt: z.number(),
});

export type StudioEmbedItem = z.infer<typeof studioItemSchema>;

/** What a task embed shows and edits. */
export const taskCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  projectId: z.string().nullable(),
  due: z.string().nullable(),
  assignee: z.string().nullable(),
  priority: z.string(),
  labels: z.array(z.string()),
  subtasks: z.object({ total: z.number(), done: z.number() }),
  archived: z.boolean(),
});
export type TaskCard = z.infer<typeof taskCardSchema>;
export const taskColumnSchema = z.object({ id: z.string(), label: z.string() });
export type TaskColumn = z.infer<typeof taskColumnSchema>;

/** What a board embed shows: its columns, and its tasks in board order. */
export const boardCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  columns: z.array(taskColumnSchema),
  archived: z.boolean(),
});
export type BoardCard = z.infer<typeof boardCardSchema>;

/** What a recording embed plays and shows. */
export const recordingCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  durationMs: z.number(),
  createdAt: z.number(),
  summary: z.string().nullable(),
  decisions: z.array(z.string()),
  /** Transcribed segments in order, each with its audio. */
  segments: z.array(z.object({ id: z.string(), offsetMs: z.number(), durationMs: z.number(), text: z.string(), url: z.string() })),
});
export type RecordingCard = z.infer<typeof recordingCardSchema>;

export const refreshSchema = z.object({
  botId: z.string(),
  cron: z.string().min(1).max(120),
  instructions: z.string().max(4000),
  lastAt: z.number().nullable(),
  nextAt: z.number().nullable(),
});

export const pageMetaSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  parentId: z.string().nullable(),
  title: z.string(),
  icon: z.string(),
  position: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  updatedBy: z.string(),
  archived: z.boolean(),
  refresh: refreshSchema.nullable(),
});
export type PageMetaView = z.infer<typeof pageMetaSchema>;

export const botSchema = z.object({
  id: z.string(),
  name: z.string(),
  handle: z.string(),
  avatar: z.string(),
  description: z.string(),
  working: z.boolean(),
});
export type BotView = z.infer<typeof botSchema>;

export const requestSchema = z.object({
  id: z.string(),
  botId: z.string(),
  botName: z.string(),
  threadId: z.string().nullable(),
  kind: z.enum(["mention", "comment", "refresh"]),
  blockId: z.string().nullable(),
  commentThreadId: z.string().nullable(),
  summary: z.string(),
  status: z.enum(["queued", "working", "done", "failed"]),
  error: z.string().nullable(),
  result: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type RequestView = z.infer<typeof requestSchema>;

export const snapshotSchema = z.object({
  id: z.string(),
  label: z.string(),
  actor: z.string(),
  createdAt: z.number(),
});
export type SnapshotView = z.infer<typeof snapshotSchema>;

const commentText = z.string().trim().min(1).max(8000);

export const commentThreadSchema = z.object({
  id: z.string(),
  resolved: z.boolean(),
  blockId: z.string().nullable(),
  quote: z.string(),
  comments: z.array(z.object({ id: z.string(), author: z.string(), authorName: z.string(), text: z.string(), createdAt: z.number() })),
  updatedAt: z.number(),
});

// What BB's new-thread composer submits, whitelisted like Studio Teams does. Core
// threads.spawn validates the host-owned environment and prompt input.
export const chatRequestSchema = z.object({
  projectId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string(),
  reasoningLevel: z.enum(["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]),
  permissionMode: z.enum(["accept-edits", "auto", "full"]),
  serviceTier: z.enum(["default", "fast"]).optional(),
  executionInputSources: z.object({
    model: z.enum(["client-preference", "explicit"]).optional(),
    permissionMode: z.enum(["client-preference", "explicit"]).optional(),
    providerId: z.enum(["client-preference", "explicit"]).optional(),
    reasoningLevel: z.enum(["client-preference", "explicit"]).optional(),
    serviceTier: z.enum(["client-preference", "explicit"]).optional(),
  }),
  environment: z.record(z.string(), z.json()).transform((value) => value as NewThreadRequest["environment"]),
  input: z
    .array(z.record(z.string(), z.json()))
    .min(1)
    .transform((value) => value as NewThreadRequest["input"]),
  sendAt: z.number().int().positive().optional(),
});

const spaceThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  projectId: z.string().nullable(),
  updatedAt: z.number(),
  direct: z.boolean(),
  kind: z.enum(["thread", "channel", "dm"]),
  botName: z.string().nullable(),
});
/** What a space widget shows, from Studio's `spaceWidget`. */
export const spaceWidgetSchema = z.object({
  space: z.object({ id: z.string(), name: z.string(), icon: z.string().nullable(), defaultProjectId: z.string().nullable() }),
  recent: z.array(z.object({ pluginId: z.string(), id: z.string(), title: z.string(), icon: z.string().nullable(), kindIcon: z.string(), kindLabel: z.string(), href: z.string(), updatedAt: z.number() })),
  itemCount: z.number(),
  threads: z.array(spaceThreadSchema),
  projects: z.array(z.object({ id: z.string(), name: z.string(), items: z.number(), threads: z.number(), isDefault: z.boolean() })),
  kinds: z.array(z.object({ pluginId: z.string(), id: z.string(), label: z.string(), icon: z.string(), event: z.string().nullable() })),
  threadPrompt: z.string(),
  itemsHref: z.string(),
});
export type SpaceWidgetView = z.infer<typeof spaceWidgetSchema>;

export const rpcContract = defineRpcContract({
  tree: {
    /** Omit `projectId` for every page; otherwise a project's pages plus global ones. */
    input: z.object({ projectId: projectId.optional() }),
    output: z.object({ pages: z.array(pageMetaSchema) }),
  },
  create: {
    input: z.object({
      projectId,
      parentId: pageId.nullable(),
      title: z.string().max(200).default(""),
      icon: z.string().max(16).optional(),
      markdown: z.string().max(200_000).optional(),
    }),
    output: z.object({ page: pageMetaSchema }),
  },
  update: {
    input: z.object({
      id: pageId,
      title: z.string().max(200).optional(),
      icon: z.string().max(16).optional(),
      parentId: pageId.nullable().optional(),
      projectId: projectId.optional(),
      position: z.number().optional(),
      archived: z.boolean().optional(),
    }),
    output: z.object({ page: pageMetaSchema }),
  },
  remove: {
    input: z.object({ id: pageId }),
    output: z.object({ deleted: z.array(z.string()) }),
  },
  get: {
    input: z.object({ id: pageId }),
    output: z.object({ page: pageMetaSchema.nullable() }),
  },
  /** Title, description and image for a bookmark embed. */
  linkPreview: {
    input: z.object({ url: z.string().url().max(2000) }),
    output: z.object({ title: z.string(), description: z.string(), image: z.string() }),
  },
  /** Items from the other Studio add-ons, for embeds, mentions and pasted links. */
  studioItems: {
    input: z.null(),
    output: z.object({ items: z.array(studioItemSchema) }),
  },
  /** What an artifact embed shows: the latest version's bytes, or its text. */
  artifactView: {
    input: z.object({ id: z.string().min(1).max(100) }),
    output: z.object({
      view: z
        .object({
          type: z.enum(["image", "html", "markdown", "code", "text", "pdf", "other"]),
          name: z.string(),
          url: z.string(),
          text: z.string().nullable(),
        })
        .nullable(),
    }),
  },
  /** A new item of another add-on, such as a task, table or drawing, in the page's project. */
  studioCreate: {
    input: z.object({ pageId, pluginId: z.string().min(1).max(100), kind: z.string().min(1).max(100) }),
    output: z.object({ item: studioItemSchema }),
  },
  /** A live table embed reads and edits its table through Studio Tables. */
  tableGet: {
    input: z.object({ id: itemId }),
    output: z.object({ table: tableSchema.nullable() }),
  },
  tableUpdate: { input: tableUpdateSchema, output: z.object({ table: tableSchema }) },
  tablePatchRows: { input: rowPatchSchema.extend({ id: itemId }), output: z.object({ table: tableSchema }) },
  /** A table made in a page, such as from a basic table block, in the page's project. */
  tableCreate: {
    input: z.object({
      pageId,
      title: z.string().trim().min(1).max(200),
      columns: z.array(columnSchema).min(1).max(100),
      rows: z.array(valuesSchema).max(5000),
    }),
    output: z.object({ table: tableSchema }),
  },
  /** A task embed's task and its board's columns. */
  taskView: {
    input: z.object({ id: itemId }),
    output: z.object({ task: taskCardSchema.nullable(), columns: z.array(taskColumnSchema) }),
  },
  taskUpdate: {
    input: z.object({
      id: itemId,
      title: z.string().trim().min(1).max(300).optional(),
      status: z.string().min(1).max(60).optional(),
      /** With a status: the task's place in that column. */
      index: z.number().int().min(0).optional(),
      due: z.string().nullable().optional(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  /** A board embed's board and its tasks. */
  boardView: {
    input: z.object({ id: itemId }),
    output: z.object({ board: boardCardSchema.nullable(), tasks: z.array(taskCardSchema) }),
  },
  boardRename: { input: z.object({ id: itemId, title: z.string().trim().max(200) }), output: z.object({ ok: z.boolean() }) },
  /** A task added from a board embed, at the top of a column. */
  boardTaskCreate: {
    input: z.object({ boardId: itemId, title: z.string().trim().min(1).max(300), status: z.string().min(1).max(60).optional() }),
    output: z.object({ taskId: z.string() }),
  },
  /** A space widget's space, through Studio; null without Studio or the space. */
  spaceView: {
    input: z.object({ id: itemId }),
    output: z.object({ view: spaceWidgetSchema.nullable() }),
  },
  /** An item made in a space from its actions widget; returns where to open it. */
  spaceCreate: {
    input: z.object({ id: itemId, pluginId: z.string().min(1).max(100), kind: z.string().min(1).max(100) }),
    output: z.object({ href: z.string() }),
  },
  recordingView: {
    input: z.object({ id: itemId }),
    output: z.object({ recording: recordingCardSchema.nullable() }),
  },
  markdown: {
    input: z.object({ id: pageId }),
    output: z.object({ markdown: z.string() }),
  },
  /** Markdown with stable block ids, for clients without the Yjs editor. */
  editableMarkdown: {
    input: z.object({ id: pageId }),
    output: z.object({ markdown: z.string() }),
  },
  taskFromCheckbox: {
    input: z.object({ id: pageId, blockId: z.string().min(8).max(100) }),
    output: z.object({ taskId: z.string() }),
  },
  /** Compare the loaded document before applying one targeted human edit. */
  editBlock: {
    input: z.object({
      id: pageId,
      expected: z.string().max(200_000),
      block: z.string().min(4).optional(),
      markdown: z.string().max(200_000),
    }),
    output: z.object({ markdown: z.string() }),
  },
  /**
   * Compare the loaded document, then apply the whole page as plain Markdown.
   * Only changed top-level blocks are rewritten, so ids and comments survive.
   */
  editDocument: {
    input: z.object({ id: pageId, expected: z.string().max(200_000), markdown: z.string().max(200_000) }),
    output: z.object({ markdown: z.string() }),
  },
  /**
   * Saves a version named `snapshotName`, then replaces the whole page with
   * `markdown`. Open editors update live; the change is recorded as an agent's.
   */
  replaceMarkdown: {
    input: z.object({ id: pageId, markdown: z.string().max(200_000), snapshotName: z.string().trim().min(1).max(120) }),
    output: z.object({ page: pageMetaSchema }),
  },
  search: {
    input: z.object({ query: z.string().max(200), projectId: projectId.optional() }),
    output: z.object({ pages: z.array(pageMetaSchema) }),
  },
  bots: {
    input: z.null(),
    output: z.object({ available: z.boolean(), reason: z.string().nullable(), bots: z.array(botSchema) }),
  },
  requests: {
    input: z.object({ pageId }),
    output: z.object({ requests: z.array(requestSchema) }),
  },
  setRefresh: {
    input: z.object({
      id: pageId,
      refresh: z.object({ botId: z.string(), cron: z.string().min(1).max(120), instructions: z.string().max(4000) }).nullable(),
    }),
    output: z.object({ page: pageMetaSchema }),
  },
  refreshNow: {
    input: z.object({ id: pageId }),
    output: z.object({ request: requestSchema }),
  },
  /** Starts an agent thread about the page, or hands it to a bot the message @mentions. */
  work: {
    input: z.object({ id: pageId, request: chatRequestSchema }),
    output: z.object({ threadId: z.string(), botName: z.string().nullable() }),
  },
  chats: {
    input: z.object({ pageId }),
    output: z.object({ chats: z.array(z.object({ threadId: z.string(), createdAt: z.number() })) }),
  },
  /** The page a "Work with this page" thread was started from. */
  chatPage: {
    input: z.object({ threadId: z.string().min(1).max(200) }),
    output: z.object({ page: pageMetaSchema.nullable() }),
  },
  snapshots: {
    input: z.object({ id: pageId }),
    output: z.object({ snapshots: z.array(snapshotSchema) }),
  },
  snapshotBytes: {
    input: z.object({ id: pageId, snapshotId: z.string() }),
    output: z.object({ bytes: z.string().nullable() }),
  },
  snapshot: {
    input: z.object({ id: pageId, label: z.string().max(120).optional() }),
    output: z.object({ snapshot: snapshotSchema }),
  },
  restore: {
    input: z.object({ snapshotId: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  /** Comment threads for clients without the editor (the phone). Authors come named. */
  comments: {
    input: z.object({ id: pageId, includeResolved: z.boolean().optional() }),
    output: z.object({ threads: z.array(commentThreadSchema) }),
  },
  /** Blocks with text that a new comment can be anchored to. */
  commentBlocks: {
    input: z.object({ id: pageId }),
    output: z.object({ blocks: z.array(z.object({ id: z.string(), text: z.string() })) }),
  },
  /** Starts a thread as the user. An @bot in the text reaches that bot, as in the editor. */
  commentCreate: {
    input: z.object({ id: pageId, block: z.string().min(1).max(100), quote: z.string().max(500).optional(), text: commentText }),
    output: z.object({ threadId: z.string() }),
  },
  commentReply: {
    input: z.object({ id: pageId, thread: z.string().min(1).max(100), text: commentText }),
    output: z.object({ ok: z.boolean() }),
  },
  commentResolve: {
    input: z.object({ id: pageId, thread: z.string().min(1).max(100), resolved: z.boolean() }),
    output: z.object({ ok: z.boolean() }),
  },
});
