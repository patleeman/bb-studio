import { z } from "zod";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { WORK_ID, WORK_KINDS, WORK_STATES } from "./shared";

export * from "./shared";

const text = (max: number) => z.string().trim().max(max);

export const workCard = z.object({
  id: z.string().regex(WORK_ID),
  threadId: z.string().min(1),
  title: text(200).min(1),
  kind: z.enum(WORK_KINDS),
  state: z.enum(WORK_STATES),
  step: text(120).nullable(),
  line: text(300).nullable(),
  needs: text(300).nullable(),
  workerThreadId: z.string().min(1).nullable(),
  messageId: z.string().nullable(),
  messageSeq: z.number().int().min(0).nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  finishedAt: z.number().nullable(),
});
export type WorkCard = z.infer<typeof workCard>;

export const createInput = z.object({
  title: workCard.shape.title,
  kind: workCard.shape.kind.default("task"),
  state: workCard.shape.state.default("running"),
  step: text(120).optional(),
  line: text(300).optional(),
  needs: text(300).optional(),
  threadId: z.string().min(1).optional().describe("The conversation the card is posted in; defaults to the caller's thread"),
  workerThreadId: z.string().min(1).optional().describe("The thread doing the work, when it isn't the conversation"),
});
export type CreateInput = z.input<typeof createInput>;

export const changes = z.object({
  title: workCard.shape.title.optional(),
  kind: workCard.shape.kind.optional(),
  state: workCard.shape.state.optional(),
  step: text(120).nullable().optional(),
  line: text(300).nullable().optional(),
  needs: text(300).nullable().optional(),
  workerThreadId: z.string().min(1).nullable().optional(),
});
export type WorkChanges = z.infer<typeof changes>;

export const updateInput = changes.extend({ id: workCard.shape.id });

export const anchorInput = z.object({ id: workCard.shape.id, threadId: z.string().min(1), messageId: z.string().min(1).max(200) });

export const rpcContract = defineRpcContract({
  "work.get": { input: z.object({ id: workCard.shape.id }), output: workCard },
  "work.list": { input: z.object({ threadId: z.string().min(1) }), output: z.object({ cards: z.array(workCard) }) },
  "work.create": { input: createInput.extend({ threadId: z.string().min(1) }), output: z.object({ card: workCard, directive: z.string() }) },
  "work.update": { input: updateInput, output: workCard },
  "work.anchor": { input: anchorInput, output: workCard },
});
