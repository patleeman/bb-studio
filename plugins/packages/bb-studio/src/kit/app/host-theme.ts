// BB's light or dark mode and theme counter, where the running BB reports
// them (`experimental_useAppTheme`, fed in by host-bridge.tsx). Null on a BB
// without that hook, where Studio watches the document instead.
import type { AppTheme } from "./host-sdk";

let current: AppTheme | null = null;
const subscribers = new Set<() => void>();

export function setHostTheme(next: AppTheme | null): void {
  if (next?.mode === current?.mode && next?.epoch === current?.epoch) return;
  current = next;
  for (const notify of subscribers) notify();
}

export function hostTheme(): AppTheme | null {
  return current;
}

export function subscribeHostTheme(notify: () => void): () => void {
  subscribers.add(notify);
  return () => { subscribers.delete(notify); };
}
