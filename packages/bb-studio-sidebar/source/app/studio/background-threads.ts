import type { SidebarThread } from "../model/sidebar-thread.js";

/** Keep a thread tree together, including children of explicitly pinned roots. */
function withDescendants(threads: readonly SidebarThread[], roots: ReadonlySet<string>): Set<string> {
  const children = new Map<string, string[]>();
  for (const thread of threads) {
    if (!thread.parentThreadId) continue;
    const bucket = children.get(thread.parentThreadId) ?? [];
    bucket.push(thread.id);
    children.set(thread.parentThreadId, bucket);
  }
  const result = new Set(roots);
  const pending = [...roots];
  for (let index = 0; index < pending.length; index += 1) {
    for (const id of children.get(pending[index]!) ?? []) {
      if (result.has(id)) continue;
      result.add(id);
      pending.push(id);
    }
  }
  return result;
}

export function backgroundThreadIds(threads: readonly SidebarThread[], attachedIds: ReadonlySet<string>): Set<string> {
  const roots = new Set(attachedIds);
  const pinned = new Set<string>();
  for (const thread of threads) {
    if (thread.originPluginId === "automations" || thread.originPluginId === "bot-teams") roots.add(thread.id);
    if (thread.isPinned) pinned.add(thread.id);
  }
  const result = withDescendants(threads, roots);
  for (const id of withDescendants(threads, pinned)) result.delete(id);
  return result;
}

export function hasBackgroundUpdate(thread: SidebarThread): boolean {
  return thread.hasPendingInteraction || thread.queuedWork === "failed" ||
    (thread.isUnread && (thread.status === "idle" || thread.status === "error"));
}

/** Include ancestors so an unread child never becomes an orphaned row. */
export function backgroundUpdates(threads: readonly SidebarThread[], selectedThreadId?: string): SidebarThread[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const visible = new Set<string>();
  for (const thread of threads) {
    if (!hasBackgroundUpdate(thread) && thread.id !== selectedThreadId) continue;
    let current: SidebarThread | undefined = thread;
    while (current && !visible.has(current.id)) {
      visible.add(current.id);
      current = current.parentThreadId ? byId.get(current.parentThreadId) : undefined;
    }
  }
  return threads.filter((thread) => visible.has(thread.id));
}
