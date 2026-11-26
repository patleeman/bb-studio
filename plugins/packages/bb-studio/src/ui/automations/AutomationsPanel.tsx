// The Bot's Scheduled page (`studio/automations`) and its tab: what runs
// when (ScheduledPage.tsx). Switching Bots in the sidebar switches the page.
import { Icon, openAppPath } from "../../kit/app/index";
import { Button } from "../../kit/ui/button";
import { NEW_BOT_PATH } from "../bot/selection";
import { useLive } from "../live";
import { ScheduledPage } from "./ScheduledPage";
import { BotPageEmpty, BotPageLayout } from "../bot-page";
import { useCurrentBot } from "../conversations/state";

export const AUTOMATIONS_PANEL = "automations";

/** The Bot shown: the sidebar's, else the primary, else the first. */
export function shownBot<Bot extends { id: string; primary?: boolean }>(bots: readonly Bot[], picked: string | null): Bot | null {
  return bots.find((bot) => bot.id === picked) ?? bots.find((bot) => bot.primary) ?? bots[0] ?? null;
}

/** The Scheduled page for the sidebar's Bot. */
export function AutomationsPanel() {
  const bots = useLive("bot_list", {}, { pollMs: 60_000 });
  const list = bots.data?.bots ?? [];
  const sidebar = useCurrentBot();
  const bot = shownBot(list, sidebar);
  if (bot) return <ScheduledPage key={bot.id} view={{ bot, run: null }} />;
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
