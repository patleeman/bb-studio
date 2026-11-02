// Studio's page RPC methods (Pages is built into Studio). They are the old
// Studio Pages plugin's (`pages`) client methods with a `pages.` prefix, shared by
// Studio's app and the iOS app's generated contract.
// Document content doesn't go through RPC: editors sync over Studio's
// `/pages/sync` WebSocket.
import type { defineRpcContract as sdkDefineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { conversationRequestSchema } from "./contract";

// Studio's frontend imports this file, and a plugin's frontend bundle can't
// resolve the root SDK. The SDK's helper only returns its argument.
const defineRpcContract: typeof sdkDefineRpcContract = (contract) => contract;

/** Pen colors the inline whiteboard offers. */
export const WHITEBOARD_COLORS = ["#1e1e1e", "#e03131", "#1971c2", "#2f9e44", "#f08c00"] as const;

export const whiteboardStrokeSchema = z.object({
  /** Stable across retries, so an ambiguously saved stroke merges by element id. */
  id: z.string().min(1).max(100).optional(),
  /** Scene coordinates, in drawing order. */
  points: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(1).max(5000),
  color: z.enum(WHITEBOARD_COLORS),
  width: z.number().min(0.5).max(16),
});
export type WhiteboardStroke = z.infer<typeof whiteboardStrokeSchema>;

export const whiteboardViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  updatedAt: z.number(),
  /** Scene-space viewBox [x, y, width, height]; null when the drawing is empty. */
  viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  /** Sanitized SVG markup, one `<g data-id>` per element. */
  markup: z.string(),
});
export type WhiteboardView = z.infer<typeof whiteboardViewSchema>;

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

// What BB's new-thread composer submits, whitelisted at the RPC boundary. Core
// threads.spawn validates the host-owned environment and prompt input.
export const chatRequestSchema = conversationRequestSchema(z);

