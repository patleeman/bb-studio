// Studio's facts about a thread, in BB's own places for them since SDK
// 0.6.104 dropped the custom header slot: the context row above the
// composer (a Bot chat's prompt cache; how many automations wake a regular
// thread) and the Info tab's rows (the Bot a thread belongs to, its cache).
import { experimental_DetailRow as DetailRow, type ExperimentalThreadInfoProps, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { useOpenThreadTab } from "../kit/app/thread-panel";
import { useLive } from "./live";
import { BotCacheDetails, BotCacheSummary, cacheLabel, costLine } from "./bot/BotCache";
import { BOT_INFO_ACTION } from "./bot/workspace";
import { ThreadAutomationsSummary, useThreadAutomationsVisible } from "./automations/ThreadAutomations";

/** Studio's context segments sort after BB's parent thread and before Changed files. */
const CONTEXT_GROUP = "2_studio";
const POLL_MS = 60_000;

function BotRows({ threadId }: ExperimentalThreadInfoProps) {
  const owner = useLive("bot_thread_owner", { threadId }, { pollMs: 120_000 });
  const botId = owner.data?.botId ?? null;
  const view = useLive("bot_get", botId ? { botId } : {}, { enabled: !!botId, pollMs: 120_000 });
  const cache = useLive("bot_cache_state", { threadId }, { enabled: !!botId, pollMs: POLL_MS });
  const openTab = useOpenThreadTab();
  const bot = view.data?.bot;
  if (!botId || !bot) return null;
  const state = cache.data?.botId ? cache.data : null;
  const cost = state ? costLine(state) : null;
  return (
    <>
      <DetailRow label="Bot" icon="Bot">
        <button type="button" data-testid="bot-info-row" className="truncate text-left hover:underline" title={`${bot.name}: Bot info`}
          onClick={() => openTab({ actionId: BOT_INFO_ACTION, title: "Bot info" })}>{bot.name}</button>
      </DetailRow>
      {state ? (
        <DetailRow label="Prompt cache" icon="Clock">
          <span data-testid="bot-cache-row" className="truncate" title={cost ?? undefined}>{cacheLabel(state)}</span>
        </DetailRow>
      ) : null}
    </>
  );
}

/** Registers the context row segments and the Info rows. */
export function registerThreadContext(app: PluginAppBuilder): void {
  app.slots.experimental_threadContextSegment({
    id: "bot-cache",
    title: "Prompt cache",
    group: CONTEXT_GROUP,
    order: 1,
    summary: BotCacheSummary,
    details: BotCacheDetails,
    useVisible: ({ threadId }) => !!useLive("bot_cache_state", { threadId }, { pollMs: POLL_MS }).data?.botId,
  });
  app.slots.experimental_threadContextSegment({
    id: "thread-automations",
    title: "Automations",
    group: CONTEXT_GROUP,
    order: 2,
    summary: ({ threadId, projectId }) => <ThreadAutomationsSummary threadId={threadId} projectId={projectId} />,
    useVisible: ({ threadId, projectId }) => useThreadAutomationsVisible(threadId, projectId),
  });
  app.slots.experimental_threadInfoRow({ id: "bot", group: "1_thread", order: 50, component: BotRows });
}
