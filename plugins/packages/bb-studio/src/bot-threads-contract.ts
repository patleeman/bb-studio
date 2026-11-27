// The RPC for one Bot, many conversations (src/bot-threads.ts): the Bots as
// spaces, a Bot's conversations and workers, one thread's place, the Bot's
// files (Library), and the user's changes. Spread into Studio's contract
// (src/contract.ts). Every change publishes Studio's realtime channel
// (`studio_changed`), so open views reload. The README's "Conversations and
// workers: the API" section lists each method with its shapes for clients
// (the desktop app now, the iOS app later).
import { appearanceSchema } from "./theme/appearance";
import { presenceSchema } from "./presence/schema";
import { conversationRequestSchema } from "./kit/contract";
import { z } from "zod";

const threadId = z.string().min(1).max(200);
const botId = z.string().min(1).max(100);

/** BB's new-thread request, as its composer submits it. */
const newConversationRequest = conversationRequestSchema(z);
export type NewConversationRequest = z.output<typeof newConversationRequest>;

const kind = z.enum(["conversation", "worker"]);
const workerStatus = z.enum(["running", "needs-you", "failed", "done"]);
const needsYou = z.object({ reason: z.string(), at: z.number() });

/** One Bot as a space: the dot at the bottom of the sidebar. */
const space = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string(),
  shape: z.string().nullable(),
  color: z.string().nullable(),
  primary: z.boolean(),
  /** Its Main conversation (its chat thread); null before it has one. */
  mainThreadId: z.string().nullable(),
  /** A conversation of this Bot needs the user: its dot is amber. */
  needsYou: z.boolean(),
  appearance: appearanceSchema.nullable(),
  presence: presenceSchema.optional(),
  activity: z.object({ turn: z.boolean(), workers: z.number().int().min(0) }).optional(),
  /** Paused (bot_pause) or stopped (bot_stop): the phone shows Resume. Absent on an older Studio. */
  state: z.enum(["active", "paused", "stopped"]).optional(),
});

const conversation = z.object({
  threadId: z.string(),
  title: z.string(),
  isMain: z.boolean(),
  /** The conversation it was forked from, and where: a reply's message id (a side thread) or the last copied turn (BB's fork), when known. */
  forkedFrom: z.object({ threadId: z.string(), messageId: z.string().nullable(), turnId: z.string().nullable(), title: z.string() }).nullable(),
  projectId: z.string().nullable(),
  /** Last activity (ms). */
  updatedAt: z.number(),
  /** The latest reply's first line. */
  latest: z.string().nullable(),
  running: z.boolean(),
  needsYou: needsYou.nullable(),
  /** Mirrored from bb and not taken over: `running` and `needsYou` are bb's, which the app's live view of the copy here doesn't know. */
  mirrored: z.boolean(),
  /** The agent provider it runs on (BB's provider id, e.g. `claude-code`); null when BB doesn't say. */
  providerId: z.string().nullable().optional(),
  /** Its model's display name ("Opus 5.5"); null when not included in the loaded thread data. */
  modelName: z.string().nullable().optional(),
  /** Open tabs in its Workspace (the "· 4 tabs" subtitle); 0 when none. */
  tabCount: z.number().int().min(0).optional(),
});

const worker = z.object({
  threadId: z.string(),
  title: z.string(),
  status: workerStatus,
  /** The conversation that started it (else the Bot's Main). */
  ownerConversationId: z.string().nullable(),
  ownerTitle: z.string().nullable(),
  projectId: z.string().nullable(),
  updatedAt: z.number(),
  /** The repo or worktree it runs in, and its branch. */
  tag: z.string().nullable(),
  branch: z.string().nullable(),
  /** Mirrored from bb and not taken over: `status` is bb's, which the app's live view of the copy here doesn't know. */
  mirrored: z.boolean(),
  /** How many finished workers with this title the sidebar row stands for (it is the newest; the older list has the rest); 1 when alone. */
  sameTitle: z.number().int().min(1),
  /** As a conversation's. */
  providerId: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
  /** The worker of this Bot that started it (a worker of a worker); null when a conversation did. */
  spawnedBy: z.string().nullable().optional(),
  /** bot_threads_view: the conversation row it nests under in the sidebar (its owner, or the row a fork owner folds into); null when no listed row is its. */
  nestUnder: z.string().nullable().optional(),
  /** bot_threads_view: "runners" for the Bot's own threads (area runners, automation and check-in runs), which the sidebar folds under its Main. */
  fold: z.enum(["runners"]).nullable().optional(),
});

