import { openAppPath } from "@bb-studio/kit/app";

/**
 * Opens a Space's item or thread as a workbench tab beside the Space's lead.
 * Only Studio can open its own panel tabs, so this asks it by window event
 * when a thread of the Space is already open, and otherwise leaves the
 * request for the lead's page to pick up once it opens. Mirrors Studio's
 * src/ui/space/open-in-space.ts.
 */
export const OPEN_IN_SPACE_EVENT = "bb-studio:open-in-space";
const PENDING_KEY = "bb-studio:open-in-space";

export type OpenInSpaceRequest =
  | { kind: "item"; path: string; title: string }
  | { kind: "thread"; threadId: string; title: string }
  | { kind: "new-item" }
  | { kind: "status" };

export function threadPath(threadId: string): string {
  return `/threads/${encodeURIComponent(threadId)}`;
}

export function openInSpace({
  spaceId,
  leadThreadId,
  currentThreadId,
  currentSpaceId,
  request,
  fallbackPath,
}: {
  spaceId: string;
  leadThreadId: string | null;
  currentThreadId: string | null;
  currentSpaceId: string | null;
  request: OpenInSpaceRequest;
  /** Where to go when the Space has no lead to open beside. */
  fallbackPath: string | null;
}): void {
  if (currentThreadId && currentSpaceId === spaceId) {
    const event = new CustomEvent(OPEN_IN_SPACE_EVENT, { detail: { threadId: currentThreadId, request }, cancelable: true });
    window.dispatchEvent(event);
    if (event.defaultPrevented) return;
  }
  if (leadThreadId) {
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ threadId: leadThreadId, request })); } catch { /* storage unavailable: just open the lead */ }
    openAppPath(threadPath(leadThreadId), { main: true });
    return;
  }
  if (fallbackPath) openAppPath(fallbackPath, { main: true });
}
