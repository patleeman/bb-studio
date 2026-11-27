import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { continuedLines } from "./continue-shared";

export { continuedLines } from "./continue-shared";

export const CONTINUE_TOOL = "conversation_continue_new";
export const HANDOFF_MAX = 4_000;

export const continueInput = z.object({
  title: z.string().trim().min(1).max(120).describe("New conversation title"),
  handoff: z.string().trim().min(1).max(HANDOFF_MAX).describe("Short markdown handoff (decisions, open questions, links)"),
  openingMessage: z.string().trim().max(500).optional().describe("First step for the new conversation"),
});
export type ContinueInput = z.input<typeof continueInput>;

export function handoffText(input: {
  sourceThreadId: string;
  sourceSeq: number | null;
  handoff: string;
  openingMessage?: string | undefined;
}): string {
  const from = `@thread:${input.sourceThreadId}${input.sourceSeq === null ? "" : `#msg=${input.sourceSeq}`}`;
  const parts = [`Continued from ${from}`, input.handoff.trim()];
  parts.push(`**First:** ${input.openingMessage?.trim() || "a one-line recap and the next step."}`);
  return parts.join("\n\n");
}

export function continuedFromLine(source: { isMain?: boolean; title?: string | null }): string {
  if (source.isMain) return "Continued from Main";
  const title = source.title?.replace(/\s+/g, " ").trim();
  return title ? `Continued from “${title}”` : "Continued from another conversation";
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
  conversation(threadId: string): { botId: string; kind: "conversation" | "worker"; isMain?: boolean; title?: string | null } | null;
  thread(threadId: string): Promise<{ projectId?: string | null; environmentId?: string | null; providerId?: string | null; model?: string | null } | null>;
  timeline(threadId: string): Promise<readonly TimelineRow[]>;
  defaultModel(botId: string): { providerId: string; model: string; reasoning?: string | null } | null;
  spawn(request: Record<string, unknown>): Promise<{ id: string; projectId?: string | null }>;
  recordConversation(threadId: string, botId: string): void;
  focus(botId: string): void;
  changed(threadId: string): void;
}

export interface ContinueResult {
  threadId: string;
  projectId: string | null;
  title: string;
  post: string;
}

export async function continueInNew(deps: ContinueDeps, sourceThreadId: string, raw: ContinueInput): Promise<ContinueResult> {
  const input = continueInput.parse(raw);
  const source = deps.conversation(sourceThreadId);
  if (!source || source.kind !== "conversation") throw new Error("Only a conversation with the user can continue in a new one.");
  const thread = await deps.thread(sourceThreadId);
  if (!thread?.projectId) throw new Error("This conversation has no project to start the new one in.");
  const sourceSeq = sourceSeqOf(await deps.timeline(sourceThreadId).catch(() => []));
  const preset = deps.defaultModel(source.botId);
  const model = preset ? {
    providerId: preset.providerId, model: preset.model, ...(preset.reasoning ? { reasoningLevel: preset.reasoning } : {}),
    executionInputSources: { providerId: "explicit", model: "explicit", ...(preset.reasoning ? { reasoningLevel: "explicit" } : {}) },
  } : thread.providerId ? {
    providerId: thread.providerId, ...(thread.model ? { model: thread.model } : {}),
    executionInputSources: { providerId: "explicit", ...(thread.model ? { model: "explicit" } : {}) },
  } : {};
  const text = handoffText({ sourceThreadId, sourceSeq, handoff: input.handoff, openingMessage: input.openingMessage });
  deps.focus(source.botId);
  const made = await deps.spawn({
    projectId: thread.projectId, title: input.title, visibility: "visible",
    environment: thread.environmentId ? { type: "reuse", environmentId: thread.environmentId } : { type: "project-default" },
    input: [{ type: "text", text: continuedFromLine(source), mentions: [] }, { type: "text", text, mentions: [], visibility: "agent-only" }],
    pluginMetadata: { botConversation: source.botId, continuedFrom: { threadId: sourceThreadId, messageSeq: sourceSeq } },
    ...model,
  });
  deps.recordConversation(made.id, source.botId);
  deps.changed(made.id);
  deps.changed(sourceThreadId);
  return { threadId: made.id, projectId: made.projectId ?? thread.projectId, title: input.title, post: continuedLines(made.id, input.title) };
}

export const CONTINUE_DESCRIPTION = "Continue a topic in a new conversation seeded with a short handoff (call only when the user agrees or asks). Post the returned `post` lines as given.";

export function continueResult(result: ContinueResult): string {
  return JSON.stringify({
    threadId: result.threadId, title: result.title,
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