/** A row of the Conversations page: a conversation, active or archived. */
const pageConversation = z.object({
  threadId: z.string(),
  title: z.string(),
  isMain: z.boolean(),
  forkedFrom: z.object({ threadId: z.string(), title: z.string() }).nullable(),
  projectId: z.string().nullable(),
  /** Last activity (ms). */
  updatedAt: z.number(),
  /** When it was archived; null while active. */
  archivedAt: z.number().nullable(),
  /** Its summary's first line or two (from finishing it); null without one. */
  summary: z.string().nullable(),
  /** The latest reply's first line. */
  latest: z.string().nullable(),
  running: z.boolean(),
  needsYou: needsYou.nullable(),
  /** Its last turn failed. */
  failed: z.boolean(),
});

/** A search hit: where it matched (title, summary, or a message) and one line of it. */
const conversationHit = z.object({
  threadId: z.string(),
  kind,
  field: z.enum(["title", "summary", "message"]),
  snippet: z.string().nullable(),
});

/** One thread's place: its Bot, kind and links, for the main view. */
const threadInfo = z.object({
  threadId: z.string(),
  botId: z.string(),
  botName: z.string(),
  kind,
  isMain: z.boolean(),
  title: z.string(),
  forkedFrom: z.object({ threadId: z.string(), messageId: z.string().nullable(), turnId: z.string().nullable(), title: z.string() }).nullable(),
  /** A worker's conversation. */
  owner: z.object({ threadId: z.string(), title: z.string() }).nullable(),
  /** A worker's state; null for a conversation. */
  status: workerStatus.nullable(),
  /** What a waiting worker waits on: an approval (a card in its conversation) or a question (it can be answered on the worker). */
  waitingOn: z.enum(["approval", "question"]).nullable(),
  /** When the thread was started (ms). */
  startedAt: z.number(),
  tag: z.string().nullable(),
  branch: z.string().nullable(),
  archivedAt: z.number().nullable(),
  /** What a finished conversation decided; it is finished when this is set and `archivedAt` too. */
  finishedSummary: z.string().nullable(),
  /** Finish was pressed and the conversation is writing its summary. */
  finishing: z.boolean(),
  needsYou: needsYou.nullable(),
  projectId: z.string().nullable(),
  /** A conversation's workers the sidebar lists (running or waiting first, then recently failed or done), at most 12 (the line above its composer). */
  workers: z.array(z.object({ threadId: z.string(), title: z.string(), status: workerStatus })),
});

const libraryKind = z.enum(["page", "whiteboard", "design", "app", "artifact", "recording", "other"]);
const libraryItem = z.object({
  pluginId: z.string(),
  id: z.string(),
  title: z.string(),
  /** The Library's flat kind; `type` is the item's own (doc, mini, artifact…), `format` a saved file's (markdown, html, image…). */
  kind: libraryKind,
  type: z.string().nullable(),
  format: z.string().nullable().optional(),
  href: z.string().nullable(),
  updatedAt: z.number(),
  createdAt: z.number().nullable(),
  /** Who made it: a conversation or a worker of the Bot; null when the user made it themselves, or the Bot outside its threads (`byBot`). */
  madeIn: z.object({ threadId: z.string(), title: z.string(), kind, conversationId: z.string().nullable(), conversationTitle: z.string().nullable() }).nullable(),
  starred: z.boolean().optional(),
  byBot: z.boolean().optional(),
});

/** A finished conversation, for Main's card and the finished banner (src/bot-finish.ts). */
const finished = z.object({
  threadId: z.string(),
  botId: z.string(),
  title: z.string(),
  /** Markdown: **Decisions**, **Left open**, **Made**. */
  summary: z.string(),
  startedAt: z.number(),
  finishedAt: z.number(),
  /** Memory records that cite the conversation. */
  records: z.number(),
  memoryHref: z.string(),
  /** Still finished (false once reopened). */
  archived: z.boolean(),
});

