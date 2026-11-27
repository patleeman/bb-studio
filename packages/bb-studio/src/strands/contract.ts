import { z } from "zod";
import type { defineRpcContract as sdkDefineRpcContract } from "@get-bb/plugin-sdk";
import { STATES } from "./states";

// Studio's frontend imports the contract, and a plugin frontend bundle can't
// resolve the root SDK. The SDK helper only returns its argument.
const defineRpcContract: typeof sdkDefineRpcContract = (contract) => contract;

const threadId = z.string().min(1).max(200);
const workerStatus = z.enum(["running", "needs-you", "failed", "done"]);

export const strandAsk = z.object({
  id: z.string(),
  /** "area": an area's item that needs the user; "flag": the conversation flagged with bot_needs_you. Both are answered in the chat. "reply": a reply that asks the user something; `label` is its ask line, `seq` its message. */
  kind: z.enum(["question", "approval", "gateway", "area", "flag", "reply"]),
  /** The thread it waits in: the conversation, or one of its workers. */
  threadId: z.string(),
  label: z.string(),
  /** An approval's full details before its buttons: the whole command, working folder, actions and session grant. */
  details: z.array(z.string()),
  /** The conversation's turn it waits in: under a filter for another strand, that turn stays in view. Null for a worker's ask. */
  turnId: z.string().nullable().default(null),
  /** An approval's choices (BB's own), for its buttons. */
  decisions: z.array(z.enum(["allow_once", "allow_for_session", "deny"])),
  /** A reply's message (its #msg= seq); null for every other kind. */
  seq: z.number().nullable().default(null),
});
export type StrandAsk = z.infer<typeof strandAsk>;

export const strandView = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  /** False while the title is still the first message's first line. */
  named: z.boolean(),
  state: z.enum(STATES),
  detail: z.string().nullable(),
  asks: z.array(strandAsk),
  /** Its workers; a finished or failed one with when it ended. */
  workers: z.array(z.object({ threadId: z.string(), title: z.string(), status: workerStatus, endedAt: z.number().nullable().default(null) })),
  lastAt: z.number(),
  /** Its first message's time and seq (a filter pages back to it); null when it has none yet. */
  firstAt: z.number().nullable(),
  firstSeq: z.number().nullable(),
  /** The strand's newest message (jump-to-latest opens #msg=<seq>); null when it has none (a task with no message yet). */
  latestSeq: z.number().nullable(),
  latestTurnId: z.string().nullable(),
  messages: z.number(),
  unsure: z.number(),
  pinned: z.boolean(),
  origin: z.enum(["jev", "model", "user", "task", "backfill"]),
  taskId: z.string().nullable(),
  /** The strand it branched from (a tree draws it as a fork off that strand); null for a root. */
  parentId: z.string().nullable().default(null),
  /** The whole-conversation strand: roundups and status checks on everything (the tree's trunk). */
  trunk: z.boolean().default(false),
});
export type StrandView = z.infer<typeof strandView>;

export const strandList = z.object({
  threadId: z.string(),
  /** Strands are on for this conversation (any Bot's conversation, Main included; not workers). */
  enabled: z.boolean(),
  backfill: z.object({ done: z.boolean(), at: z.number().nullable(), messages: z.number(), sorted: z.number() }),
  jevCallsToday: z.number(),
  jevDailyCap: z.number(),
  /** A turn is running and isn't sorted yet. */
  sortingTurn: z.boolean(),
  strands: z.array(strandView),
  /** Quiet for 3 days and not pinned: folded away. */
  earlier: z.array(strandView),
  /** Workers no strand holds: running or waiting on the user, or failed in the last 7 days. The box counts and lists them. */
  strayWorkers: z.array(z.object({ threadId: z.string(), title: z.string(), status: workerStatus, endedAt: z.number().nullable() })).default([]),
});
export type StrandList = z.infer<typeof strandList>;

export const strandItemView = z.object({
  seq: z.number(),
  kind: z.enum(["user", "reply", "worker", "ask", "report"]),
  ref: z.string(),
  turnId: z.string().nullable(),
  at: z.number(),
  line: z.string().nullable(),
  strandId: z.string().nullable(),
  confidence: z.number().nullable(),
  by: z.enum(["jev", "model", "user", "inherit", "fallback", "pending"]),
  unsure: z.boolean(),
  /** Other strands the message is also about. */
  also: z.array(z.string()).default([]),
});
export type StrandItemView = z.infer<typeof strandItemView>;

export const replyTagView = z.object({
  turnId: z.string(),
  seq: z.number(),
  tag: z.enum(["needs-you", "status"]),
  ask: z.string().nullable(),
  /** Answered, marked done, its strand marked done, or a week old. */
  resolved: z.boolean(),
  /** The reply's first sentence: what a folded run of status replies shows as its last. */
  line: z.string().nullable().default(null),
});
export type ReplyTagView = z.infer<typeof replyTagView>;

export const overviewConversation = z.object({
  threadId: z.string(),
  title: z.string(),
  isMain: z.boolean(),
  lastActiveAt: z.number(),
  /** Its strands that aren't in Earlier, needs you first. */
  strands: z.array(strandView),
});
export type OverviewConversation = z.infer<typeof overviewConversation>;

const strandId = z.string().min(1).max(200);
const ok = z.object({ ok: z.boolean() });

