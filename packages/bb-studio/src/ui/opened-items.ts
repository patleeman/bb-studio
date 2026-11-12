// Items act like tabs in the sidebar: one shows there once it has been
// opened, from anywhere. Every opener calls noteOpened; the bridge
// (opened-items-bridge.tsx) lends it Studio's RPC client. Paths that are not
// an item's view are ignored by the server. Recording an item also answers
// with its title, so a tab opened without one is still named for its item.
type Recorder = (path: string) => Promise<string | null>;

let record: Recorder | null = null;

export function setOpenedRecorder(next: Recorder | null): () => void {
  record = next;
  return () => { if (record === next) record = null; };
}

/** Whether anything records opens yet (false before Studio's bridge mounts, and on its own in tests). */
export const hasOpenedRecorder = (): boolean => record !== null;

/** Marks the item at `path` as open and resolves to its title, or null. Never throws or rejects. */
export function noteOpened(path: string | null | undefined): Promise<string | null> {
  if (!path || !path.startsWith("/") || !record) return Promise.resolve(null);
  try { return record(path).catch(() => null); } catch { return Promise.resolve(null); }
}
