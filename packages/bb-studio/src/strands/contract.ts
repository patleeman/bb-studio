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
  /** "area": an area's item that needs the user; "flag": the conversation flagged with bot_needs_you. Both are answered in the chat. */
  kind: z.enum(["question", "approval", "gateway", "area", "flag"]),
  /** The thread it waits in: the conversation, or one of its workers. */
  threadId: z.string(),
  label: z.string(),
  /** An approval's full details before its buttons: the whole command, working folder, actions and session grant. */
  details: z.array(z.string()),
  /** The conversation's turn it waits in: under a filter for another strand, that turn stays in view. Null for a worker's ask. */
  turnId: z.string().nullable().default(null),
  /** An approval's choices (BB's own), for its buttons. */
  decisions: z.array(z.enum(["allow_once", "allow_for_session", "deny"])),
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
});
export type StrandItemView = z.infer<typeof strandItemView>;

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
      tags: z.array(z.object({ turnId: z.string(), seq: z.number(), strandId: z.string().nullable() })),
      strands: z.array(z.object({ id: z.string(), title: z.string() })),
    }),
  },
  "strands.overview": {
    experimental_description: "Every conversation of a Bot with open strands, needs you first: the Strands page.",
    input: z.object({ botId: z.string().min(1).max(200) }).strict(),
    output: z.object({ conversations: z.array(overviewConversation), needs: z.number(), running: z.number() }),
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
  "strands.opened": {
    experimental_description: "The user opened a strand: what finished in it since counts as seen.",
    input: z.object({ strandId: z.string().min(1).max(200) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
});

/** What the phone reads: a conversation's strands and its tags, "opened", and the overview (its Strands screen). The rest stays desktop-only. */
export const strandsPublicContract = defineRpcContract({
  "strands.list": rpcContract["strands.list"],
  "strands.overview": rpcContract["strands.overview"],
  "strands.tags": rpcContract["strands.tags"],
  "strands.opened": rpcContract["strands.opened"],
});
