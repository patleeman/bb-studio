// "Studio: Show the Bot" (⌃0, app.tsx): opens BB's sidebar if it is folded
// (where Studio's thread list shows the Bot), and the main view on the
// current Bot's last-open conversation, its Main when there is none.
import { openAppPath } from "../../kit/app/nav";
import { botPath } from "../bot/selection";
import { currentBot, expandHostSidebar, landingFor, markLanded, openThreadVia, type Land } from "./state";

type Spaces = () => Promise<{ bots: readonly { id: string; mainThreadId: string | null }[]; currentBotId: string | null } | null>;

/**
 * The Bot's last conversation in the main view (`spaces` knows each Bot's
 * Main), never BB's empty new-thread page. The thread opens with the
 * sidebar's BB navigation when it is mounted.
 */
export async function showBot(spaces: Spaces, land: Land, open: (threadId: string) => void = openThreadVia((threadId) => openAppPath(`/threads/${encodeURIComponent(threadId)}`))): Promise<void> {
  markLanded();
  expandHostSidebar();
  const known = await spaces().catch(() => null);
  const botId = currentBot() ?? known?.currentBotId ?? known?.bots[0]?.id ?? null;
  if (!botId) return;
  const target = await landingFor(botId, land);
  if (target) open(target);
  else openAppPath(botPath(botId));
}
