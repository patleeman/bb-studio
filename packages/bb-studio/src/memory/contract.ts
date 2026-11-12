// Memory's RPC contract (README "Memory" has the request and response
// shapes). Every method takes an optional `botId`; without one it acts on
// the primary Bot. External Bots (Studio Agents) keep their own memory, so
// every method refuses them.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MEMORY_SOURCE_KINDS } from "./shared";

const botId = z.string().min(1).optional();
const topic = z.string().trim().min(1).max(60);
const text = z.string().trim().min(1).max(4000);

/** Where a record came from: a conversation or worker thread, another thread, a page (and its section), or the user by hand. */
export const memorySource = z.object({
  kind: z.enum(MEMORY_SOURCE_KINDS),
  /** The thread or page id; null for "manual". */
  id: z.string().nullable(),
  title: z.string(),
  /** The page section a record was split from; null elsewhere. */
  section: z.string().nullable(),
});
export type MemorySource = z.infer<typeof memorySource>;

/** A source as given by a caller: the id is required except for "manual", the title is looked up when left out. */
export const memorySourceInput = z.object({
  kind: z.enum(MEMORY_SOURCE_KINDS),
  id: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  section: z.string().trim().min(1).max(200).optional(),
}).refine((source) => source.kind === "manual" || !!source.id, { message: "A conversation, worker, thread or page source needs its id." });
export type MemorySourceInput = z.infer<typeof memorySourceInput>;

export const memoryRecordView = z.object({
  id: z.string(),
  botId: z.string(),
  topic: z.string(),
  text: z.string(),
  /** When the fact was recorded (for split records: the date in its text, else the page's). */
  createdAt: z.number(),
  updatedAt: z.number(),
  source: memorySource,
  /** For a thread source: "finished" once the thread is archived, "missing" once it's gone; null for other sources or when unknown. */
  sourceState: z.enum(["live", "finished", "missing"]).nullable(),
  replacesId: z.string().nullable(),
  /** The record this one replaces, for "replaces “…” (date)". */
  replaces: z.object({ id: z.string(), text: z.string(), createdAt: z.number() }).nullable(),
  replacedById: z.string().nullable(),
  /** When it was replaced (the newer record's date); null while current. */
  replacedAt: z.number().nullable(),
  archived: z.boolean(),
});
export type MemoryRecordView = z.infer<typeof memoryRecordView>;

export const MEMORY_SORTS = ["relevance", "newest", "oldest", "topic"] as const;
export const memoryListInput = z.object({
  botId,
  /** Full-text search over topic and text; empty lists everything. */
  query: z.string().max(500).optional(),
  topic: z.string().trim().min(1).max(60).optional(),
  /** Default: relevance with a query, newest without. Current records always come before replaced ones. */
  sort: z.enum(MEMORY_SORTS).optional(),
  /** Default true: replaced records are listed after current ones, flagged. */
  includeReplaced: z.boolean().optional(),
  /** Default false. */
  includeArchived: z.boolean().optional(),
  /** Default 200. */
  limit: z.number().int().min(1).max(500).optional(),
});

const profileView = z.object({
  pageId: z.string(),
  title: z.string(),
  updatedAt: z.number(),
  /** Its length in characters, and the cap the Bot's instructions take (PROFILE_CAP_CHARS). */
  chars: z.number(),
  cap: z.number(),
  over: z.boolean(),
});

/**
 * "needed": the Bot still has an old Memory page and no core profile (it is
 * split on its own, so this only lasts until the split runs);
 * "done": the page was split (it stays as it was, at legacyPageId);
 * "none": nothing to split (a Bot made with a core profile, or no page yet).
 */
const splitState = z.object({
  state: z.enum(["needed", "done", "none"]),
  legacyPageId: z.string().nullable(),
  legacyTitle: z.string().nullable(),
  splitAt: z.number().nullable(),
});

export const memoryRpcContract = defineRpcContract({
  /** The Memory view's header and left column: the Bot, its core profile, the split state, counts and topics by frequency. Splits a Bot's old Memory page first if that hasn't happened yet. */
  "memory.get": { input: z.object({ id: z.string().min(1).max(200) }), output: z.object({ record: memoryRecordView.nullable() }) },
  "memory.overview": {
    input: z.object({ botId }),
    output: z.object({
      bot: z.object({ id: z.string(), name: z.string() }),
      profile: profileView.nullable(),
      split: splitState,
      counts: z.object({ current: z.number(), replaced: z.number(), archived: z.number() }),
      topics: z.array(z.object({ topic: z.string(), count: z.number() })),
    }),
  },
  /** Records, searched and filtered. */
  "memory.list": { input: memoryListInput, output: z.object({ records: z.array(memoryRecordView), total: z.number() }) },
  /** A new record; without a source it's the user's own ("manual"). */
  "memory.add": { input: z.object({ botId, topic, text, source: memorySourceInput.optional() }), output: z.object({ record: memoryRecordView }) },
  /** A correction: a NEW record that replaces `id`, which stays as history. */
  "memory.update": { input: z.object({ botId, id: z.string().min(1), text, topic: topic.optional() }), output: z.object({ record: memoryRecordView, replaced: memoryRecordView }) },
  /** Archive (hide from the Bot's search and the list) or restore a record. */
  "memory.archive": { input: z.object({ botId, id: z.string().min(1), archived: z.boolean() }), output: z.object({ record: memoryRecordView }) },
  /** The core profile's text as the Bot gets it, for clients without the page editor. Null before there is one. */
  "memory.profile": { input: z.object({ botId }), output: z.object({ profile: profileView.extend({ markdown: z.string() }).nullable() }) },
});
export type MemoryRpcContract = typeof memoryRpcContract;
