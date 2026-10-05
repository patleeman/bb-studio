import { defineRpcContract } from "@get-bb/plugin-sdk";
import { conversationRequestSchema, studioSchemas } from "./contract";
import { z } from "zod";
import { quote, ref } from "./chat-schemas";

export const schemas = studioSchemas(z);

export const MENTION_PROVIDER_ID = "item";

export type { ItemRef } from "./chat-schemas";

const homeThread = z.object({ threadId: z.string(), title: z.string(), origin: z.enum(["chosen", "created"]) });

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
export const chatRequestSchema = conversationRequestSchema(z);

/** Pages' own chat methods, which Studio Chat uses for pages so their chats stay in Pages. */
export const pagesSchemas = {
  work: z.object({ threadId: z.string(), botName: z.string().nullable() }),
  chats: z.object({ chats: z.array(z.object({ threadId: z.string(), createdAt: z.number() })) }),
};

export const legacyChatContract = defineRpcContract({
  /** The Studio item whose view is at `path`, if any. */
  viewing: {
    input: z.object({ path: z.string().min(1).max(2000) }),
    output: z.object({ item: viewed.nullable() }),
  },
  /** Resolves the item a Chat action targets. */
  subject: {
    input: ref,
    output: z.object({ item: viewed.nullable() }),
  },
  /** Starts a thread about `item`, or a plain one. */
  start: {
    input: z.object({ item: ref.nullable(), request: chatRequestSchema }),
    output: z.object({ threadId: z.string() }),
  },
  /**
   * The item's home thread, where its chat and quotes go: the one started or
   * picked for it, else the thread that made it.
   */
  home: {
    input: ref,
    output: z.object({ thread: homeThread.nullable() }),
  },
  /** Makes `threadId` the item's home thread. */
  link: {
    input: ref.extend({ threadId: z.string().min(1).max(200) }),
    output: z.object({ thread: homeThread.nullable() }),
  },
  /** Leaves the item without a home thread, until one is started or picked. */
  unlink: {
    input: ref,
    output: z.object({ ok: z.boolean() }),
  },
  /** Sends a quote to the item's home thread; null when it has none. */
  send: {
    input: z.object({ item: ref, quote }),
    output: z.object({ threadId: z.string().nullable() }),
  },
});

/** Chat is owned by Studio; legacy method names stay in the upgrade bridge. */
export const rpcContract = defineRpcContract({
  "chat.viewing": legacyChatContract.viewing,
  "chat.subject": legacyChatContract.subject,
  "chat.start": legacyChatContract.start,
  "chat.home": legacyChatContract.home,
  "chat.link": legacyChatContract.link,
  "chat.unlink": legacyChatContract.unlink,
  "chat.send": legacyChatContract.send,
  "chat.importLinks": {
    input: z.object({ links: z.array(z.object({ item: ref, threadId: z.string().min(1).max(200).nullable(), at: z.number().finite().nonnegative() })).max(250) }),
    output: z.object({ imported: z.number().int().nonnegative() }),
  },
});
