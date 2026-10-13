// The Bot's own profile tools. bot_avatar_generate makes a new image avatar
// for the Bot the calling thread works for (its own thread or chain, or a
// thread it started; elsewhere the primary Bot), the way the other bot_*
// tools resolve it (Bots.actingFor). bot_profile_update lets a Bot edit its
// own name, description, emoji, shape and color from its own thread.
//
// Every edit is recorded (Bots.selfEdit, table bot_profile_changes) for the
// user to see and revert. What's the user's alone (pause, resume, stop,
// delete, model, provider, permission mode, check-ins on or off) isn't in
// the schema, which rejects unknown keys, and Bots.selfEdit refuses it too.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { avatarPrompt, type ImageProvider } from "./bot-avatar";
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
  /** The image provider to use now; throws ImageNotSetUpError when none is set up. */
  imageProvider(): ImageProvider;
}

export function registerBotProfileTools(bb: Pick<BbPluginApi, "agents">, deps: BotProfileToolDeps): void {
  const { bots } = deps;
  bb.agents.registerTool({
    name: "bot_avatar_generate",
    description: "Generate a new avatar image for yourself (in a Bot's thread; elsewhere the user's Bot) from a short description, and show it as the avatar. The user can revert to the previous one in Bot info. Costs a cent or a few per image, so use it when asked or when you really want a new look, not as a habit.",
    parameters: z.object({ prompt: z.string().trim().min(3).max(1000).describe("What the avatar shows, e.g. \"a friendly owl in a lighthouse keeper's cap, flat illustration\"") }),
    execute: async ({ prompt }, ctx) => {
      const acting = await deps.acting(ctx.threadId);
      if (acting?.via === "runner") return "A runner can't change its Bot's avatar; tell the user instead (runner_report).";
      const bot = bots.stored(acting?.botId);
      if (!bot) return "The user has no Bot yet. They can make one in Studio → Bot.";
      // Throws ImageNotSetUpError ("Image generation isn't set up: …") before any spend.
      const provider = deps.imageProvider();
      const image = await provider.generate(avatarPrompt(bot.name, prompt));
      bots.addAvatarImage(bot.id, { data: image.data, mime: image.mime, source: "generated", prompt, provider: `${provider.id}/${image.model}` }, { botId: acting?.botId ?? null, threadId: ctx.threadId ?? null });
      return `${bot.name}'s avatar is now the new image (${provider.label} ${image.model}). The user can revert to the previous one in Bot info → Edit profile.`;
    },
  });
  bb.agents.registerTool({
    name: "bot_profile_update",
    description: "Change your own profile: your name, description (role), emoji, or drawn avatar's shape and color. For an image avatar use bot_avatar_generate. The user sees each change in your Info as \"Changed by\" you and can revert it. Pausing, stopping, your model, provider and permissions are the user's alone.",
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
