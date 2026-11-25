import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { botControlRefusal, type Bots } from "../bot";
import { registerBotProfileTools } from "../bot-profile-tools";
import { callText, nextLine, pageSections, staleCursor } from "../paging";
import { presenceTools } from "../presence/agent-tools";
import type { PresenceService } from "../presence/service";
import type { Runners } from "../runners";
import { themeTools } from "../theme/agent-tools";
import type { ThemeService } from "../theme/service";

export interface BotToolsDeps {
  bb: BbPluginApi;
  bots: Bots;
  runners: Runners;
  themeService: ThemeService;
  presenceService: PresenceService;
  getThreadRecord: (threadId: string) => { kind?: string; botId: string } | null;
  themeBot: (ref: string | null | undefined, fallback: string | undefined) => { id: string; name: string } | string;
}

/** Registers the Bot's public agent tools (`bot_get`, profile, theme, presence) and returns `registerStatusTools` for `bot_state` / `bot_activity`. */
export function registerBotTools({
  bb,
  bots,
  runners,
  themeService,
  presenceService,
  getThreadRecord,
  themeBot,
}: BotToolsDeps) {
  // The Bot's tools (src/bot.ts), in every thread so the user can ask any agent about it.
  const describeBot = ({ bot, run }: Awaited<ReturnType<typeof bots.get>>) => bot
    ? `${bot.avatar} ${bot.name} is ${bot.state}. Thread: ${bot.threadId ? `/threads/${bot.threadId}` : "none"}. Check-ins: ${run?.enabled ? `${run.cadence}${run.cadence === "custom" ? ` (${run.cron})` : ` at ${run.time}`}` : "off"}.`
    : "The user has no Bot yet. They can make one in Studio → Bot.";

  // These act on the Bot the thread works for: its own thread (or handoff
  // chain), one of its runners, or a thread it started; elsewhere the primary.
  // A conversation of a Bot (src/bot-threads.ts) is that Bot's own thread, whichever conversation it is.
  const acting = async (threadId: string | undefined): Promise<Awaited<ReturnType<typeof bots.actingFor>>> => {
    const conversation = threadId ? getThreadRecord(threadId) : null;
    if (conversation?.kind === "conversation" && bots.stored(conversation.botId)) return { botId: conversation.botId, via: "own" };
    return bots.actingFor(threadId, (id) => runners.forThread(id)?.bot_id);
  };
  const selfBot = async (threadId: string | undefined) => (await acting(threadId))?.botId;

  for (const tool of themeTools({
    service: themeService,
    creator: async (threadId) => { const bot = themeBot(undefined, await selfBot(threadId)); return typeof bot === "string" ? { name: "Agent", botId: null } : { name: bot.name, botId: bot.id }; },
    resolveBot: async (ref, threadId) => themeBot(ref, await selfBot(threadId)),
  })) bb.agents.registerTool(tool as never);

  for (const tool of presenceTools({
    service: presenceService,
    creator: async (threadId) => { const bot = themeBot(undefined, await selfBot(threadId)); return typeof bot === "string" ? { name: "Agent", botId: null } : { name: bot.name, botId: bot.id }; },
    resolveBot: async (ref, threadId) => themeBot(ref, await selfBot(threadId)),
  })) bb.agents.registerTool(tool as never);

  // Pause and stop only from the Bot's own chat (botControlRefusal); no Bot resumes itself.
  bb.agents.registerTool({
    name: "bot_get",
    description: "Show the user's Bot (their always-on agent, formerly the Chief of Staff): name, avatar, state (active, paused, stopped), its thread and check-ins. In a Bot's own thread, that Bot.",
    parameters: z.object({}),
    execute: async (_input, ctx) => describeBot(await bots.get(await selfBot(ctx.threadId))),
  });

  registerBotProfileTools(bb, { bots, acting });

  /** Registers `bot_state` and `bot_activity` (called after `registerGroupTool` to preserve tool order). */
  const registerStatusTools = () => {
    bb.agents.registerTool({
      name: "bot_state",
      description: 'Change the user\'s Bot state when they explicitly ask: action "pause" (stops check-ins; Bot\'s own chat only), "stop" (pauses Bot, stops spawned threads, pauses automations; Bot\'s own chat only), or "resume" (resumes paused/stopped Bot; cannot be called by the Bot itself).',
      parameters: z.object({ action: z.enum(["pause", "resume", "stop"]) }),
      execute: async ({ action }, ctx) => {
        const self = await acting(ctx.threadId);
        if (action === "resume") return self ? "Only the user can resume their Bot: Studio → Bot → Resume." : describeBot(await bots.resume());
        const refused = botControlRefusal(self, action);
        if (refused) return refused;
        if (action === "pause") return describeBot(await bots.pause(self!.botId));
        const result = await bots.stop(self!.botId);
        return [describeBot(result), `Stopped ${result.stoppedThreadIds.length} thread(s); paused ${result.pausedAutomationIds.length} automation(s).`].join("\n");
      },
    });

    // bot_conversations replaced bot_threads_list (src/bot-threads-server.ts): side threads are conversations.
    bb.agents.registerTool({
      name: "bot_activity",
      description: "What the user's Bot is doing: what waits on the user in its chat, threads in progress (and which wait on an answer), scheduled check-ins and automations, and recently completed threads it started.",
      parameters: z.object({ after: z.string().min(1).max(512).optional().describe("The cursor the last part's Next names") }),
      execute: async ({ after }: { after?: string }, ctx) => {
        const activity = await bots.activity(await selfBot(ctx.threadId));
        // In parts (src/paging.ts), each section's heading again in a part that continues it.
        const threadRows = (section: string, threads: { id: string; title: string; status: string }[]) => threads.map((thread) => ({ id: thread.id, section: `${section}:`, line: `- [${thread.title}](/threads/${thread.id}) (${thread.status})` }));
        const rows = [
          ...(activity.attention ? [{ id: "attention", section: "", line: `Waiting on the user in your chat: ${/^\d+$/.test(activity.attention.reason) ? `${activity.attention.count} (questions, todos and unread replies)` : activity.attention.reason}` }] : []),
          ...threadRows("Waiting on an answer (yours to handle, or bring to the user)", activity.inProgress.filter((each) => each.waitingFor)),
          ...threadRows("In progress", activity.inProgress.filter((each) => !each.waitingFor)),
          ...activity.scheduled.map((each) => ({ id: `scheduled:${each.id}`, section: "Scheduled:", line: `- ${each.name}${each.enabled ? "" : " (off)"}${each.nextRunAt ? `, next ${new Date(each.nextRunAt).toISOString()}` : ""}` })),
          ...threadRows("Completed", activity.completed),
        ];
        if (!rows.length) return "Nothing to show yet.";
        const part = pageSections(rows, { after });
        if (!part) return staleCursor(`${after}`, callText("bot_activity", {}));
        const next = nextLine(part.page, (last) => callText("bot_activity", { after: last }), "lines");
        return [...(next ? [next] : []), ...part.lines].join("\n");
      },
    });
  };

  return { acting, selfBot, registerStatusTools };
}
