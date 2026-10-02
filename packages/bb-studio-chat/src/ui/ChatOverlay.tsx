// Studio Chat: over a Studio item, "New in Float" starts a thread about it and
// "Open in Float" brings back one you have (without Float, "New thread" and
// "Open thread" open BB's own view), and the item's home thread comes back
// by itself. It's also the kit's item-chat host: the header's thread chip
// and quotes from item views go through it. Threads show as Float tabs, which
// this plugin adds a "Viewing" chip to; the buttons sit in Float's
// bottom-right corner, or on their own without Float.
import {
  experimental_NewThreadComposer as NewThreadComposer,
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
  openFloat,
  setItemChatHost,
  useFloatAvailable,
  usePathname,
  type HomeThread,
  type ItemChatHost,
  type ItemChatRef,
} from "@bb-studio/kit/app";
import { errorMessage, quoteMessage, untitled, type ItemQuote } from "@bb-studio/kit/format";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { rpcContract, Viewed } from "../contract";
import { MENTION_PROVIDER_ID } from "../ids";
import { itemKey } from "../context";
import { HEADER_BUTTON } from "./styles";
import { ThreadPicker } from "./ThreadPicker";

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
  // Keep the last item while the next path loads, so the bar doesn't blink.
  return viewed?.item ?? null;
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
  actions: { show(threadId: string, tag?: string): void; choose(ref: ItemChatRef): void; compose(ref: ItemChatRef, quote: ItemQuote): void },
): { cache: HomeCache; put(key: string, thread: HomeThread | null): void; load(ref: ItemChatRef): void } {
  const floatAvailable = useFloatAvailable();
  const [cache, setCache] = useState<HomeCache>(() => new Map());
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const loading = useRef(new Set<string>());
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const put = useCallback((key: string, thread: HomeThread | null) => {
    setCache((current) => new Map(current).set(key, thread));
  }, []);
  const load = useCallback(
    (ref: ItemChatRef) => {
      const key = itemKey(ref);
      if (loading.current.has(key)) return;
      loading.current.add(key);
      rpc.call("home", { pluginId: ref.pluginId, id: ref.id }).then(
        ({ thread }) => put(key, thread),
        () => put(key, null),
      ).finally(() => loading.current.delete(key));
    },
    [rpc, put],
  );

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
      },
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
    if (homeId && floatAvailable) openFloat({ kind: "thread", threadId: homeId }, { minimized: true, tag: ITEM_CHAT_TAG });
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
  const path = usePathname();
  const viewed = useViewing(rpc, path);
  const floatAvailable = useFloatAvailable();
  /** "choose" picks the item's home thread; "pick" just opens one. */
  const [open, setOpen] = useState<"compose" | "pick" | "choose" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  /** A quote waiting in the composer because the item has no thread yet. */
  const [seed, setSeed] = useState<{ key: string; text: string; count: number } | null>(null);

  // Without Float, threads open in BB's own view.
  const show = (threadId: string, tag?: string) => {
    if (!openFloat({ kind: "thread", threadId }, tag ? { tag } : {})) navigate.toThread(threadId);
  };
  const compose = () => {
    setFocus((value) => value + 1);
    setOpen("compose");
  };
  const homes = useHomeThreads(rpc, viewed, {
    show,
    choose: () => setOpen("choose"),
    compose: (ref, quote) => {
      setSeed((current) => ({ key: itemKey(ref), text: quoteMessage(quote), count: (current?.count ?? 0) + 1 }));
      compose();
    },
  });

  const chip = <FloatThreadLeading render={(threadId) => (viewed ? <ViewingChip threadId={threadId} viewed={viewed} /> : null)} />;
  if (!viewed) return chip;

  const key = itemKey(viewed);
  const home = homes.cache.get(key) ?? null;
  const kindLabel = viewed.kindLabel.toLowerCase();
  const quoted = seed?.key === key ? seed : null;
  const close = () => {
    setOpen(null);
    setSeed(null);
  };

  return (
    <>
      {chip}
      <Corner>
        {open === "compose" ? (
          <section aria-label={`Work with this ${kindLabel}`} className={cn(CARD, "w-[min(460px,calc(100vw-1rem))] mb-2")}>
            <header className="flex items-center gap-2 border-b border-border py-1.5 pr-2 pl-4 text-xs text-muted-foreground">
              <Icon name={viewed.kindIcon} className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                An agent works on "{untitled(viewed.title)}" with you. @mention a bot to hand it off.
              </span>
              <button type="button" aria-label="Close composer" className={HEADER_BUTTON} onClick={close}>
                <Icon name="X" className="size-4" />
              </button>
            </header>
            {error ? <p className="px-4 pt-1 text-xs text-red-500">{error}</p> : null}
            <NewThreadComposer
              key={quoted ? `${key}:quote:${quoted.count}` : key}
              className="studio-chat-composer max-h-[60vh] min-h-0"
              layout="document"
              placeholder={`Work with this ${kindLabel}…`}
              draftKey={quoted ? `studio-chat:${key}:quote:${quoted.count}` : `studio-chat:${key}`}
              {...(quoted ? { initialPrompt: quoted.text } : {})}
              focusRequest={focus}
              {...(viewed.projectId ? { defaultProjectId: viewed.projectId } : {})}
              onSubmit={async (request) => {
                setError(null);
                try {
                  const { threadId } = await rpc.call("start", { item: { pluginId: viewed.pluginId, id: viewed.id }, request });
                  close();
                  homes.load(viewed);
                  show(threadId, ITEM_CHAT_TAG);
                } catch (cause) {
                  setError(errorMessage(cause));
                  throw cause; // Keeps the draft for another try.
                }
              }}
            />
          </section>
        ) : open === "pick" || open === "choose" ? (
          <section aria-label={open === "choose" ? `Choose this ${kindLabel}'s thread` : "Open a thread"} className={cn(CARD, "studio-chat-picker w-[min(380px,calc(100vw-1rem))] mb-2")}>
            {open === "choose" ? (
              <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                Quotes and chat about "{untitled(viewed.title)}" will go to the thread you pick.
              </p>
            ) : null}
            <ThreadPicker
              homeThreadId={home?.threadId ?? null}
              onClose={() => setOpen(null)}
              onPick={(threadId) => {
                const choosing = open === "choose";
                setOpen(null);
                if (!choosing) return show(threadId);
                rpc.call("link", { pluginId: viewed.pluginId, id: viewed.id, threadId }).then(
                  ({ thread }) => {
                    homes.put(key, thread);
                    show(threadId, ITEM_CHAT_TAG);
                  },
                  (cause) => toast.error(errorMessage(cause)),
                );
              }}
            />
          </section>
        ) : (
          <div className="studio-chat-bar pointer-events-auto mb-2 flex h-10 items-center rounded-lg border border-border bg-background p-1 text-sm shadow-xl">
            <button
              type="button"
              title={`Start a thread about this ${kindLabel}`}
              className="flex h-full items-center gap-2 rounded-md px-3 text-muted-foreground hover:bg-state-hover hover:text-foreground"
              onClick={compose}
            >
              <Icon name="MessageSquarePlus" className="size-4 shrink-0" />
              {floatAvailable ? "New in Float" : "New thread"}
            </button>
            <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
            <button
              type="button"
              title={floatAvailable ? "Open a thread in Float" : "Open a thread"}
              className="flex h-full items-center gap-2 rounded-md px-3 text-muted-foreground hover:bg-state-hover hover:text-foreground"
              onClick={() => setOpen("pick")}
            >
              <Icon name="MessageSquare" className="size-4 shrink-0" />
              {floatAvailable ? "Open in Float" : "Open thread"}
            </button>
          </div>
        )}
      </Corner>
    </>
  );
}
