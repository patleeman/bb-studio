// Marks on the sidebar's thread rows from other Studio apps, such as the bot a
// thread works as. An app publishes a badge per thread; Studio Sidebar draws
// it before the thread's title. Every plugin bundles its own copy of the kit,
// so the badges live on `window` under a versioned key, as sidebar sections do.
import { useSyncExternalStore } from "react";

export interface ThreadBadge {
  /** An emoji or a short text mark. */
  glyph: string;
  /** What the mark means, for its tooltip and accessible name. */
  label: string;
}

interface Registry {
  /** Each source's badges, by thread id. */
  sources: Map<string, ReadonlyMap<string, ThreadBadge>>;
  revision: number;
}

const REGISTRY_KEY = "__bbStudioThreadBadges_v1";
const CHANGE_EVENT = "bb-studio-thread-badges-change";

function registry(): Registry {
  const scope = window as unknown as Record<string, Registry | undefined>;
  scope[REGISTRY_KEY] ??= { sources: new Map(), revision: 0 };
  return scope[REGISTRY_KEY];
}

/**
 * Replaces the badges `source` (usually the plugin id) puts on thread rows.
 * Returns a function that removes them.
 */
export function publishThreadBadges(source: string, badges: ReadonlyMap<string, ThreadBadge>): () => void {
  const current = registry();
  current.sources.set(source, badges);
  current.revision += 1;
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return () => {
    if (current.sources.get(source) !== badges) return;
    current.sources.delete(source);
    current.revision += 1;
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

const revision = () => registry().revision;

/** The badge a thread's row shows, or null for most threads. */
export function useThreadBadge(threadId: string): ThreadBadge | null {
  useSyncExternalStore(subscribe, revision, revision);
  for (const badges of registry().sources.values()) {
    const badge = badges.get(threadId);
    if (badge) return badge;
  }
  return null;
}