export const botThreadsSchemas = {
  /** Every Bot as a space, the primary first, with whether one needs the user; and the current Bot. */
  bot_spaces: { input: z.object({}), output: z.object({ bots: z.array(space), currentBotId: z.string().nullable() }) },
  /** A Bot's sidebar (the current Bot without `botId`): conversations, Main first, then by activity; workers, running first. */
  bot_threads_view: {
    input: z.object({ botId: botId.optional() }),
    output: z.object({
      botId: z.string().nullable(), conversations: z.array(conversation), workers: z.array(worker),
      /**
       * Workers no row stands for: failed more than 7 days or done more than
       * 2 days ago, past 30 running, or past the 5 newest finished (same
       * titles folded into one row, `sameTitle`).
       */
      hiddenWorkers: z.number(),
      /** Of `hiddenWorkers`, the ones that finished in the last 24 hours ("N more done today"). */
      hiddenToday: z.number(),
      /** Conversations left out: not active in 14 days, not working, not needing the user. */
      olderConversations: z.number(),
    }),
  },
  /** What the sidebar leaves out ("N older conversations", "N older workers"), newest first, and the finished conversations, newest first. */
  bot_threads_older: {
    input: z.object({ botId: botId.optional() }),
    output: z.object({
      botId: z.string().nullable(), conversations: z.array(conversation), workers: z.array(worker),
      finished: z.array(z.object({ threadId: z.string(), title: z.string(), finishedAt: z.number(), summary: z.string(), failed: z.boolean().optional() })),
    }),
  },
  /**
   * The Conversations page: every conversation of a Bot, active first (Main,
   * then by last activity), then the archived ones by last activity; and its
   * workers that aren't archived, newest first.
   */
  bot_conversations_all: {
    input: z.object({ botId: botId.optional() }),
    output: z.object({ botId: z.string().nullable(), conversations: z.array(pageConversation), workers: z.array(worker) }),
  },
  /**
   * Memory's History → Summaries: the archived conversations that have a
   * summary, newest first, each with its whole summary (Decisions, Left
   * open, Made) as finishing wrote it on the conversation.
   */
  bot_summaries: {
    input: z.object({ botId: botId.optional() }),
    output: z.object({ botId: z.string().nullable(), summaries: z.array(z.object({ threadId: z.string(), title: z.string(), archivedAt: z.number(), summary: z.string() })) }),
  },
  /**
   * Searches a Bot's conversations (titles, summaries and messages) and its
   * workers (titles, and messages BB's search reaches): each hit with where
   * it matched and a one-line snippet. `indexing`: some conversations'
   * messages aren't read yet, so a later search may find more.
   */
  bot_conversations_search: {
    input: z.object({ botId: botId.optional(), query: z.string().trim().min(1).max(200) }),
    output: z.object({ hits: z.array(conversationHit), indexing: z.boolean() }),
  },
  /** One thread's place; null for a thread no Bot has (yet). */
  bot_thread_info: { input: z.object({ threadId }), output: z.object({ info: threadInfo.nullable() }) },
  /** Where switching to a Bot lands: `last` while it still exists, else the Bot's Main, else null. */
  bot_landing: { input: z.object({ botId, last: threadId.nullable() }), output: z.object({ threadId: z.string().nullable() }) },
  /** The Bot the sidebar shows: the thread the user starts next is its conversation. */
  bot_focus: { input: z.object({ botId }), output: z.object({ ok: z.boolean() }) },
  /**
   * Sends `text` to the Bot in the worker's conversation (Main when it has
   * none), with a link to the worker first. Answers the conversation.
   */
  bot_worker_ask: { input: z.object({ threadId, text: z.string().trim().min(1).max(20_000) }), output: z.object({ conversationId: z.string(), projectId: z.string().nullable() }) },
  /** The user renames a conversation (null: BB's title) or archives or brings it back. Archiving Main archives its thread in BB, and the Bot gets a new Main. */
  bot_thread_update: { input: z.object({ threadId, title: z.string().max(200).nullable().optional(), archived: z.boolean().optional() }), output: z.object({ ok: z.boolean() }) },
  /** Marks a conversation as needing the user with a reason, or clears it (null). */
  bot_needs_you_set: { input: z.object({ threadId, reason: z.string().max(200).nullable() }), output: z.object({ ok: z.boolean() }) },
  /**
   * Finish a conversation (not Main, not a worker, not while it works): one
   * last turn asks it to save its summary to memory and call
   * bot_finish_done; then it is archived and Main gets the card. Studio
   * writes the summary itself if the turn ends without it.
   */
  bot_finish: { input: z.object({ threadId }), output: z.object({ state: z.enum(["finishing", "finished", "reopened"]) }) },
  /**
   * "Fork conversation from here" in a message's ··· menu: BB forks the
   * thread after that message (`sourceSeqEnd`, from the menu), and the fork
   * is a conversation of the same Bot, linked back to the message. Answers
   * the new thread.
   */
  bot_fork_conversation: {
    input: z.object({ threadId, messageId: z.string().min(1).max(200), turnId: z.string().max(200).nullable(), sourceSeqEnd: z.number().int().min(0) }),
    output: z.object({ threadId: z.string(), projectId: z.string().nullable() }),
  },
  bot_thread_reply: {
    input: z.object({ threadId, messageId: z.string().min(1).max(200), turnId: z.string().max(200).nullable().optional(), sourceSeqEnd: z.number().int().min(0).nullable().optional() }),
    output: z.object({ threadId: z.string(), projectId: z.string().nullable(), created: z.boolean() }),
  },
  /**
   * A Bot's + New: starts a conversation of that Bot from BB's new-thread
   * request (experimental_NewThreadComposer's submit, seeded with the Bot's
   * default model). Answers the new thread.
   */
  bot_conversation_start: {
    input: z.object({ botId, request: newConversationRequest }),
    output: z.object({ threadId: z.string(), projectId: z.string().nullable() }),
  },
  bot_ask: {
    input: z.object({
      text: z.string().trim().min(1).max(20_000),
      to: z.discriminatedUnion("kind", [z.object({ kind: z.literal("thread"), threadId }), z.object({ kind: z.literal("new"), botId: botId.nullable() })]),
    }),
    output: z.object({ threadId: z.string(), projectId: z.string().nullable() }),
  },
  /** Brings a finished conversation back to the sidebar (and unarchives it in BB). */
  bot_reopen: { input: z.object({ threadId }), output: z.object({ ok: z.boolean() }) },
  /** A finished conversation's summary for its card; null when it wasn't finished. */
  bot_finished: { input: z.object({ threadId }), output: z.object({ finished: finished.nullable() }) },
  /** The Bot's files: what its conversations and workers made, newest first (with the primary Bot, also what the user made themselves). */
  bot_library: { input: z.object({ botId: botId.optional() }), output: z.object({ botId: z.string().nullable(), items: z.array(libraryItem) }) },
};

export type BotSpace = z.infer<typeof space>;
export type ConversationRow = z.infer<typeof conversation>;
export type WorkerRow = z.infer<typeof worker>;
export type PageConversationRow = z.infer<typeof pageConversation>;
export type ConversationSearchHit = z.infer<typeof conversationHit>;
export type BotThreadInfo = z.infer<typeof threadInfo>;
export type LibraryItem = z.infer<typeof libraryItem>;
export type LibraryKind = z.infer<typeof libraryKind>;
export type FinishedConversation = z.infer<typeof finished>;

export const BOT_THREADS_CHANNEL = "bot-threads-changed";
export const BOT_CHANGE_KINDS = ["conversations", "workers", "needs-you", "presence"] as const;
export type BotChangeKind = (typeof BOT_CHANGE_KINDS)[number];
export const botThreadsChanged = z.object({ botId, changes: z.array(z.enum(BOT_CHANGE_KINDS)).min(1) });
export type BotThreadsChanged = z.infer<typeof botThreadsChanged>;
export const botThreadsEvents = { [BOT_THREADS_CHANNEL]: botThreadsChanged };
