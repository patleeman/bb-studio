// The Inbox's "Needs you" list: threads whose agent is blocked on the user,
// read from the sidebar's live thread view. Kept free of React so it is
// testable on its own.

/** The fields of a sidebar thread the Inbox reads. */
export interface InboxThreadSource {
  id: string;
  displayTitle: string;
  href: string;
  hasPendingInteraction: boolean;
  indicatorLabel: string | null;
  isArchived: boolean;
  isHidden: boolean;
  latestAttentionAt: number;
  updatedAt: number;
}

export interface WaitingThread {
  id: string;
  title: string;
  /** Why it waits, in the host's words ("Thread needs user input"), or null. */
  why: string | null;
  href: string;
  at: number;
}

/** Threads waiting on the user, the most recent first. */
export function waitingThreads(threads: readonly InboxThreadSource[]): WaitingThread[] {
  return threads
    .filter((thread) => thread.hasPendingInteraction && !thread.isArchived && !thread.isHidden)
    .map((thread) => ({
      id: thread.id,
      title: thread.displayTitle,
      why: thread.indicatorLabel,
      href: thread.href,
      at: thread.latestAttentionAt || thread.updatedAt,
    }))
    .sort((a, b) => b.at - a.at);
}

/** The sidebar row's count: threads that need you plus unread posts, or null for none. */
export function inboxBadge(waiting: number, unread: number): string | null {
  const total = Math.max(0, waiting) + Math.max(0, unread);
  if (!total) return null;
  return total > 99 ? "99+" : String(total);
}
