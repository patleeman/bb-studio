// The Bot's own profile tools. bot_avatar_generate makes a new image avatar
// for the Bot the calling thread works for (its own thread or chain, or a
// thread it started; elsewhere the primary Bot), the way the other bot_*
// tools resolve it (Bots.actingFor).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { avatarPrompt, type ImageProvider } from "./bot-avatar";
import type { Bots } from "./bot";

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
      bots.addAvatarImage(bot.id, { data: image.data, mime: image.mime, source: "generated", prompt, provider: `${provider.id}/${image.model}` });
      return `${bot.name}'s avatar is now the new image (${provider.label} ${image.model}). The user can revert to the previous one in Bot info → Edit profile.`;
    },
  });
}
