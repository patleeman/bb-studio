// A Bot's page and Bot info. The Bot page (/plugins/studio/studio/bot[/<botId>],
// BotPanel) is one scroll, most important first (BotPage.tsx); Controls
// (bot/<botId>/controls, BotControls.tsx) holds every setting; Loops
// (bot/<botId>/loops) is the full loop list, each with a back link. "Bot info"
// beside a Bot's thread (BotInfoPanel) is the page's compact version
// (BotPane). Its chat and the threads it lists open as BB threads.
import { PageColumn, usePathname, openAppPath } from "../../kit/app/index";
import { Icon } from "../../kit/ui/index";
import type { ThreadTabProps } from "../../kit/app/thread-panel";
import type { BotView } from "../../contract";
import { useLive } from "../live";
import { BotHome } from "./BotHome";
import { BOT_STYLES } from "./BotAvatar";
import { BotPage, BotPane, isControlsPath } from "./BotPage";
import { BotControls } from "./BotControls";
import { LoopsTab } from "../../loops/ui/LoopsTab";
import { isLoopsPath, useLoopsEnabled } from "../../loops/ui/hooks";
import { botPath } from "./selection";

/** The Bot page (nav panel `bot`): the selected Bot's Info, or the create flow. */
export function BotPanel() {
  return <BotHome Info={InfoPage} />;
}

// The page scrolls as a whole, at the page's width, like every Studio page.
function InfoPage({ view, refresh }: { view: BotView; refresh(): void }) {
  const pathname = usePathname();
  const loopsOn = useLoopsEnabled() && view.bot!.primary !== false;
  const body = isControlsPath(pathname) ? <BotControls view={view} refresh={refresh} />
    : loopsOn && isLoopsPath(pathname) ? <LoopsPage view={view} />
      : <BotPage view={view} refresh={refresh} />;
  return (
    <PageColumn className="max-w-6xl pt-0 pb-0 @max-3xl/page:pt-0">
      <style>{BOT_STYLES}</style>
      {body}
    </PageColumn>
  );
}

/** The full loop list, with a back link to the Bot page. */
function LoopsPage({ view }: { view: BotView }) {
  const bot = view.bot!;
  return (
    <div className="flex flex-col" aria-label={`${bot.name} loops`}>
      <button type="button" className="flex items-center gap-1.5 self-start pt-6 text-sm text-muted-foreground hover:text-foreground" onClick={() => openAppPath(botPath(bot.id))}>
        <Icon name="ArrowLeft" className="size-3.5" aria-hidden />{bot.name}
      </button>
      <h1 className="pt-3 pb-5 text-xl font-semibold">Loops</h1>
      <div className="-mx-4"><LoopsTab /></div>
    </div>
  );
}

/** The "Bot info" thread tab: the Info of the Bot that owns the thread. */
export function BotInfoPanel({ threadId }: ThreadTabProps) {
  const owner = useLive("bot_thread_owner", { threadId }, { pollMs: 120_000 });
  const botId = owner.data?.botId ?? null;
  if (!botId) return <p className="p-4 text-sm text-muted-foreground">{owner.loading || !owner.data ? "Loading…" : "Not a Bot thread. Bot info shows on a Bot's chat and the threads it started."}</p>;
  return <BotInfo botId={botId} threadId={threadId} />;
}

/** One Bot's Info by id: the compact page. */
export function BotInfo({ botId, threadId }: { botId: string; threadId?: string }) {
  const view = useLive("bot_get", { botId }, { pollMs: 30_000 });
  if (!view.data?.bot) return <p className="p-4 text-sm text-muted-foreground">{view.loading ? "Loading…" : view.error ?? "No bot."}</p>;
  return <BotPane key={view.data.bot.id} view={view.data} refresh={view.refresh} threadId={threadId} />;
}
