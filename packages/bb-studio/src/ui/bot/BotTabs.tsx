// A Bot's page and Bot info. The Bot page (/plugins/studio/studio/bot[/<botId>],
// BotPanel) is one scroll, most important first (BotPage.tsx); Controls
// (bot/<botId>/controls, BotControls.tsx) holds every setting; Todos
// (bot/<botId>/loops, src/loops/ui/TodosPage.tsx) is the full todo list, on
// the Bot-page template like Memory and the Library. The top
// of BB's Info tab on a Bot's thread (BotInfoSection) is a few of BB's own
// Info rows (BotInfoRows.tsx). Its chat and the threads it lists open as BB
// threads.
import { PageColumn, usePathname, openAppPath } from "../../kit/app/index";
import type { BotView } from "../../contract";
import { useLive } from "../live";
import { BotHome } from "./BotHome";
import { BOT_STYLES } from "./BotAvatar";
import { BotPage, isControlsPath } from "./BotPage";
import { BotInfoRows } from "./BotInfoRows";
import { BotControls } from "./BotControls";
import { TodosPage } from "../../loops/ui/TodosPage";
import { isLoopsPath, useLoopsEnabled } from "../../loops/ui/hooks";

/** The Bot page (nav panel `bot`): the selected Bot's Info, or the create flow. */
export function BotPanel() {
  return <BotHome Info={InfoPage} />;
}

// The page scrolls as a whole, at the page's width, like every Studio page.
function InfoPage({ view, refresh }: { view: BotView; refresh(): void }) {
  const pathname = usePathname();
  const loopsOn = useLoopsEnabled() && view.bot!.primary !== false;
  if (loopsOn && isLoopsPath(pathname)) return <TodosPage view={view} />;
  const body = isControlsPath(pathname) ? <BotControls view={view} refresh={refresh} /> : <BotPage view={view} refresh={refresh} />;
  return (
    <PageColumn className="max-w-6xl pt-0 pb-0 @max-3xl/page:pt-0">
      <style>{BOT_STYLES}</style>
      {body}
    </PageColumn>
  );
}

/**
 * The Bot's block at the top of BB's thread Info tab, on a thread a Bot owns
 * (its conversations and workers): BB's own Info rows. Nothing on any other
 * thread, whose Info tab stays BB's.
 */
export function BotInfoSection({ threadId }: { threadId: string }) {
  const owner = useLive("bot_thread_owner", { threadId }, { pollMs: 120_000 });
  const botId = owner.data?.botId ?? null;
  const view = useLive("bot_get", botId ? { botId } : {}, { enabled: !!botId, pollMs: 30_000 });
  if (!botId || !view.data?.bot) return null;
  return <BotInfoRows key={view.data.bot.id} threadId={threadId} view={view.data} refresh={view.refresh} openPath={openAppPath} />;
}
