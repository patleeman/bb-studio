// Which Bot the Bot page shows, from its route under the Studio panel:
// /plugins/studio/studio/bot is the primary Bot (when it doesn't open the last
// Bot thread, BotHome), /plugins/studio/studio/bot/<botId> any Bot's Info,
// /plugins/studio/studio/bot/new
// the create flow ("New bot"). Every bot_* call on the page, its sidebar and
// its tabs carries the selected Bot's id (none for the primary).
import { usePathname } from "@bb-studio/kit/app";
import { useMemo } from "react";

export const BOT_PATH = "/plugins/studio/studio/bot";
export const NEW_BOT = "new";
export const NEW_BOT_PATH = `${BOT_PATH}/${NEW_BOT}`;

/**
 * A Bot's Info page, by id (the primary's too). The bare Bot page opens the
 * window's last Bot thread instead (BotHome).
 */
export const botPath = (botId?: string | null) => botId ? `${BOT_PATH}/${encodeURIComponent(botId)}` : BOT_PATH;

export interface BotSelection {
  /** The selected Bot; undefined for the primary. */
  botId?: string;
  /** The create flow ("New bot"). */
  creating: boolean;
}

export function selectionFromPath(pathname: string): BotSelection {
  const match = /^\/plugins\/studio\/studio\/bot\/([^/?#]+)/.exec(pathname);
  if (!match) return { creating: false };
  const segment = decodeURIComponent(match[1]!);
  return segment === NEW_BOT ? { creating: true } : { botId: segment, creating: false };
}

export function useBotSelection(): BotSelection {
  const pathname = usePathname();
  return useMemo(() => selectionFromPath(pathname), [pathname]);
}

/** A bot_* RPC input for the selected Bot. */
export const forBot = <T extends object>(botId: string | undefined, input: T = {} as T): T & { botId?: string } => botId ? { ...input, botId } : input;

/**
 * On a Bot's thread the route names no Bot, so the Bots list expands the
 * thread's owner (bot_thread_owner) or, until that answers, the Bot last
 * selected in this window.
 */
const LAST_KEY = "studio.bot.lastSelected";
export function rememberBot(botId: string): void {
  try { sessionStorage.setItem(LAST_KEY, botId); } catch { /* private mode */ }
}
export function lastBot(): string | undefined {
  try { return sessionStorage.getItem(LAST_KEY) ?? undefined; } catch { return undefined; }
}
