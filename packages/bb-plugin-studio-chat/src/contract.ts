import { defineRpcContract, type NewThreadRequest } from "@get-bb/plugin-sdk";
import { studioSchemas } from "@bb-studio/kit/contract";
import { z } from "zod";

export const schemas = studioSchemas(z);

export { MENTION_PROVIDER_ID } from "./ids";

const ref = z.object({ pluginId: z.string().min(1).max(100), id: z.string().min(1).max(200) });
export type ItemRef = z.infer<typeof ref>;

/** The Studio item on screen, as the chat shows it. */
const viewed = z.object({
  pluginId: z.string(),
  id: z.string(),
  kind: z.string(),
  /** "Page", "Drawing"; the kind id when Studio doesn't know the kind. */
  kindLabel: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  kindIcon: z.string(),
  projectId: z.string().nullable(),
  href: z.string(),
});
export type Viewed = z.infer<typeof viewed>;

// What BB's new-thread composer submits, whitelisted as Pages does. Core
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

/** Pages' own chat methods, which Studio Chat uses for pages so their chats stay in Pages. */
export const pagesSchemas = {
  work: z.object({ threadId: z.string(), botName: z.string().nullable() }),
  chats: z.object({ chats: z.array(z.object({ threadId: z.string(), createdAt: z.number() })) }),
};

export const rpcContract = defineRpcContract({
  /** The Studio item whose view is at `path`, if any. */
  viewing: {
    input: z.object({ path: z.string().min(1).max(2000) }),
    output: z.object({ item: viewed.nullable() }),
  },
  /** Starts a thread about `item`, or a plain one. */
  start: {
    input: z.object({ item: ref.nullable(), request: chatRequestSchema }),
    output: z.object({ threadId: z.string() }),
  },
  /** The thread last used on an item, so reopening it brings its chat back. */
  lastThread: {
    input: ref,
    output: z.object({ threadId: z.string().nullable() }),
  },
  /** Remembers the thread in use on an item. */
  link: {
    input: ref.extend({ threadId: z.string().min(1).max(200) }),
    output: z.object({ ok: z.boolean() }),
  },
});
