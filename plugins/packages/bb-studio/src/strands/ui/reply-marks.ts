// Which assistant message of a turn carries its reply's "Needs you" line: the
// newest one shown. Every assistant message of the turn mounts a tag; each
// registers here with its time, and only the newest draws the line.
import { useEffect, useSyncExternalStore } from "react";

const turns = new Map<string, Map<string, number>>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Whether message `id` is the newest of its turn's messages shown (by time, then id). */
export function isNewestInTurn(key: string, id: string): boolean {
  const messages = turns.get(key);
  if (!messages?.has(id)) return false;
  let best: [string, number] | null = null;
  for (const entry of messages) if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] > best[0])) best = entry;
  return best?.[0] === id;
}

export function registerMessage(key: string, id: string, at: number): () => void {
  const messages = turns.get(key) ?? new Map<string, number>();
  messages.set(id, at);
  turns.set(key, messages);
  notify();
  return () => {
    const current = turns.get(key);
    if (!current) return;
    current.delete(id);
    if (!current.size) turns.delete(key);
    notify();
  };
}

/** Registers an assistant message of a turn while `on`; answers whether it is the turn's newest. */
export function useNewestInTurn(threadId: string, turnId: string | null, id: string, at: number, on: boolean): boolean {
  const key = `${threadId}:${turnId ?? ""}`;
  useEffect(() => (on && turnId ? registerMessage(key, id, at) : undefined), [key, id, at, on, turnId]);
  return useSyncExternalStore(subscribe, () => on && !!turnId && isNewestInTurn(key, id), () => false);
}
