import { useSyncExternalStore } from "react";

/**
 * Which thread composers hold unsent text, as seen by this client. BB's
 * `useSidebarThreadDraft` only knows threads in its own sidebar list, and a
 * channel's thread is hidden from that list, so a channel row watches its
 * composer here instead. Kept in localStorage so a draft left in a channel
 * still shows after a reload, as BB's own composer drafts do.
 */
const storageKey = "bb:bots:channel-drafts";
const limit = 200;
const listeners = new Set<() => void>();
let drafts: ReadonlySet<string> = read();

function read(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    const ids: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function setThreadDraft(threadId: string, hasDraft: boolean) {
  if (drafts.has(threadId) === hasDraft) return;
  const next = new Set(drafts);
  if (hasDraft) next.add(threadId);
  else next.delete(threadId);
  // Oldest first: a thread deleted with a draft in it drops off eventually.
  drafts = new Set([...next].slice(-limit));
  try {
    localStorage.setItem(storageKey, JSON.stringify([...drafts]));
  } catch {}
  for (const listener of listeners) listener();
}

// Another BB window typed or sent in a channel.
window.addEventListener("storage", (event) => {
  if (event.key !== storageKey) return;
  drafts = read();
  for (const listener of listeners) listener();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThreadDraft(threadId: string | undefined) {
  return useSyncExternalStore(subscribe, () => !!threadId && drafts.has(threadId));
}
