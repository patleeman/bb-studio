// Studio Feed's RPC surface for its app. Zod only, so the app can import the
// types without server code.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { conversationRequestSchema } from "@bb-studio/kit/contract";
import { automaticContract } from "./automatic-contract";
import { z } from "zod";
import { MAX_BODY, MAX_STORY, MAX_TITLE, MAX_TOPIC, PRIORITIES } from "./shared";

const postId = z.string().min(1).max(100);
const story = z.string().trim().min(1).max(MAX_STORY);

export const postSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Markdown. */
  body: z.string(),
  /** One line of the body, for a collapsed row. */
  preview: z.string(),
  /** Link domains in the body. */
  domains: z.array(z.string()),
  /** Its picture: the body's first image, or the preview image of the page it links to. */
  image: z.string().nullable(),
  /** The posting bot's avatar (an emoji), when a bot posted it. */
  avatar: z.string().nullable(),
  /** The page the body links to first, with its preview when it has one. */
  link: z.object({ url: z.string(), domain: z.string(), title: z.string(), description: z.string(), image: z.string() }).nullable(),
  /** Studio items the body links to (pages, artifacts, drawings…), with what they show inline. */
  embeds: z.array(
    z.object({
      pluginId: z.string(),
      id: z.string(),
      /** "Page", "Artifact". */
      kind: z.string(),
      title: z.string(),
      icon: z.string().nullable(),
      thumbnailUrl: z.string().nullable(),
      /** App path that opens it. */
      href: z.string(),
      updatedAt: z.number(),
      /** Markdown for a page or a text artifact; a URL for an image, HTML or PDF artifact. */
      content: z.object({ type: z.enum(["markdown", "image", "html", "pdf"]), text: z.string().nullable(), url: z.string().nullable() }).nullable(),
    }),
  ),
  /** A finding Explore (in Studio Pages) saved here: Explore can write a page explaining it. */
  explorable: z.boolean(),
  /** The title of the thread it came from. */
  threadTitle: z.string().nullable(),
  read: z.boolean(),
  topic: z.string().nullable(),
  story: z.string().nullable(),
  /** Posts in the story; 1 for a post on its own. */
  storyPosts: z.number(),
  priority: z.enum(PRIORITIES),
  /** A bot's name, the thread's title, or "CLI". */
  author: z.string(),
  botId: z.string().nullable(),
  threadId: z.string().nullable(),
  projectId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Who last edited it: an agent's thread, or "you". */
  editedBy: z.string().nullable(),
  resolvedAt: z.number().nullable(),
});

export type PostView = z.infer<typeof postSchema>;

export const rpcContract = defineRpcContract({
  ...automaticContract,
  /** Outstanding urgent posts, independent of read state and the reader's filters. */
  attention: {
    input: z.object({ cursor: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).optional() }),
    output: z.object({ posts: z.array(postSchema), nextCursor: z.string().nullable() }),
  },
  /** The feed, newest first: a story once, by its newest post. */
  list: {
    input: z.object({
      cursor: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      topic: z.string().max(MAX_TOPIC).nullable().optional(),
      query: z.string().max(200).optional(),
      unread: z.boolean().optional(),
      /** A time window, for one day's edition. */
      since: z.number().optional(),
      until: z.number().optional(),
    }),
    output: z.object({ posts: z.array(postSchema), nextCursor: z.string().nullable(), lastSeenAt: z.number() }),
  },
  /** Marks a post read or unread, with the rest of its story. */
  read: {
    input: z.object({ postId, read: z.boolean() }),
    output: z.object({ post: postSchema.nullable() }),
  },
  post: {
    input: z.object({ postId }),
    output: z.object({ post: postSchema.nullable() }),
  },
  discussion: {
    input: z.object({ postId, request: conversationRequestSchema(z) }),
    output: z.object({ threadId: z.string() }),
  },
  /** A story's posts, oldest first. */
  story: {
    input: z.object({ story }),
    output: z.object({ posts: z.array(postSchema) }),
  },
  /** The post a reply's `::post` line made, for its card. */
  forDirective: {
    input: z.object({ source: z.string().min(1).max(4_000) }),
    output: z.object({ post: postSchema.nullable() }),
  },
  topics: {
    input: z.object({}),
    output: z.object({ topics: z.array(z.object({ topic: z.string(), posts: z.number() })) }),
  },
  /** A post from another plugin, such as Explore in Studio Pages. */
  publish: {
    input: z.object({
      title: z.string().trim().min(1).max(MAX_TITLE),
      body: z.string().max(MAX_BODY),
      topic: z.string().trim().max(MAX_TOPIC).nullable().optional(),
      story: z.string().max(MAX_STORY).nullable().optional(),
      priority: z.enum(PRIORITIES).optional(),
      author: z.string().trim().min(1).max(80),
      threadId: z.string().max(200).nullable().optional(),
      projectId: z.string().max(200).nullable().optional(),
    }),
    output: z.object({ post: postSchema }),
  },
  /** Asks Explore in Studio Pages to write a page explaining a finding it saved here; the post links it when it's done. */
  explore: {
    input: z.object({ postId }),
    output: z.object({ status: z.enum(["started", "ready", "unavailable"]), href: z.string().nullable() }),
  },
  edit: {
    input: z.object({
      postId,
      title: z.string().trim().min(1).max(MAX_TITLE).optional(),
      body: z.string().max(MAX_BODY).optional(),
      topic: z.string().trim().max(MAX_TOPIC).nullable().optional(),
      priority: z.enum(PRIORITIES).optional(),
      resolved: z.boolean().optional(),
    }),
    output: z.object({ post: postSchema.nullable() }),
  },
  remove: {
    input: z.object({ postId }),
    output: z.object({ removed: z.boolean() }),
  },
  /** Marks everything up to now read. */
  seen: {
    input: z.object({ at: z.number().optional() }),
    output: z.object({ lastSeenAt: z.number() }),
  },
  /** Stories with an unread post. */
  unread: {
    input: z.object({}),
    output: z.object({ count: z.number(), lastSeenAt: z.number() }),
  },
});
