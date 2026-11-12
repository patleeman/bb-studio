// The Bot's own profile tool. bot_profile_update lets a Bot edit its own
// name, description, emoji, shape and color from its own thread.
//
// Every edit is recorded (Bots.selfEdit, table bot_profile_changes) for the
// user to see and revert. What's the user's alone (pause, resume, stop,
// delete, model, provider, permission mode, check-ins on or off) isn't in
// the schema, which rejects unknown keys, and Bots.selfEdit refuses it too.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { BOT_SHAPES } from "./bot-shapes";
import type { Bots } from "./bot";

/** bot_profile_update's parameters: the self-editable fields only; any other key fails to parse. */
export const profileUpdateParams = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  role: z.string().trim().max(400).optional().describe("Your description: a sentence or two on your role, given to you at each session start; empty clears it"),
  avatar: z.string().trim().min(1).max(16).optional().describe("One emoji; shown when shape is null"),
  shape: z.enum(BOT_SHAPES).nullable().optional().describe("Your drawn avatar's shape; null shows your emoji"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Your drawn avatar's color, #rrggbb"),
}).strict();

type Acting = { botId: string; via: "own" | "runner" | "started" } | null;

export interface BotProfileToolDeps {
  bots: Bots;
  /** The Bot a thread acts for (Bots.actingFor with the runners' lookup). */
  acting(threadId: string | undefined): Promise<Acting>;
}

export function registerBotProfileTools(bb: Pick<BbPluginApi, "agents">, deps: BotProfileToolDeps): void {
  const { bots } = deps;
  bb.agents.registerTool({
    name: "bot_profile_update",
    description: "Change your own profile: your name, description (role), emoji, or drawn avatar's shape and color. The user sees each change in your Info as \"Changed by\" you and can revert it. Pausing, stopping, your model, provider and permissions are the user's alone.",
    parameters: profileUpdateParams,
    execute: async (input, ctx) => {
      const acting = await deps.acting(ctx.threadId);
      if (acting?.via !== "own") return "Only a Bot's own thread can change its profile. To change the user's Bot on their behalf, use bot_set when they ask.";
      const { view, changed } = await bots.selfEdit(acting.botId, input, { botId: acting.botId, threadId: ctx.threadId ?? null });
      const bot = view.bot!;
      return changed.length ? `Changed your ${changed.join(", ")}. You are now ${bot.avatar} ${bot.name}${bot.role ? `: ${bot.role}` : ""}. The user can revert it in your Info.` : "Nothing changed: those are already your values.";
    },
  });
}