/** The agents' one strands tool: mark a strand waiting on someone, done, or renamed. */
export const STRAND_NOTE_TOOL = "strand_note";
export const STRAND_NOTE_DESCRIPTION = "Mark a strand (a line of work in this conversation) as waiting on someone or something, done, or renamed. Strands are sorted automatically; use this only when waiting or finished. Without strand, it notes the strand of your current turn (a worker's: the strand that started you).";
export const strandNoteInput = z.object({
  strand: z.string().trim().min(1).max(200).optional().describe("The strand's id or title; default: the current one"),
  waitingOn: z.string().trim().max(120).nullable().optional().describe("Who or what it waits on (\"Dana's review\", \"CI run 42\"); null clears it. Clears itself on the strand's next activity."),
  done: z.boolean().optional().describe("true: the work is finished; it folds away until its next activity"),
  title: z.string().trim().min(1).max(60).optional().describe("A new name: 1 to 4 words, a concrete noun phrase"),
}).strict();
export type StrandNoteInput = z.infer<typeof strandNoteInput>;

export const rpcContract = defineRpcContract({
  "strands.list": {
    experimental_description: "A conversation's strands (its lines of work) with live states.",
    input: z.object({ threadId }).strict(),
    output: strandList,
  },
  "strands.items": {
    experimental_description: "How a conversation's newest messages were sorted into strands.",
    input: z.object({ threadId, limit: z.number().int().min(1).max(2_000).default(200) }).strict(),
    output: z.object({ items: z.array(strandItemView) }),
  },
  "strands.tags": {
    experimental_description: "Each sorted turn's strand, for the tag on its messages.",
    input: z.object({ threadId }).strict(),
    output: z.object({
      /** Sorted turns, oldest first: each turn's first message (its seq) and its strand, null for none. */
      tags: z.array(z.object({ turnId: z.string(), seq: z.number(), strandId: z.string().nullable(), /** "user": the user wrote it; "report": another thread's or a runner's message. */ kind: z.enum(["user", "report"]).default("user"), /** When it was sent (ms), and its first line. */ at: z.number().nullable().default(null), line: z.string().nullable().default(null), /** Other strands the message is also about. */ also: z.array(z.string()).default([]) })),
      /** The conversation's strands; `done`: an agent said it is done; `trunk`: the whole-conversation strand. */
      strands: z.array(z.object({ id: z.string(), title: z.string(), done: z.boolean().default(false), /** The strand it branched from, when sorting knows one. */ parentId: z.string().nullable().default(null), trunk: z.boolean().default(false) })),
      /** Tagged replies, oldest first: each turn's reply needs-you or status, its ask line, and whether the user is past it. */
      replies: z.array(replyTagView).default([]),
      /** The conversation's first sorted message and its turn's reply. BB's timeline gives a thread's opening message no turn, so a strand filter never shows it; a jump to it under a filter lands on the reply instead. */
      opening: z.object({ seq: z.number(), replySeq: z.number().nullable() }).nullable().default(null),
    }),
  },
  "strands.move": {
    experimental_description: "Move a message's turn to another strand (the user's choice; never re-sorted).",
    input: z.object({ threadId, seq: z.number().int().min(0), strandId }).strict(),
    output: ok,
  },
  "strands.split": {
    experimental_description: "New strand from here: this message's turn and the later ones in its strand start a strand of their own.",
    input: z.object({ threadId, seq: z.number().int().min(0) }).strict(),
    output: z.object({ ok: z.boolean(), strandId: z.string().nullable() }),
  },
  "strands.rename": {
    experimental_description: "Rename a strand (the user's name; the model never renames it).",
    input: z.object({ strandId, title: z.string().trim().min(1).max(80) }).strict(),
    output: ok,
  },
  "strands.pin": {
    experimental_description: "Pin a strand (it never goes to Earlier) or unpin it.",
    input: z.object({ strandId, pinned: z.boolean() }).strict(),
    output: ok,
  },
  "strands.merge": {
    experimental_description: "Fold one strand into another of the same conversation.",
    input: z.object({ strandId, into: strandId }).strict(),
    output: ok,
  },
  "strands.unmerge": {
    experimental_description: "Undo a merge: the strand and its items come back.",
    input: z.object({ strandId }).strict(),
    output: ok,
  },
  "strands.unmove": {
    experimental_description: "Undo a message's last move: its turn goes back to the strand it was in.",
    input: z.object({ threadId, seq: z.number().int().min(0) }).strict(),
    output: ok,
  },
  "strands.resolveReply": {
    experimental_description: "The user marked a reply that needs them as done: it stops counting as needing them. Studio's app window only.",
    input: z.object({ threadId, seq: z.number().int().min(0) }).strict(),
    output: ok,
  },
  "strands.replyPush": {
    experimental_description: "Whether the conversation's newest reply is worth a phone push: needs-you pushes (with its ask line), status doesn't; unknown when it isn't tagged in time.",
    input: z.object({ threadId, waitMs: z.number().int().min(0).max(30_000).default(20_000), requestSeq: z.number().int().min(1).optional() }).strict(),
    output: z.object({ decision: z.enum(["push", "quiet", "unknown"]), ask: z.string().nullable() }),
  },
  "strands.opened": {
    experimental_description: "The user opened a strand: what finished in it since counts as seen.",
    input: z.object({ strandId: z.string().min(1).max(200) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
});

/** What the phone reads: a conversation's strands, its tags and "opened". The rest stays desktop-only. */
export const strandsPublicContract = defineRpcContract({
  "strands.list": rpcContract["strands.list"],
  "strands.tags": rpcContract["strands.tags"],
  "strands.opened": rpcContract["strands.opened"],
});
