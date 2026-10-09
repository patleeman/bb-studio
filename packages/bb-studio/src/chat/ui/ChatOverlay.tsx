import { useRpc } from "@get-bb/plugin-sdk/app";
import {
  itemChatChanged,
  setItemChatHost,
  useOpenTarget,
  usePathname,
  workspaceActivePath,
  subscribeWorkspace,
  WORKSPACE_PATH,
  type HomeThread,
  type ItemChatHost,
  type ItemChatRef,
} from "@bb-studio/kit/app";
import { errorMessage, type ItemQuote } from "@bb-studio/kit/format";
import { useSyncExternalStore, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { rpcContract, Viewed } from "../contract";
import { ref as itemRefSchema } from "../schemas";
import { itemKey } from "../context";
import { CHAT_ICON, CONVERSATION_STARTED, chooseThreadPath, itemDraftPath, quoteDraftPath, quoteDrafts } from "./conversation-drafts";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

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

/**
 * Studio Chat as the item-chat host. It draws nothing of its own: an item's
 * thread, a new conversation about it, or the thread picker opens in a split
 * beside the item.
 */
export function ChatOverlay() {
  const rpc = useRpc<typeof rpcContract>();
  const path = usePathname();
  const active = useSyncExternalStore(subscribeWorkspace, workspaceActivePath, () => null);
  const viewed = useViewing(rpc, path === WORKSPACE_PATH ? active ?? path : path);
  const { open, anchor } = useOpenTarget();
  const reportError = useCallback((cause: unknown) => toast.error(errorMessage(cause)), []);
  useHomeThreads(rpc, viewed, {
    show: (threadId) => open({ kind: "thread", threadId }, "split"),
    choose: (ref) => open({ kind: "path", path: chooseThreadPath(ref), title: "Choose conversation", icon: CHAT_ICON }, "split"),
    compose: (ref, quote) => {
      const title = "New conversation";
      if (!quote) return open({ kind: "path", path: itemDraftPath(ref), title, icon: CHAT_ICON }, "split");
      quoteDrafts.save({ pluginId: ref.pluginId, id: ref.id }, quote).then(
        (draft) => open({ kind: "path", path: quoteDraftPath(draft.id), title, icon: CHAT_ICON }, "split"),
        reportError,
      );
    },
  });
  return anchor;
}