export const rpcContract = defineRpcContract({
  "pages.tree": {
    /** Omit `projectId` for every page; otherwise a project's pages plus global ones. */
    input: z.object({ projectId: projectId.optional() }),
    output: z.object({ pages: z.array(pageMetaSchema) }),
  },
  "pages.create": {
    input: z.object({
      projectId,
      parentId: pageId.nullable(),
      title: z.string().max(200).default(""),
      icon: z.string().max(16).optional(),
      markdown: z.string().max(200_000).optional(),
    }),
    output: z.object({ page: pageMetaSchema }),
  },
  "pages.update": {
    input: z.object({
      id: pageId,
      title: z.string().max(200).optional(),
      expectedTitle: z.string().max(200).optional(),
      icon: z.string().max(16).optional(),
      parentId: pageId.nullable().optional(),
      projectId: projectId.optional(),
      position: z.number().optional(),
      archived: z.boolean().optional(),
    }),
    output: z.object({ page: pageMetaSchema }),
  },
  "pages.remove": {
    input: z.object({ id: pageId }),
    output: z.object({ deleted: z.array(z.string()) }),
  },
  "pages.get": {
    input: z.object({ id: pageId }),
    output: z.object({ page: pageMetaSchema.nullable() }),
  },
  /** Title, description and image for a bookmark embed. */
  "pages.linkPreview": {
    input: z.object({ url: z.string().url().max(2000) }),
    output: z.object({ title: z.string(), description: z.string(), image: z.string() }),
  },
  /** Items from the other Studio add-ons, for embeds, mentions and pasted links. */
  "pages.studioItems": {
    input: z.null(),
    output: z.object({ items: z.array(studioItemSchema) }),
  },
  /** What an artifact embed shows: the latest version's bytes, or its text. */
  "pages.artifactView": {
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
  /** Hands a checklist item to an agent: a new thread with the item as its prompt, mentioned on the item. */
  "pages.checklistHandOff": {
    input: z.object({ id: pageId, blockId: z.string().min(4).max(100), note: z.string().max(20_000).nullable().optional() }),
    output: z.object({ threadId: z.string() }),
  },
  /** A drawing embed's scene as SVG, for the inline whiteboard; null when it's gone. */
  "pages.whiteboardGet": { input: z.object({ id: itemId }), output: z.object({ whiteboard: whiteboardViewSchema.nullable() }) },
  /** Pen strokes and erasures from the inline whiteboard, merged into the drawing by Studio Draw. */
  "pages.whiteboardSave": {
    input: z.object({ id: itemId, add: z.array(whiteboardStrokeSchema).max(200), erase: z.array(z.string().min(1).max(200)).max(2000) }),
    output: z.object({ whiteboard: whiteboardViewSchema }),
  },
  /** A new item of another add-on, such as a drawing, in the page's project. */
  "pages.studioCreate": {
    input: z.object({ pageId, pluginId: z.string().min(1).max(100), kind: z.string().min(1).max(100) }),
    output: z.object({ item: studioItemSchema }),
  },

  "pages.recordingView": {
    input: z.object({ id: itemId }),
    output: z.object({ recording: recordingCardSchema.nullable() }),
  },
  "pages.markdown": {
    input: z.object({ id: pageId }),
    output: z.object({ markdown: z.string() }),
  },
  /** Markdown with stable block ids, for clients without the Yjs editor. */
  "pages.editableMarkdown": {
    input: z.object({ id: pageId }),
    output: z.object({ markdown: z.string() }),
  },
  /**
   * Compare the loaded document, then apply the whole page as plain Markdown.
   * Only changed top-level blocks are rewritten, so ids and comments survive.
   */
  "pages.editDocument": {
    input: z.object({ id: pageId, expected: z.string().max(200_000), markdown: z.string().max(200_000) }),
    output: z.object({ markdown: z.string() }),
  },
  /**
   * Saves a version named `snapshotName`, then replaces the whole page with
   * `markdown`. Open editors update live; the change is recorded as an agent's.
   */
  "pages.replaceMarkdown": {
    input: z.object({ id: pageId, markdown: z.string().max(200_000), snapshotName: z.string().trim().min(1).max(120) }),
    output: z.object({ page: pageMetaSchema }),
  },
  "pages.search": {
    input: z.object({ query: z.string().max(200), projectId: projectId.optional() }),
    output: z.object({ pages: z.array(pageMetaSchema) }),
  },
  /** Historical requests remain readable after bot profiles are removed. */
  "pages.requests": { input: z.object({ pageId }), output: z.object({ requests: z.array(requestSchema) }) },
  /** Starts an ordinary agent thread about the page. */
  "pages.work": {
    input: z.object({ id: pageId, request: chatRequestSchema }),
    output: z.object({ threadId: z.string(), botName: z.string().nullable() }),
  },
  "pages.chats": {
    input: z.object({ pageId }),
    output: z.object({ chats: z.array(z.object({ threadId: z.string(), createdAt: z.number() })) }),
  },
  /** The page a "Work with this page" thread was started from. */
  "pages.chatPage": {
    input: z.object({ threadId: z.string().min(1).max(200) }),
    output: z.object({ page: pageMetaSchema.nullable() }),
  },
  "pages.snapshots": {
    input: z.object({ id: pageId }),
    output: z.object({ snapshots: z.array(snapshotSchema) }),
  },
  "pages.snapshotBytes": {
    input: z.object({ id: pageId, snapshotId: z.string() }),
    output: z.object({ bytes: z.string().nullable() }),
  },
  "pages.snapshot": {
    input: z.object({ id: pageId, label: z.string().max(120).optional() }),
    output: z.object({ snapshot: snapshotSchema }),
  },
  "pages.restore": {
    input: z.object({ snapshotId: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  /** Comment threads for clients without the editor (the phone). Authors come named. */
  "pages.comments": {
    input: z.object({ id: pageId, includeResolved: z.boolean().optional() }),
    output: z.object({ threads: z.array(commentThreadSchema) }),
  },
  /** Blocks with text that a new comment can be anchored to. */
  "pages.commentBlocks": {
    input: z.object({ id: pageId }),
    output: z.object({ blocks: z.array(z.object({ id: z.string(), text: z.string() })) }),
  },
  /** Starts a page comment thread as the user. */
  "pages.commentCreate": {
    input: z.object({ id: pageId, block: z.string().min(1).max(100), quote: z.string().max(500).optional(), text: commentText }),
    output: z.object({ threadId: z.string() }),
  },
  "pages.commentReply": {
    input: z.object({ id: pageId, thread: z.string().min(1).max(100), text: commentText }),
    output: z.object({ ok: z.boolean() }),
  },
  "pages.commentResolve": {
    input: z.object({ id: pageId, thread: z.string().min(1).max(100), resolved: z.boolean() }),
    output: z.object({ ok: z.boolean() }),
  },
});

/** Where Studio serves page files; the old plugin served them at /api/v1/plugins/pages/http/files. */
export const PAGE_FILES_URL = "/api/v1/plugins/studio/http/pages/files";
export const LEGACY_PAGE_FILES_URL = "/api/v1/plugins/pages/http/files";

/** An old page file address as Studio's; other URLs unchanged. */
export function studioFileUrl(url: string): string {
  return url.startsWith(`${LEGACY_PAGE_FILES_URL}?`) ? `${PAGE_FILES_URL}${url.slice(LEGACY_PAGE_FILES_URL.length)}` : url;
}

/** The Next row's default preferred quick replies. */
export const DEFAULT_REPLIES = ["👍 Looks good", "🔁 Try another way", "❓ Explain more"];

/**
 * Pages' and Explore's settings, which Studio has now under the same keys
 * (Explore's keep their `explore_` prefix).
 */
export const PAGES_SETTINGS = {
  snapshotsPerPage: {
    type: "number" as const,
    label: "Saved versions per page",
    description: "Keep the newest 1 to 1000 versions of each page, or 0 to keep all. Lowering this limit removes older versions the next time that page saves a version.",
    default: 50,
    experimental_schema: z.number().int().min(0).max(1000),
  },
  explore_next: {
    type: "boolean" as const,
    label: "Explore: End replies with a Next row",
    description:
      "Agents end replies with one row of next steps: quick replies, things to explore, and actions they can take. Applies to agent sessions started after the change.",
    default: true,
  },
  explore_explore: {
    type: "boolean" as const,
    label: "Explore: Suggest things to explore",
    description:
      "Agents end answers that involved reading code with a few things they noticed along the way, in the Next row when it's on. Click one to ask the agent about it. Applies to agent sessions started after the change.",
    default: true,
  },
  explore_quickReplies: {
    type: "boolean" as const,
    label: "Explore: Offer quick replies",
    description:
      "When a reply asks you something, the Next row offers quick answers to it. Applies to agent sessions started after the change.",
    default: true,
  },
  explore_replyItems: {
    type: "string" as const,
    label: "Explore: Preferred quick replies",
    description:
      "Emoji and label pairs, such as \"👍 Looks good\", separated by commas or lines. Agents use these when they fit and write specific ones otherwise. Applies to agent sessions started after the change.",
    default: DEFAULT_REPLIES.join(", "),
  },
};

export const pagesSettingsSchema = z.object({
  snapshotsPerPage: z.number().int().min(0).max(1000),
  explore_next: z.boolean(),
  explore_explore: z.boolean(),
  explore_quickReplies: z.boolean(),
  explore_replyItems: z.string().max(10_000),
}).partial();
export type PagesSettings = z.infer<typeof pagesSettingsSchema>;
