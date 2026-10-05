import { useBbNavigate, useRpc, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { NewConversationComposer, OUTLINE_BUTTON, panelHref, type ConversationSubmit } from "@bb-studio/kit/app";
import { errorMessage, untitled, type ItemQuote } from "@bb-studio/kit/format";
import { useCallback, useEffect, useState } from "react";
import type { rpcContract, Viewed } from "../contract";
import { itemKey } from "../context";
import { CHAT_ICON, CONVERSATION_STARTED, draftRoute, quoteDrafts } from "./conversation-drafts";

export function ConversationComposer({ item, quote, draftKey, focusRequest, onSubmit, onClose, href }: {
  item: Viewed | null;
  quote?: ItemQuote;
  draftKey: string;
  focusRequest?: number;
  onSubmit: ConversationSubmit;
  onClose?: () => void;
  href?: string;
}) {
  const kind = item?.kindLabel.toLowerCase() ?? "conversation";
  return <NewConversationComposer
    title={item ? `Chat about "${untitled(item.title)}"` : "New conversation"}
    ariaLabel={item ? `Work with this ${kind}` : "New conversation"}
    icon={item?.kindIcon ?? CHAT_ICON}
    placeholder={item ? `Work with this ${kind}…` : "What would you like to work on?"}
    className="studio"
    composerClassName="studio-chat-composer"
    draftKey={draftKey}
    {...(href ? { moveTarget: { href, title: item ? `Chat about "${untitled(item.title)}"` : "New conversation" } } : {})}
    {...(quote ? { quote } : {})}
    {...(focusRequest !== undefined ? { focusRequest } : {})}
    {...(item?.projectId ? { defaultProjectId: item.projectId } : {})}
    {...(onClose ? { onClose } : {})}
    onSubmit={onSubmit}
  />;
}

export function ConversationPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [loaded, setLoaded] = useState<{ item: Viewed | null; quote?: ItemQuote; quoteId?: string; draftKey: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(async () => {
    const route = draftRoute(subPath);
    if (!route) throw new Error("This conversation draft link is invalid.");
    if (route.kind === "plain") return { item: null, draftKey: "studio-chat:plain" };
    const saved = route.kind === "quote" ? await quoteDrafts.get(route.id) : null;
    if (route.kind === "quote" && !saved) throw new Error("That quote draft is no longer available.");
    const ref = route.kind === "item" ? route.item : saved!.item;
    const { item } = await rpc.call("chat.subject", { pluginId: ref.pluginId, id: ref.id });
    if (!item) throw new Error("That Studio item is archived or gone.");
    return {
      item,
      draftKey: saved ? `studio-chat:${itemKey(item)}:quote:${saved.id}` : `studio-chat:${itemKey(item)}`,
      ...(saved ? { quote: saved.quote, quoteId: saved.id } : {}),
    };
  }, [rpc, subPath]);
  useEffect(() => {
    let live = true;
    setLoaded(null); setError(null);
    load().then(result => { if (live) setLoaded(result); }, cause => { if (live) setError(errorMessage(cause)); });
    return () => { live = false; };
  }, [load, attempt]);
  if (error) return <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className={OUTLINE_BUTTON}>Retry</button></div>;
  if (!loaded) return <p className="p-4 text-sm text-muted-foreground">Loading conversation…</p>;
  const { quoteId, ...composer } = loaded;
  return <ConversationComposer key={loaded.draftKey} {...composer} href={panelHref("studio", "chats", subPath)} focusRequest={1} onSubmit={async request => {
    const { threadId } = await rpc.call("chat.start", { item: loaded.item ? { pluginId: loaded.item.pluginId, id: loaded.item.id } : null, request });
    if (quoteId) void quoteDrafts.remove(quoteId).catch(() => {});
    if (loaded.item) window.dispatchEvent(new CustomEvent(CONVERSATION_STARTED, { detail: { pluginId: loaded.item.pluginId, id: loaded.item.id } }));
    navigate.toThread(threadId);
  }} />;
}
