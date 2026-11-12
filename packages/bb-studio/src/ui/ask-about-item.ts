// "Ask the Bot about this" in a file's header (UX review 3, item 6). One
// Bot, many conversations: a file isn't a new thread's topic, it is
// something to ask the Bot about where Patrick already is. The file goes to
// the current conversation, mentioned in its composer (BB's mention pill),
// and Patrick writes the question:
// - in a conversation's workbench: that conversation;
// - anywhere else (the Library, a file in the main view): the Bot's
//   last-open conversation, else its Main, which opens.
// Wired into the item header by app.tsx (setAskAboutItem).
import type { AskAboutItem } from "../kit/app/item-header";
import { requestComposerMention, type ComposerMention } from "../kit/app/thread-panel";
import { landingThread } from "./conversations/model";
import { currentBot, lastConversation, openThreadVia } from "./conversations/state";
import { itemKindOf } from "./item-target";
import { openPathFromRoute } from "./studio-open";

type Spaces = () => Promise<{ bots: readonly { id: string; mainThreadId: string | null }[]; currentBotId: string | null } | null>;

export interface AskDeps {
  spaces: Spaces;
  /** Opens a thread in the main view. */
  open(threadId: string): void;
  mention(threadId: string, mention: ComposerMention): Promise<boolean>;
}

/** The conversation the file goes to: the one it is beside, else the shown Bot's last-open one, else its Main. */
export async function askTarget(container: AskAboutItem["container"], spaces: Spaces): Promise<{ threadId: string; opens: boolean } | null> {
  if (container?.kind === "thread" && container.threadId) return { threadId: container.threadId, opens: false };
  const known = await spaces().catch(() => null);
  const botId = currentBot() ?? known?.currentBotId ?? known?.bots[0]?.id ?? null;
  if (!botId) return null;
  const threadId = landingThread(known?.bots.find((bot) => bot.id === botId) ?? null, lastConversation(botId), null);
  return threadId ? { threadId, opens: true } : null;
}

/** The pill for a Studio item: its kind is the provider. Null for an item BB can't mention. */
export function itemMention(ask: Pick<AskAboutItem, "item" | "itemRef">): ComposerMention | null {
  const provider = itemKindOf(ask.itemRef.id);
  return provider ? { provider, id: ask.itemRef.id, label: ask.item.title.trim() || "Untitled" } : null;
}

export async function askBotAboutItem(ask: AskAboutItem, deps: AskDeps): Promise<boolean> {
  const target = await askTarget(ask.container, deps.spaces);
  if (!target) return false;
  const mention = itemMention(ask);
  if (target.opens) deps.open(target.threadId);
  return mention ? deps.mention(target.threadId, mention) : false;
}

/** The app's handler, with the RPC's spaces. */
export function askAboutItemHandler(spaces: Spaces): (ask: AskAboutItem) => void {
  const open = openThreadVia((threadId) => openPathFromRoute(`/threads/${encodeURIComponent(threadId)}`));
  return (ask) => { void askBotAboutItem(ask, { spaces, open, mention: requestComposerMention }); };
}
