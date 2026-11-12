// Studio's facts about a thread, in BB's own places for them since SDK
// 0.6.104 dropped the custom header slot: the context row above the
// composer (a Bot chat's prompt cache; how many automations wake a regular
// thread) and the Info tab: on a Bot's thread, the Bot's rows at the top
// (Bot, Status, Model, Needs you; BotInfoSection), then its prompt cache
// ("Cache", so the label fits BB's label column) among BB's rows.
import { experimental_DetailRow as DetailRow, type ExperimentalThreadInfoProps, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { useLive } from "./live";
import { BotCacheDetails, BotCacheSummary, cacheLabel, costLine, registerCacheCardRow } from "./bot/BotCache";
import { BotInfoSection } from "./bot/BotTabs";
import { BotCacheFooter, useCacheFooter } from "./bot/cache-footer";
import { withComposerFooter } from "../kit/app/host-sdk";
import { ThreadAutomationsSummary, useThreadAutomationsVisible } from "./automations/ThreadAutomations";

/** The Bot's section in the Info tab: before every BB row group. */
export const BOT_INFO_GROUP = "0_bot";

/** Studio's context segments sort after BB's parent thread and before Changed files. */
const CONTEXT_GROUP = "2_studio";
const POLL_MS = 60_000;

function BotRows({ threadId }: ExperimentalThreadInfoProps) {
  const owner = useLive("bot_thread_owner", { threadId }, { pollMs: 120_000 });
  const botId = owner.data?.botId ?? null;
  const view = useLive("bot_get", botId ? { botId } : {}, { enabled: !!botId, pollMs: 120_000 });
  const cache = useLive("bot_cache_state", { threadId }, { enabled: !!botId, pollMs: POLL_MS });
  const bot = view.data?.bot;
  if (!botId || !bot) return null;
  const state = cache.data?.botId ? cache.data : null;
  const cost = state ? costLine(state) : null;
  return (
    <>
      {state ? (
        <DetailRow label="Cache" icon="Clock">
          <span data-testid="bot-cache-row" className="truncate" title={cost ?? undefined}>{cacheLabel(state)}</span>
        </DetailRow>
      ) : null}
    </>
  );
}

/** The chip, unless the composer's footer already shows it. */
function CacheSummary(props: { threadId: string; isExpanded: boolean; onToggle(): void }) {
  return useCacheFooter(props.threadId).active ? null : <BotCacheSummary {...props} />;
}

/** The details, opened from the context row's chip or from the footer's. */
function CacheDetails({ threadId, isExpanded }: { threadId: string; isExpanded: boolean }) {
  const footer = useCacheFooter(threadId);
  return footer.active ? null : <BotCacheDetails threadId={threadId} isExpanded={isExpanded} />;
}

/** Registers the context row segments and the Info rows. */
export function registerThreadContext(app: PluginAppBuilder): void {
  // Where BB's context popover takes plugin rows (the fork, whose composer
  // also has the footer row), the chip is only ever in the composer's footer,
  // "cache 59m", and its details are a row in that popover (UX review 2,
  // item 10). Elsewhere the context row above the composer keeps it.
  const inFooter = registerCacheCardRow(app.slots);
  if (inFooter) {
    app.composer.customize(withComposerFooter({ id: "bot-cache-footer", scopes: ["thread"] as const }, [{ id: "cache", component: BotCacheFooter }]));
  } else app.slots.experimental_threadContextSegment({
    id: "bot-cache",
    title: "Prompt cache",
    group: CONTEXT_GROUP,
    order: 1,
    summary: CacheSummary,
    details: CacheDetails,
    useVisible: ({ threadId }) => {
      const footer = useCacheFooter(threadId);
      const bot = !!useLive("bot_cache_state", { threadId }, { pollMs: POLL_MS }).data?.botId;
      return bot && !footer.active;
    },
  });
  app.slots.experimental_threadContextSegment({
    id: "thread-automations",
    title: "Automations",
    group: CONTEXT_GROUP,
    order: 2,
    summary: ({ threadId, projectId }) => <ThreadAutomationsSummary threadId={threadId} projectId={projectId} />,
    useVisible: ({ threadId, projectId }) => useThreadAutomationsVisible(threadId, projectId),
  });
  // The Bot's section first: group "0_bot" sorts before BB's own rows ("1_thread"…).
  app.slots.experimental_threadInfoRow({ id: "bot-space", group: BOT_INFO_GROUP, component: ({ threadId }) => <BotInfoSection threadId={threadId} /> });
  app.slots.experimental_threadInfoRow({ id: "bot", group: "1_thread", order: 50, component: BotRows });
}
