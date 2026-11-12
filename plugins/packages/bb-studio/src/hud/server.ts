// The HUD on the server: who the primary Bot is and whether it is working
// (the HUD window shows the chat itself, with BB's own chat component), a
// send to its chat (the launcher's "Ask the Bot"), and the relay that lets a
// plugin window open something in the main window.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hudContract } from "./contract";
import { MAIN_WINDOW_CHANNEL } from "./shared";

export interface HudDeps {
  /** The primary Bot, or null before one is made. */
  bot(): { id: string; name: string; threadId: string | null } | null;
  /** Whether the thread is in a turn. */
  working(threadId: string): Promise<boolean>;
  send(threadId: string, text: string): Promise<void>;
  publish(channel: string, payload: unknown): void;
}

export function hudHandlers(deps: HudDeps) {
  return {
    "hud.get": async () => {
      const bot = deps.bot();
      if (!bot) return { bot: null, working: false };
      const view = { id: bot.id, name: bot.name, threadId: bot.threadId };
      if (!bot.threadId) return { bot: view, working: false };
      return { bot: view, working: await deps.working(bot.threadId).catch(() => false) };
    },
    "hud.send": async ({ text }: { text: string }) => {
      const bot = deps.bot();
      if (!bot) throw new Error("Make your Bot first.");
      if (!bot.threadId) throw new Error(`${bot.name} has no chat.`);
      await deps.send(bot.threadId, text);
      return { threadId: bot.threadId };
    },
    "window.openInMain": ({ path }: { path: string }) => {
      deps.publish(MAIN_WINDOW_CHANNEL, { path });
      return { ok: true as const };
    },
    "window.runInMain": (input: { kind: "command"; commandId: string } | { kind: "url"; url: string } | { kind: "link"; link: string; how: string }) => {
      deps.publish(MAIN_WINDOW_CHANNEL, input.kind === "command" ? { command: input.commandId } : input.kind === "url" ? { url: input.url } : { link: input.link, how: input.how });
      return { ok: true as const };
    },
  };
}

export function registerHud(bb: BbPluginApi, bot: HudDeps["bot"]): void {
  bb.rpc.register(hudContract, hudHandlers({
    bot,
    working: async (threadId) => ["active", "starting"].includes(String(((await bb.sdk.threads.get({ threadId })) as { status?: string }).status)),
    send: async (threadId, text) => { await bb.sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }] } as never); },
    publish: (channel, payload) => { void bb.realtime.publish(channel, payload as never); },
  }));
}
