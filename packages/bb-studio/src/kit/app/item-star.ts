// Stars: Studio keeps which items the user starred (src/stars.ts) and
// registers as the host; item headers show a star toggle from here. Every
// plugin bundles its own copy of the kit, so the host lives on `window`
// under a versioned key, as the item chat host does (./item-chat.ts).
import { useSyncExternalStore } from "react";

export interface ItemStarRef {
  pluginId: string;
  id: string;
}

export interface ItemStarHost {
  /** Whether the item is starred; undefined until the stars have loaded. */
  starred(ref: ItemStarRef): boolean | undefined;
  /** Stars or unstars the item. */
  set(ref: ItemStarRef, starred: boolean): Promise<void>;
}

interface Registry {
  host: ItemStarHost | null;
  revision: number;
}

const REGISTRY_KEY = "__bbStudioItemStar_v1";
const CHANGE_EVENT = "bb-studio-item-star-change";

function registry(): Registry {
  const scope = window as unknown as Record<string, Registry | undefined>;
  scope[REGISTRY_KEY] ??= { host: null, revision: 0 };
  return scope[REGISTRY_KEY];
}

/** Tells item headers that the host, or what's starred, changed. */
export function itemStarsChanged(): void {
  registry().revision += 1;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function setItemStarHost(host: ItemStarHost | null): () => void {
  registry().host = host;
  itemStarsChanged();
  return () => {
    if (registry().host !== host) return;
    registry().host = null;
    itemStarsChanged();
  };
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

const revision = () => registry().revision;

/** Studio's star host, or null until it registers. */
export function useItemStarHost(): ItemStarHost | null {
  useSyncExternalStore(subscribe, revision, revision);
  return registry().host;
}

/** Whether the item is starred, re-rendering when stars change. */
export function useItemStarred(ref: ItemStarRef | null): { host: ItemStarHost | null; starred: boolean | undefined } {
  const host = useItemStarHost();
  return { host, starred: host && ref ? host.starred(ref) : undefined };
}
