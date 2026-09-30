import { useBbNavigate, useSidebarSplitLayout } from "@get-bb/plugin-sdk/app";

const splitClicks = new WeakSet<Event>();
export const isThreadSplitClick = (event: Event) => splitClicks.has(event);

export function threadLinkPath(projectId: string, threadId: string): string {
  const threadPath = `threads/${encodeURIComponent(threadId)}`;
  return projectId === "proj_personal"
    ? `/${threadPath}`
    : `/projects/${encodeURIComponent(projectId)}/${threadPath}`;
}

/**
 * Hidden bot threads are absent from BB's sidebar action lookup, and personal
 * /threads/:id links cannot be resolved to split pane content. Open a plugin
 * route in a pane first; ChannelsPage resolves it to the exact thread.
 */
function openThreadRouteInSplit(
  anchor: HTMLAnchorElement | null,
  threadId: string,
): void {
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  anchor.href = `/plugins/bot-teams/channels/thread/${encodeURIComponent(threadId)}`;
  // Keep the event on the plugin's mounted anchor so the host route delegate
  // owns pane placement. Suppress browser defaults if no delegate handles it.
  const suppressDefault = (event: MouseEvent) => event.preventDefault();
  window.addEventListener("click", suppressDefault, { once: true });
  try {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      view: window,
    });
    splitClicks.add(event);
    anchor.dispatchEvent(event);
  } finally {
    window.removeEventListener("click", suppressDefault);
    if (href === null) anchor.removeAttribute("href");
    else anchor.setAttribute("href", href);
  }
}

export function useOpenThreadInSplit(threadId: string) {
  const layout = useSidebarSplitLayout();
  const navigate = useBbNavigate();
  return (anchor: HTMLAnchorElement | null) => {
    if (layout?.panes.some((pane) => pane.threadId === threadId)) {
      navigate.toThread(threadId);
      return;
    }
    openThreadRouteInSplit(anchor, threadId);
  };
}
