// A Bot's workbench tab draws the Bot's avatar. BB asks for a tab's
// icon by name from its params while the tab strip renders, so the answer is
// one of the avatar icon slots (src/ui/bot/avatar-icons.tsx), by the Bot's
// place in the list. The places are remembered, so the avatar is right before
// the Bots have loaded.
import { avatarIcon } from "./avatar-icons";

const ORDER_KEY = "studio.mainTabs.botOrder";
let order: readonly string[] = readOrder();

function readOrder(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : [];
  } catch { return []; }
}

/** The Bots in list order, as the avatar slots hold them. */
export function setBotOrder(botIds: readonly string[]): void {
  if (botIds.join("\n") === order.join("\n")) return;
  order = [...botIds];
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch { /* private mode */ }
}

/** The avatar icon of the Bot a Bot tab's params name; null (the tab's own icon) for one not known. */
export function botTabIcon(params: unknown): string | null {
  const botId = typeof params === "object" && params !== null && !Array.isArray(params) ? (params as { botId?: unknown }).botId : null;
  const index = typeof botId === "string" ? order.indexOf(botId) : -1;
  return index >= 0 ? avatarIcon(index) : null;
}

/** Extra fields for the Bot tab's registration, on a BB that takes them: its icon is the Bot's avatar. */
export const BOT_TAB_ICON: object = { experimental_instanceIcon: botTabIcon };
