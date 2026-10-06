// The Chat panel: a new conversation about an item, or the thread picker,
// laid out like BB's own new-thread screen. Studio opens it in a split
// beside the item; sending or picking turns the pane into that thread.
import { experimental_NewThreadComposer as NewThreadComposer, useBbNavigate, useRpc, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { Icon, OUTLINE_BUTTON, StudioBar } from "@bb-studio/kit/app";
import { errorMessage, quoteMessage, untitled, type ItemQuote } from "@bb-studio/kit/format";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { rpcContract, Viewed } from "../contract";
import { itemKey } from "../context";
import { CHAT_ICON, CONVERSATION_STARTED, draftRoute, quoteDrafts } from "./conversation-drafts";
import { ThreadPicker } from "./ThreadPicker";

interface Loaded {
  item: Viewed | null;
  quote?: ItemQuote;
  quoteId?: string;
  draftKey: string;
  choose?: { homeThreadId: string | null };
}

/** The pane's title bar and BB's new-thread column: centered, below a gap. */
function Pane({ title, children }: { title: string; children: ReactNode }) {
  return <div className="studio-chat flex h-full min-h-0 flex-col bg-background text-foreground">
    <StudioBar><span className="truncate px-1.5 text-sm text-muted-foreground">{title}</span></StudioBar>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pt-14 pb-12">{children}</div>
    </div>
  </div>;
}

/** What the conversation is about, where BB's composer would show a pill. */
function ItemChip({ item }: { item: Viewed }) {
  return <span className="flex w-fit max-w-full items-center gap-1.5 rounded-md bg-state-hover px-2 py-1 text-xs text-muted-foreground" title={untitled(item.title)}>
    <Icon name={item.kindIcon ?? CHAT_ICON} className="size-3.5 shrink-0" />
    <span className="truncate">{untitled(item.title)}</span>
  </span>;
}

export function ConversationPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(async (): Promise<Loaded> => {
    const route = draftRoute(subPath);
    if (!route) throw new Error("This conversation draft link is invalid.");
    if (route.kind === "plain") return { item: null, draftKey: "studio-chat:plain" };
    const saved = route.kind === "quote" ? await quoteDrafts.get(route.id) : null;
    if (route.kind === "quote" && !saved) throw new Error("That quote draft is no longer available.");
    const ref = route.kind === "quote" ? saved!.item : route.item;
    const { item } = await rpc.call("chat.subject", { pluginId: ref.pluginId, id: ref.id });
    if (!item) throw new Error("That Studio item is archived or gone.");
    if (route.kind === "choose") {
      const { thread } = await rpc.call("chat.home", { pluginId: item.pluginId, id: item.id }).catch(() => ({ thread: null }));
      return { item, draftKey: `studio-chat:${itemKey(item)}:choose`, choose: { homeThreadId: thread?.threadId ?? null } };
    }
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
  const started = (item: Viewed | null, threadId: string) => {
    if (item) window.dispatchEvent(new CustomEvent(CONVERSATION_STARTED, { detail: { pluginId: item.pluginId, id: item.id } }));
    navigate.toThread(threadId);
  };

  if (!loaded) return <Pane title="New thread">
    {error
      ? <div role="alert" className="flex flex-col items-center gap-3 text-center text-sm"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className={OUTLINE_BUTTON}>Retry</button></div>
      : <p className="text-sm text-muted-foreground">Loading…</p>}
  </Pane>;

  const { item, quote, quoteId, draftKey, choose } = loaded;
  if (choose && item) return <Pane title="Choose conversation">
    <ItemChip item={item} />
    <p className="text-xs text-muted-foreground">Quotes and chat about "{untitled(item.title)}" will go to the conversation you pick.</p>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    <section aria-label={`Choose this ${item.kindLabel.toLowerCase()}'s conversation`} className="studio-chat-picker flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
      <ThreadPicker homeThreadId={choose.homeThreadId} onPick={threadId => {
        setError(null);
        rpc.call("chat.link", { pluginId: item.pluginId, id: item.id, threadId }).then(() => started(item, threadId), cause => setError(errorMessage(cause)));
      }} />
    </section>
  </Pane>;

  const kind = item?.kindLabel.toLowerCase() ?? "conversation";
  return <Pane title="New thread">
    <section data-studio-conversation="" aria-label={item ? `Work with this ${kind}` : "New conversation"} className="flex flex-col gap-2">
      {item ? <ItemChip item={item} /> : null}
      {quote?.image ? <img src={quote.image} alt="Selected image area" className="max-h-24 max-w-40 rounded border border-border object-contain" /> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <NewThreadComposer
        key={draftKey}
        className="studio-conversation-composer studio-chat-composer"
        layout="document"
        placeholder={item ? `Work with this ${kind}…` : "What would you like to work on?"}
        draftKey={draftKey}
        focusRequest={1}
        {...(quote ? { initialPrompt: quoteMessage(quote) } : {})}
        {...(item?.projectId ? { defaultProjectId: item.projectId } : {})}
        onSubmit={async request => {
          setError(null);
          try {
            const sent = quote?.image ? { ...request, input: [...request.input, { type: "image" as const, url: quote.image }] } : request;
            const { threadId } = await rpc.call("chat.start", { item: item ? { pluginId: item.pluginId, id: item.id } : null, request: sent });
            if (quoteId) void quoteDrafts.remove(quoteId).catch(() => {});
            started(item, threadId);
          } catch (cause) {
            setError(errorMessage(cause));
            throw cause;
          }
        }}
      />
    </section>
  </Pane>;
}
