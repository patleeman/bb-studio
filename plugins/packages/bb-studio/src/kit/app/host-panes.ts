// BB's own split panes, where the running BB reports them
// (`experimental_useAppPanes`, fed in by host-bridge.tsx). Null on a BB
// without that hook, where Studio's workspace is the only pane layout.
import type { AppPanes } from "./host-sdk";

export type HostPanes = AppPanes;

let current: HostPanes | null = null;
const subscribers = new Set<() => void>();

export function setHostPanes(next: HostPanes | null): void {
  if (next === current) return;
  current = next;
  for (const notify of subscribers) notify();
}

export function hostPanes(): HostPanes | null {
  return current;
}

export function subscribeHostPanes(notify: () => void): () => void {
  subscribers.add(notify);
  return () => { subscribers.delete(notify); };
}

/**
 * Whether BB is showing `path` in a pane beside others. Such a pane shows the
 * one item at its own address; Studio's workspace leaves it alone.
 */
export function isHostSidePane(path: string): boolean {
  const panes = current?.panes ?? [];
  return panes.length > 1 && panes.some((pane) => pane.path.replace(/\/+$/, "") === path);
}
