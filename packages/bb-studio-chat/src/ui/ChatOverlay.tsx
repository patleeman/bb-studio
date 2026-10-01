// Studio Chat: over a Studio item, a "Work with this…" bar that starts a
// thread about it, and the item's last chat brought back. Threads show as
// Float tabs, which this plugin adds a "Viewing" chip to; the bar sits in
// Float's bottom-right corner, or on its own without Float.
import {
  experimental_NewThreadComposer as NewThreadComposer,
  useBbNavigate,
  useComposer,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { cn, FloatDockPortal, FloatThreadLeading, Icon, openFloat, useFloatAvailable, usePathname } from "@bb-studio/kit/app";
import { errorMessage, untitled } from "@bb-studio/kit/format";
import { useEffect, useState, type ReactNode } from "react";
import type { rpcContract, Viewed } from "../contract";
import { MENTION_PROVIDER_ID } from "../ids";
import { itemKey } from "../context";
import { HEADER_BUTTON } from "./styles";

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

/** Brings back the chat last used on the item, as a background tab, when it comes on screen. */
function useItemChat(rpc: Rpc, viewed: Viewed | null, floatAvailable: boolean) {
  const key = viewed ? itemKey(viewed) : null;
  useEffect(() => {
    if (!viewed || !floatAvailable) return;
    let live = true;
    rpc.call("lastThread", { pluginId: viewed.pluginId, id: viewed.id }).then(
      ({ threadId }) => {
        if (live && threadId) openFloat({ kind: "thread", threadId }, { minimized: true, tag: ITEM_CHAT_TAG });
      },
      () => {},
    );
    return () => {
      live = false;
    };
    // The item, not its object identity, decides when to look.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, key, floatAvailable]);
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

/** The bar or composer: in Float's corner, or bottom right on its own. */
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
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  useItemChat(rpc, viewed, floatAvailable);

  const chip = <FloatThreadLeading render={(threadId) => (viewed ? <ViewingChip threadId={threadId} viewed={viewed} /> : null)} />;
  if (!viewed) return chip;

  const kindLabel = viewed.kindLabel.toLowerCase();
  const compose = () => {
    setFocus((value) => value + 1);
    setComposing(true);
  };

  return (
    <>
      {chip}
      <Corner>
        {composing ? (
          <section aria-label={`Work with this ${kindLabel}`} className={cn(CARD, "w-[min(460px,calc(100vw-1rem))] mb-2")}>
            <header className="flex items-center gap-2 border-b border-border py-1.5 pr-2 pl-4 text-xs text-muted-foreground">
              <Icon name={viewed.kindIcon} className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                An agent works on "{untitled(viewed.title)}" with you. @mention a bot to hand it off.
              </span>
              <button type="button" aria-label="Close composer" className={HEADER_BUTTON} onClick={() => setComposing(false)}>
                <Icon name="X" className="size-4" />
              </button>
            </header>
            {error ? <p className="px-4 pt-1 text-xs text-red-500">{error}</p> : null}
            <NewThreadComposer
              key={itemKey(viewed)}
              className="studio-chat-composer max-h-[60vh] min-h-0"
              layout="document"
              placeholder={`Work with this ${kindLabel}…`}
              draftKey={`studio-chat:${itemKey(viewed)}`}
              focusRequest={focus}
              {...(viewed.projectId ? { defaultProjectId: viewed.projectId } : {})}
              onSubmit={async (request) => {
                setError(null);
                try {
                  const { threadId } = await rpc.call("start", { item: { pluginId: viewed.pluginId, id: viewed.id }, request });
                  setComposing(false);
                  // Without Float, the new thread opens in BB's own view.
                  if (!openFloat({ kind: "thread", threadId }, { tag: ITEM_CHAT_TAG })) navigate.toThread(threadId);
                } catch (cause) {
                  setError(errorMessage(cause));
                  throw cause; // Keeps the draft for another try.
                }
              }}
            />
          </section>
        ) : (
          <button
            type="button"
            className="studio-chat-bar pointer-events-auto mb-2 flex h-10 w-[min(300px,calc(100vw-1rem))] items-center gap-2.5 rounded-lg border border-border bg-background px-4 text-left text-sm text-muted-foreground shadow-xl hover:text-foreground"
            onClick={compose}
          >
            <Icon name="MessageSquarePlus" className="size-4 shrink-0" />
            <span className="flex-1 truncate">Work with this {kindLabel}…</span>
          </button>
        )}
      </Corner>
    </>
  );
}
