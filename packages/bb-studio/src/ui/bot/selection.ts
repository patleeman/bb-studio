// Which Bot the Bot page shows, from its route: /plugins/studio/bot is the
// primary Bot, /plugins/studio/bot/<botId> another, /plugins/studio/bot/new
// the create flow ("New bot"). Every bot_* call on the page, its sidebar and
// its tabs carries the selected Bot's id (none for the primary).
import { usePathname } from "@bb-studio/kit/app";
import { useMemo } from "react";

export const BOT_PATH = "/plugins/studio/bot";
export const NEW_BOT = "new";
export const NEW_BOT_PATH = `${BOT_PATH}/${NEW_BOT}`;

/** A Bot's page; the primary's is the plain Bot page. */
export const botPath = (botId?: string | null, primary = false) => botId && !primary ? `${BOT_PATH}/${encodeURIComponent(botId)}` : BOT_PATH;

export interface BotSelection {
  /** The selected Bot; undefined for the primary. */
  botId?: string;
  /** The create flow ("New bot"). */
  creating: boolean;
}

export function selectionFromPath(pathname: string): BotSelection {
  const match = /^\/plugins\/studio\/bot\/([^/?#]+)/.exec(pathname);
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
