import { experimental_NewThreadComposer as NewThreadComposer, useBbNavigate, useRpc, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { Icon, openCompanion, useCompanionNavigate } from "@bb-studio/kit/app";
import { errorMessage, quoteMessage, untitled, type ItemQuote } from "@bb-studio/kit/format";
import { useCallback, useEffect, useState } from "react";
import type { rpcContract, Viewed } from "../contract";
import { itemKey } from "../context";
import { CHAT_ICON, CONVERSATION_STARTED, draftRoute, quoteDrafts } from "./conversation-drafts";

export function ConversationComposer({ item, quote, draftKey, focusRequest, onSubmit, onClose }: {
  item: Viewed | null;
  quote?: ItemQuote;
  draftKey: string;
  focusRequest?: number;
  onSubmit: NonNullable<React.ComponentProps<typeof NewThreadComposer>["onSubmit"]>;
  onClose?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const kind = item?.kindLabel.toLowerCase() ?? "conversation";
  return (
    <section aria-label={item ? `Work with this ${kind}` : "New conversation"} className="studio-chat flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <Icon name={item?.kindIcon ?? CHAT_ICON} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item ? `Chat about "${untitled(item.title)}"` : "New conversation"}</span>
        {onClose ? <button type="button" aria-label="Close composer" onClick={onClose} className="rounded p-1 hover:bg-state-hover"><Icon name="X" className="size-4" /></button> : null}
      </header>
      <p className="shrink-0 px-3 pt-2 text-xs text-muted-foreground">@mention a bot to hand it off.</p>
      {quote?.image ? <div className="flex shrink-0 items-center gap-3 px-3 pt-2">
        <img src={quote.image} alt="Selected image area" className="max-h-24 max-w-40 rounded border border-border object-contain" />
      </div> : null}
      {error ? <p role="alert" className="shrink-0 px-3 pt-2 text-xs text-destructive">{error}</p> : null}
      <NewThreadComposer
        className="studio-chat-composer min-h-0 flex-1 overflow-auto"
        layout="document"
        placeholder={item ? `Work with this ${kind}…` : "What would you like to work on?"}
        draftKey={draftKey}
        {...(quote ? { initialPrompt: quoteMessage(quote) } : {})}
        {...(focusRequest !== undefined ? { focusRequest } : {})}
        {...(item?.projectId ? { defaultProjectId: item.projectId } : {})}
        onSubmit={async request => {
          setError(null);
          try {
            await onSubmit(quote?.image ? { ...request, input: [...request.input, { type: "image", url: quote.image }] } : request);
          } catch (cause) {
            setError(errorMessage(cause));
            throw cause;
          }
        }}
      />
    </section>
  );
}

export function ConversationPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const navigateCompanion = useCompanionNavigate();
  const [loaded, setLoaded] = useState<{ item: Viewed | null; quote?: ItemQuote; draftKey: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(async () => {
    const route = draftRoute(subPath);
    if (!route) throw new Error("This conversation draft link is invalid.");
    if (route.kind === "plain") return { item: null, draftKey: "studio-chat:plain" };
    const saved = route.kind === "quote" ? await quoteDrafts.get(route.id) : null;
    if (route.kind === "quote" && !saved) throw new Error("That quote draft is no longer available.");
    const ref = route.kind === "item" ? route.item : saved!.item;
    const { item } = await rpc.call("subject", { pluginId: ref.pluginId, id: ref.id });
    if (!item) throw new Error("That Studio item is archived or gone.");
    return {
      item,
      draftKey: saved ? `studio-chat:${itemKey(item)}:quote:${saved.id}` : `studio-chat:${itemKey(item)}`,
      ...(saved ? { quote: saved.quote } : {}),
    };
  }, [rpc, subPath]);
  useEffect(() => {
    let live = true;
    setLoaded(null); setError(null);
    load().then(result => { if (live) setLoaded(result); }, cause => { if (live) setError(errorMessage(cause)); });
    return () => { live = false; };
  }, [load, attempt]);
  if (error) return <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded border border-border px-3 py-1.5 hover:bg-state-hover">Retry</button></div>;
  if (!loaded) return <p className="p-4 text-sm text-muted-foreground">Loading conversation…</p>;
  return <ConversationComposer key={loaded.draftKey} {...loaded} focusRequest={1} onSubmit={async request => {
    const { threadId } = await rpc.call("start", { item: loaded.item ? { pluginId: loaded.item.pluginId, id: loaded.item.id } : null, request });
    if (loaded.item) window.dispatchEvent(new CustomEvent(CONVERSATION_STARTED, { detail: { pluginId: loaded.item.pluginId, id: loaded.item.id } }));
    const target = { kind: "thread" as const, threadId };
    if (!navigateCompanion(target) && !openCompanion(target, { tag: "studio-chat:item" })) navigate.toThread(threadId);
  }} />;
}
