// An item's home thread: the one thread its chat and quotes go to. Studio
// Chat keeps the links and registers as the host; item views use it from
// here, as the header's thread chip and a viewer's "Send to thread" do.
// Every plugin bundles its own copy of the kit, so the host lives on
// `window` under a versioned key.
import { useEffect, useSyncExternalStore } from "react";
import type { ItemQuote } from "../format";

export interface ItemChatRef {
  pluginId: string;
  id: string;
}

export interface HomeThread {
  threadId: string;
  title: string;
  /** "chosen" was started or picked for the item; "created" is the thread that made it. */
  origin: "chosen" | "created";
}

export interface ItemChatHost {
  /** The item's home thread; null for none, undefined until it has loaded. */
  home(ref: ItemChatRef): HomeThread | null | undefined;
  /** Loads the home thread if it isn't known yet. */
  watch(ref: ItemChatRef): void;
  /** Shows the linked conversation, or a composer when the item has none. */
  open(ref: ItemChatRef): void;
  /** Starts another conversation about the item. */
  start(ref: ItemChatRef): void;
  /** Lets the user pick another thread as the item's home. */
  choose(ref: ItemChatRef): void;
  unlink(ref: ItemChatRef): Promise<void>;
  /**
   * Sends the quote to the home thread and shows it. Without a home thread,
   * opens the new-thread composer holding the quote and resolves to null.
   */
  send(ref: ItemChatRef, quote: ItemQuote): Promise<string | null>;
}

interface Registry {
  host: ItemChatHost | null;
  revision: number;
}

const REGISTRY_KEY = "__bbStudioItemChat_v1";
const CHANGE_EVENT = "bb-studio-item-chat-change";

function registry(): Registry {
  const scope = window as unknown as Record<string, Registry | undefined>;
  scope[REGISTRY_KEY] ??= { host: null, revision: 0 };
  return scope[REGISTRY_KEY];
}

/** Tells item views that the host, or a home thread it knows, changed. */
export function itemChatChanged(): void {
  registry().revision += 1;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function setItemChatHost(host: ItemChatHost | null): () => void {
  registry().host = host;
  itemChatChanged();
  return () => {
    if (registry().host !== host) return;
    registry().host = null;
    itemChatChanged();
  };
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

const revision = () => registry().revision;

/** Studio Chat's host, or null when it isn't running. */
export function useItemChat(): ItemChatHost | null {
  useSyncExternalStore(subscribe, revision, revision);
  return registry().host;
}

/** `ref`'s home thread: null for none or without Studio Chat, undefined while loading. */
export function useHomeThread(ref: ItemChatRef | null): HomeThread | null | undefined {
  const host = useItemChat();
  const pluginId = ref?.pluginId;
  const id = ref?.id;
  useEffect(() => {
    if (host && pluginId && id) host.watch({ pluginId, id });
  }, [host, pluginId, id]);
  if (!host || !pluginId || !id) return null;
  return host.home({ pluginId, id });
}
