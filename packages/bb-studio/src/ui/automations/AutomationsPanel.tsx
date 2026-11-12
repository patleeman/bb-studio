// The Bot's Automations page (`studio/automations`, round 7, 7b): opened
// from the Automations row in the Bot sidebar's space header, it shows the
// sidebar's Bot: every automation that belongs to it, bb's own included, on
// the Bot-page template (AutomationsTable.tsx). Switching Bots in the sidebar
// switches the page. It isn't on BB's rail (src/rail-arrangement.ts).
// One title row: the page's own, in BB's title bar (src/ui/page-bar.tsx).
import { Icon, openAppPath } from "../../kit/app/index";
import { Button } from "../../kit/ui/button";
import { NEW_BOT_PATH } from "../bot/selection";
import { useLive } from "../live";
import { AutomationsTable } from "./AutomationsTable";
import { BotPageEmpty, BotPageLayout } from "../bot-page";
import { useCurrentBot } from "../conversations/state";

export const AUTOMATIONS_PANEL = "automations";

/** The Bot shown: the sidebar's, else the primary, else the first. */
export function shownBot<Bot extends { id: string; primary?: boolean }>(bots: readonly Bot[], picked: string | null): Bot | null {
  return bots.find((bot) => bot.id === picked) ?? bots.find((bot) => bot.primary) ?? bots[0] ?? null;
}

export function AutomationsPanel() {
  const bots = useLive("bot_list", {}, { pollMs: 60_000 });
  const list = bots.data?.bots ?? [];
  const bot = shownBot(list, useCurrentBot());
  if (bot) {
    return (
      <AutomationsTable key={bot.id} botId={bot.id} botName={bot.name} disabled={bot.state !== "active"} external={bot.kind === "external"} />
    );
  }
  return (
    <BotPageLayout testId="automations-panel" title="Automations">
      {bots.data ? (
        <div className="flex flex-col items-center gap-3" data-testid="automations-empty">
          <BotPageEmpty>No Bots</BotPageEmpty>
          <Button type="button" size="sm" className="h-8 gap-1.5 px-3 text-sm" onClick={() => openAppPath(NEW_BOT_PATH)}><Icon name="Plus" />New Bot</Button>
        </div>
      ) : null}
    </BotPageLayout>
  );
}
