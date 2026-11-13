import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { WORK_ID } from "./work/shared";
import type { WorkCard } from "./work/contract";
import { continuedLines } from "./continue-shared";

export { CONTINUED_DIRECTIVE, continuedFallback, continuedLines, conversationLink } from "./continue-shared";

export const CONTINUE_TOOL = "conversation_continue_new";
export const HANDOFF_MAX = 4_000;

export const continueInput = z.object({
  title: z.string().trim().min(1).max(120).describe("The new conversation's title: the topic, a few words"),
  handoff: z.string().trim().min(1).max(HANDOFF_MAX).describe("Short markdown the new conversation starts from: decisions, open questions, links and cards that matter. Not the transcript."),
  workCards: z.array(z.string().regex(WORK_ID)).max(12).optional().describe("Work cards (wc_…) of this conversation that belong to the topic; they move to the new conversation"),
  openingMessage: z.string().trim().max(500).optional().describe("What the new conversation does first; default: a one-line recap and the next step"),
});
export type ContinueInput = z.input<typeof continueInput>;

export function handoffText(input: {
  sourceThreadId: string;
  sourceSeq: number | null;
  handoff: string;
  moved: readonly Pick<WorkCard, "id" | "title">[];
  openingMessage?: string | undefined;
}): string {
  const from = `@thread:${input.sourceThreadId}${input.sourceSeq === null ? "" : `#msg=${input.sourceSeq}`}`;
  const parts = [`Continued from ${from}`, input.handoff.trim()];
  if (input.moved.length) {
    parts.push(`**Moved here:** ${input.moved.map((card) => card.title).join(", ")}. Post each card once, on its own line, in your first reply: ${input.moved.map((card) => `\`::work{id="${card.id}"}\``).join(" ")}`);
  }
  parts.push(`**First:** ${input.openingMessage?.trim() || "a one-line recap and the next step."}`);
  return parts.join("\n\n");
}

type TimelineRow = { kind?: string; role?: string; messageSeq?: number; initiator?: string };

export function sourceSeqOf(rows: readonly TimelineRow[]): number | null {
  for (const row of [...rows].reverse()) {
    if (row.kind !== undefined && row.kind !== "conversation") continue;
    if (row.role === "user" && (row.initiator === undefined || row.initiator === "user") && typeof row.messageSeq === "number") return row.messageSeq;
  }
  return null;
}

export interface ContinueDeps {
  conversation(threadId: string): { botId: string; kind: "conversation" | "worker" } | null;
  thread(threadId: string): Promise<{ projectId?: string | null; environmentId?: string | null } | null>;
  timeline(threadId: string): Promise<readonly TimelineRow[]>;
  defaultModel(botId: string): { providerId: string; model: string; reasoning?: string | null } | null;
  spawn(request: Record<string, unknown>): Promise<{ id: string; projectId?: string | null }>;
  recordConversation(threadId: string, botId: string): void;
  focus(botId: string): void;
  card(id: string): WorkCard | null;
  moveCard(id: string, threadId: string): WorkCard;
  changed(threadId: string): void;
}

export interface ContinueResult {
  threadId: string;
  projectId: string | null;
  title: string;
  moved: string[];
  skipped: string[];
  post: string;
}

export async function continueInNew(deps: ContinueDeps, sourceThreadId: string, raw: ContinueInput): Promise<ContinueResult> {
  const input = continueInput.parse(raw);
  const source = deps.conversation(sourceThreadId);
  if (!source || source.kind !== "conversation") throw new Error("Only a conversation with the user can continue in a new one.");
  const ids = [...new Set(input.workCards ?? [])];
  const cards = ids.map((id) => deps.card(id));
  const movable = cards.filter((card): card is WorkCard => !!card && card.threadId === sourceThreadId);
  const skipped = ids.filter((id) => !movable.some((card) => card.id === id));
  const thread = await deps.thread(sourceThreadId);
  if (!thread?.projectId) throw new Error("This conversation has no project to start the new one in.");
  const sourceSeq = sourceSeqOf(await deps.timeline(sourceThreadId).catch(() => []));
  const preset = deps.defaultModel(source.botId);
  const model = preset ? {
    providerId: preset.providerId, model: preset.model, ...(preset.reasoning ? { reasoningLevel: preset.reasoning } : {}),
    executionInputSources: { providerId: "explicit", model: "explicit", ...(preset.reasoning ? { reasoningLevel: "explicit" } : {}) },
  } : {};
  const text = handoffText({ sourceThreadId, sourceSeq, handoff: input.handoff, moved: movable, openingMessage: input.openingMessage });
  deps.focus(source.botId);
  const made = await deps.spawn({
    projectId: thread.projectId, title: input.title, visibility: "visible",
    environment: thread.environmentId ? { type: "reuse", environmentId: thread.environmentId } : { type: "project-default" },
    input: [{ type: "text", text, mentions: [] }],
    pluginMetadata: { botConversation: source.botId, continuedFrom: { threadId: sourceThreadId, messageSeq: sourceSeq } },
    ...model,
  });
  deps.recordConversation(made.id, source.botId);
  const moved = movable.map((card) => deps.moveCard(card.id, made.id).id);
  deps.changed(made.id);
  deps.changed(sourceThreadId);
  return { threadId: made.id, projectId: made.projectId ?? thread.projectId, title: input.title, moved, skipped, post: continuedLines(made.id, input.title) };
}

export const CONTINUE_DESCRIPTION = "Continue a topic in a NEW conversation of yours, seeded with a short handoff you write (decisions, open questions, links, cards), not the transcript. Propose it first (\"Pick up the HUD in its own conversation?\") and call it only when the user agrees or asks. workCards move the topic's work cards there, out of this conversation's In flight list. It returns a `post` text: put it in your reply here, as given, on lines of its own.";

export function continueResult(result: ContinueResult): string {
  return JSON.stringify({
    threadId: result.threadId, title: result.title, moved: result.moved,
    ...(result.skipped.length ? { notMoved: result.skipped, why: "Not cards of this conversation." } : {}),
    post: result.post,
  });
}

export function registerContinueNew(bb: BbPluginApi, deps: ContinueDeps): void {
  bb.agents.registerTool({
    name: CONTINUE_TOOL,
    description: CONTINUE_DESCRIPTION,
    parameters: continueInput,
    execute: async (input, ctx) => {
      if (!ctx.threadId) return "Call this from the conversation the topic is in.";
      try {
        return continueResult(await continueInNew(deps, ctx.threadId, input));
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  });
}
