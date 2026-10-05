import {
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import {
  cn,
  itemChatChanged,
  setItemChatHost,
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
import { itemKey } from "../context";
import { ThreadPicker } from "./ThreadPicker";
import { useChatDialog } from "./use-chat-dialog";
import { ConversationComposer } from "./ConversationComposer";
import { CONVERSATION_STARTED } from "./conversation-drafts";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

const CARD = "pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl";

/** The Studio item on screen, or null; each path is asked once. */
function useViewing(rpc: Rpc, path: string): Viewed | null {
  const [viewed, setViewed] = useState<{ path: string; item: Viewed | null } | null>(null);
  useEffect(() => {
    if (!path.startsWith("/plugins/")) return setViewed({ path, item: null });
    let live = true;
    rpc.call("chat.viewing", { path }).then(
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
 * demand, plus what the header chip and quotes ask for.
 */
function useHomeThreads(
  rpc: Rpc,
  viewed: Viewed | null,
  actions: { show(threadId: string): void; choose(ref: ItemChatRef): void; compose(ref: ItemChatRef, quote?: ItemQuote): void },
): { cache: HomeCache; put(key: string, thread: HomeThread | null): void; load(ref: ItemChatRef): void } {
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
      rpc.call("chat.home", { pluginId: ref.pluginId, id: ref.id }).then(
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
        if (thread) actionsRef.current.show(thread.threadId);
        else actionsRef.current.compose(ref);
      },
      start: (ref) => actionsRef.current.compose(ref),
      choose: (ref) => actionsRef.current.choose(ref),
      unlink: async (ref) => {
        try {
          await rpc.call("chat.unlink", { pluginId: ref.pluginId, id: ref.id });
          put(itemKey(ref), null);
        } catch (cause) {
          toast.error(errorMessage(cause));
        }
      },
      send: async (ref, quote) => {
        const { threadId } = await rpc.call("chat.send", { item: { pluginId: ref.pluginId, id: ref.id }, quote });
        if (!threadId) {
          actionsRef.current.compose(ref, quote);
          return null;
        }
        actionsRef.current.show(threadId);
        return threadId;
      },
    };
    return setItemChatHost(host);
  }, [rpc, load, put]);

  // Know the home thread of the item on screen, for its header chip.
  const key = viewed ? itemKey(viewed) : null;
  useEffect(() => {
    // Every visit asks again, so a renamed or archived thread shows as it is.
    if (viewed) load(viewed);
    // The item, not its object identity, decides when to look.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);
  return { cache, put, load };
}

/** The composer or picker, bottom right, over whatever is on screen. */
function Corner({ children }: { children: ReactNode }) {
  return <div className="studio-chat pointer-events-none fixed right-6 bottom-4 z-40 max-md:inset-x-2 max-md:bottom-2">{children}</div>;
}

export function ChatOverlay() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const viewed = useViewing(rpc, usePathname());
  const resolve = useCallback(async (ref: ItemChatRef) => (await rpc.call("chat.subject", { pluginId: ref.pluginId, id: ref.id })).item, [rpc]);
  const reportError = useCallback((cause: unknown) => toast.error(errorMessage(cause)), []);
  const { dialog, open, close } = useChatDialog(resolve, reportError);

  const show = (threadId: string, dialogRequest?: number) => {
    close(dialogRequest);
    navigate.toThread(threadId);
  };
  const homes = useHomeThreads(rpc, viewed, {
    show,
    choose: (ref) => { void open(ref, "choose"); },
    compose: (ref, quote) => { void open(ref, "compose", quote); },
  });
  if (!dialog) return null;

  const { item, mode, quote, request: focus } = dialog;
  const key = itemKey(item);
  const home = homes.cache.get(key) ?? null;
  const kindLabel = item.kindLabel.toLowerCase();
  return (
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
              const { threadId } = await rpc.call("chat.start", { item: { pluginId: item.pluginId, id: item.id }, request });
              homes.load(item);
              show(threadId, focus);
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
              rpc.call("chat.link", { pluginId: item.pluginId, id: item.id, threadId }).then(
                ({ thread }) => {
                  homes.put(key, thread);
                  show(threadId, focus);
                },
                reportError,
              );
            }}
          />
        </section>
      )}
    </Corner>
  );
}
