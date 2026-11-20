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
  kind: z.enum(["question", "approval", "gateway"]),
  /** The thread it waits in: the conversation, or one of its workers. */
  threadId: z.string(),
  label: z.string(),
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
  workers: z.array(z.object({ threadId: z.string(), title: z.string(), status: workerStatus })),
  lastAt: z.number(),
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
  /** Strands are on for this conversation (phase 1: a Bot's Main). */
  enabled: z.boolean(),
  backfill: z.object({ done: z.boolean(), at: z.number().nullable(), messages: z.number(), sorted: z.number() }),
  jevCallsToday: z.number(),
  jevDailyCap: z.number(),
  /** A turn is running and isn't sorted yet. */
  sortingTurn: z.boolean(),
  strands: z.array(strandView),
  /** Quiet for 3 days and not pinned: folded away. */
  earlier: z.array(strandView),
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
  "strands.opened": {
    experimental_description: "The user opened a strand: what finished in it since counts as seen.",
    input: z.object({ strandId: z.string().min(1).max(200) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
});
