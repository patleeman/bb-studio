import {
  useBbNavigate,
  useComposer,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import {
  cn,
  FloatDockPortal,
  FloatThreadLeading,
  Icon,
  itemChatChanged,
  openCompanion,
  setItemChatHost,
  useFloatAvailable,
  usePathname,
  type HomeThread,
  type ItemChatHost,
  type ItemChatRef,
} from "@bb-studio/kit/app";
import { errorMessage, untitled, type ItemQuote } from "@bb-studio/kit/format";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { rpcContract, Viewed } from "../contract";
import { ref as itemRefSchema } from "../schemas";
import { MENTION_PROVIDER_ID } from "../ids";
import { itemKey } from "../context";
import { ThreadPicker } from "./ThreadPicker";
import { useChatDialog } from "./use-chat-dialog";
import { ConversationComposer } from "./ConversationComposer";
import { CHAT_ICON, CONVERSATION_STARTED, itemDraftPath, quoteDraftPath, quoteDrafts } from "./conversation-drafts";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

const CARD = "pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl";
/** Float tabs opened for "the item's chat" replace each other while you're not looking at them. */
const ITEM_CHAT_TAG = "studio-chat:item";

/** The Studio item on screen, or null; each path is asked once. */
function useViewing(rpc: Rpc, path: string): Viewed | null {
  const [viewed, setViewed] = useState<{ path: string; item: Viewed | null } | null>(null);
  useEffect(() => {
    if (!path.startsWith("/plugins/")) return setViewed({ path, item: null });
    let live = true;
    rpc.call("viewing", { path }).then(
      ({ item }) => live && setViewed({ path, item }),
      () => live && setViewed({ path, item: null }),
    );
    return () => {
      live = false;
    };
  }, [rpc, path]);
  return viewed?.path === path ? viewed.item : null;
}

type HomeCache = Map<string, HomeThread | null>;

/**
 * Studio Chat as the kit's item-chat host: home threads by item, loaded on
 * demand, plus what the header chip and quotes ask for. Brings the home
 * thread of the item on screen back as a background tab.
 */
function useHomeThreads(
  rpc: Rpc,
  viewed: Viewed | null,
  actions: { show(threadId: string, tag?: string): void; choose(ref: ItemChatRef): void; compose(ref: ItemChatRef, quote?: ItemQuote): void },
): { cache: HomeCache; put(key: string, thread: HomeThread | null): void; load(ref: ItemChatRef): void } {
  const floatAvailable = useFloatAvailable();
  const [cache, setCache] = useState<HomeCache>(() => new Map());
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const loading = useRef(new Set<string>());
  const reloadAfterLoad = useRef(new Set<string>());
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const put = useCallback((key: string, thread: HomeThread | null) => {
    setCache((current) => new Map(current).set(key, thread));
  }, []);
  const load = useCallback(
    (ref: ItemChatRef): void => {
      const key = itemKey(ref);
      if (loading.current.has(key)) return;
      loading.current.add(key);
      rpc.call("home", { pluginId: ref.pluginId, id: ref.id }).then(
        ({ thread }) => { if (!reloadAfterLoad.current.has(key)) put(key, thread); },
        () => { if (!reloadAfterLoad.current.has(key)) put(key, null); },
      ).finally(() => {
        loading.current.delete(key);
        if (reloadAfterLoad.current.delete(key)) load(ref);
      });
    },
    [rpc, put],
  );

  useEffect(() => {
    const started = (event: Event) => {
      const item = itemRefSchema.safeParse((event as CustomEvent).detail);
      if (item.success) {
        const key = itemKey(item.data);
        if (loading.current.has(key)) reloadAfterLoad.current.add(key);
        else load(item.data);
      }
    };
    window.addEventListener(CONVERSATION_STARTED, started);
    return () => window.removeEventListener(CONVERSATION_STARTED, started);
  }, [load]);

  useEffect(() => itemChatChanged(), [cache]);

  useEffect(() => {
    const host: ItemChatHost = {
      home: (ref) => cacheRef.current.get(itemKey(ref)),
      watch: (ref) => {
        if (!cacheRef.current.has(itemKey(ref))) load(ref);
      },
      open: (ref) => {
        const thread = cacheRef.current.get(itemKey(ref));
        if (thread) actionsRef.current.show(thread.threadId, ITEM_CHAT_TAG);
        else actionsRef.current.compose(ref);
      },
      start: (ref) => actionsRef.current.compose(ref),
      choose: (ref) => actionsRef.current.choose(ref),
      unlink: async (ref) => {
        try {
          await rpc.call("unlink", { pluginId: ref.pluginId, id: ref.id });
          put(itemKey(ref), null);
        } catch (cause) {
          toast.error(errorMessage(cause));
        }
      },
      send: async (ref, quote) => {
        const { threadId } = await rpc.call("send", { item: { pluginId: ref.pluginId, id: ref.id }, quote });
        if (!threadId) {
          actionsRef.current.compose(ref, quote);
          return null;
        }
        actionsRef.current.show(threadId, ITEM_CHAT_TAG);
        return threadId;
      },
    };
    return setItemChatHost(host);
  }, [rpc, load, put]);

  // Bring the item's home thread back behind the tab showing.
  const key = viewed ? itemKey(viewed) : null;
  const home = key ? cache.get(key) : undefined;
  useEffect(() => {
    // Every visit asks again, so a renamed or archived thread shows as it is.
    if (viewed) load(viewed);
    // The item, not its object identity, decides when to look.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);
  const homeId = home?.threadId ?? null;
  useEffect(() => {
    if (homeId && floatAvailable) openCompanion({ kind: "thread", threadId: homeId }, { minimized: true, tag: ITEM_CHAT_TAG });
  }, [homeId, floatAvailable]);

  return { cache, put, load };
}

/**
 * Says what's on screen and adds it to the next message. Rendered above a
 * Float thread window's messages so the composer it writes to is that thread's; if BB puts the
 * pill somewhere else, the button isn't offered. On BB's SDK 0.5.29 a
 * plugin's ThreadChat doesn't scope `useComposer()` to its thread, so only
 * the label shows until it does (docs/studio-chat.md, "Limits").
 */
function ViewingChip({ threadId, viewed }: { threadId: string; viewed: Viewed }) {
  const composer = useComposer();
  const writesHere = composer.scope.kind === "thread" && composer.scope.threadId === threadId;
  const title = untitled(viewed.title);
  return (
    <div className="studio-chat-viewing mx-3 mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
      <Icon name={viewed.kindIcon} className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        Viewing: <span className="text-foreground">{title}</span>
      </span>
      {writesHere ? (
        <button
          type="button"
          className="shrink-0 rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-state-hover"
          onClick={() => {
            composer.insertMention({ provider: MENTION_PROVIDER_ID, id: itemKey(viewed), label: title });
            composer.focus();
          }}
        >
          Add to message
        </button>
      ) : null}
    </div>
  );
}

/** The buttons, composer or picker: in Float's corner, or bottom right on its own. */
function Corner({ children }: { children: ReactNode }) {
  const floatAvailable = useFloatAvailable();
  if (floatAvailable) return <FloatDockPortal>{children}</FloatDockPortal>;
  return <div className="studio-chat pointer-events-none fixed right-6 bottom-4 z-40 max-md:inset-x-2 max-md:bottom-2">{children}</div>;
}

export function ChatOverlay() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const viewed = useViewing(rpc, usePathname());
  const floatAvailable = useFloatAvailable();
  const [fallbackRequest, setFallbackRequest] = useState<number | null>(null);
  const resolve = useCallback(async (ref: ItemChatRef) => (await rpc.call("subject", { pluginId: ref.pluginId, id: ref.id })).item, [rpc]);
  const reportError = useCallback((cause: unknown) => toast.error(errorMessage(cause)), []);
  const { dialog, open, close, isCurrent } = useChatDialog(resolve, reportError);

  const show = (threadId: string, tag?: string, dialogRequest?: number) => {
    close(dialogRequest);
    if (!openCompanion({ kind: "thread", threadId }, tag ? { tag } : {})) navigate.toThread(threadId);
  };
  const homes = useHomeThreads(rpc, viewed, {
    show,
    choose: (ref) => { void open(ref, "choose"); },
    compose: (ref, quote) => { void open(ref, "compose", quote); },
  });
  useEffect(() => {
    if (!dialog || dialog.mode !== "compose" || !floatAvailable || fallbackRequest === dialog.request) return;
    const current = dialog;
    let live = true;
    void (async () => {
      try {
        const saved = current.quote ? await quoteDrafts.save({ pluginId: current.item.pluginId, id: current.item.id }, current.quote) : null;
        if (!live || !isCurrent(current.request)) {
          if (saved) await quoteDrafts.remove(saved.id);
          return;
        }
        const path = saved ? quoteDraftPath(saved.id) : itemDraftPath(current.item);
        if (openCompanion({ kind: "path", path, title: `Chat: ${untitled(current.item.title)}`, icon: CHAT_ICON })) return close(current.request);
        // The overlay composer keeps the quote in memory; the saved copy has no reader.
        if (saved) void quoteDrafts.remove(saved.id).catch(() => {});
        setFallbackRequest(current.request);
      } catch (cause) {
        if (live && isCurrent(current.request)) { reportError(cause); setFallbackRequest(current.request); }
      }
    })();
    return () => { live = false; };
  }, [dialog, floatAvailable, fallbackRequest, close, isCurrent, reportError]);
  const chip = <FloatThreadLeading render={(threadId) => (viewed ? <ViewingChip threadId={threadId} viewed={viewed} /> : null)} />;
  if (!dialog) return chip;

  const { item, mode, quote, request: focus } = dialog;
  const key = itemKey(item);
  const home = homes.cache.get(key) ?? null;
  const kindLabel = item.kindLabel.toLowerCase();
  if (mode === "compose" && floatAvailable && fallbackRequest !== focus) return chip;
  return (
    <>
      {chip}
      <Corner>
        {mode === "compose" ? (
          <div className={cn(CARD, "w-[min(460px,calc(100vw-1rem))] h-[min(520px,calc(100dvh-6rem))] mb-2")}>
            <ConversationComposer
              key={quote ? `${key}:quote:${focus}` : key}
              item={item}
              {...(quote ? { quote } : {})}
              draftKey={quote ? `studio-chat:${key}:quote:${focus}` : `studio-chat:${key}`}
              focusRequest={focus}
              onClose={() => close()}
              onSubmit={async (request) => {
                const { threadId } = await rpc.call("start", { item: { pluginId: item.pluginId, id: item.id }, request });
                homes.load(item);
                show(threadId, ITEM_CHAT_TAG, focus);
              }}
            />
          </div>
        ) : (
          <section aria-label={`Choose this ${kindLabel}'s conversation`} className={cn(CARD, "studio-chat-picker w-[min(380px,calc(100vw-1rem))] mb-2")}>
            <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
              Quotes and chat about "{untitled(item.title)}" will go to the conversation you pick.
            </p>
            <ThreadPicker
              homeThreadId={home?.threadId ?? null}
              onClose={() => close()}
              onPick={(threadId) => {
                close();
                rpc.call("link", { pluginId: item.pluginId, id: item.id, threadId }).then(
                  ({ thread }) => {
                    homes.put(key, thread);
                    show(threadId, ITEM_CHAT_TAG, focus);
                  },
                  reportError,
                );
              }}
            />
          </section>
        )}
      </Corner>
    </>
  );
}
