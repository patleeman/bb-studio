// The Bot's Automations page (`studio/automations`) and its tab: what runs
// when now lives on the Bot's Strands page, under Scheduled
// (src/strands/ui/StrandsPage.tsx), so this shows that page on its Scheduled tab.
// Switching Bots in the sidebar switches the page.
import { Icon, openAppPath } from "../../kit/app/index";
import { Button } from "../../kit/ui/button";
import { NEW_BOT_PATH } from "../bot/selection";
import { useLive } from "../live";
import { StrandsPage, type StrandsTab } from "../../strands/ui/StrandsPage";
import { BotPageEmpty, BotPageLayout } from "../bot-page";
import { useCurrentBot } from "../conversations/state";

export const AUTOMATIONS_PANEL = "automations";

/** The Bot shown: the sidebar's, else the primary, else the first. */
export function shownBot<Bot extends { id: string; primary?: boolean }>(bots: readonly Bot[], picked: string | null): Bot | null {
  return bots.find((bot) => bot.id === picked) ?? bots.find((bot) => bot.primary) ?? bots[0] ?? null;
}

export function AutomationsPanel() {
  return <BotStrandsPanel tab="scheduled" />;
}

/** The Strands page for a Bot (`botId`, else the sidebar's): on its Scheduled tab, the Automations page; on Now, the Strands tab beside a chat. */
export function BotStrandsPanel({ botId = null, tab }: { botId?: string | null; tab: StrandsTab }) {
  const bots = useLive("bot_list", {}, { pollMs: 60_000 });
  const list = bots.data?.bots ?? [];
  const sidebar = useCurrentBot();
  const bot = shownBot(list, botId ?? sidebar);
  if (bot) {
    return (
      <StrandsPage key={bot.id} view={{ bot, run: null }} tab={tab} />
    );
  }
  return (
    <BotPageLayout testId="automations-panel" title="Scheduled">
      {bots.data ? (
        <div className="flex flex-col items-center gap-3" data-testid="automations-empty">
          <BotPageEmpty>No Bots</BotPageEmpty>
          <Button type="button" size="sm" className="h-8 gap-1.5 px-3 text-sm" onClick={() => openAppPath(NEW_BOT_PATH)}><Icon name="Plus" />New Bot</Button>
        </div>
      ) : null}
    </BotPageLayout>
  );
}
