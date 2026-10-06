// Which navigation rows Studio Navigation leaves out. A Studio panel goes
// when another surface already reaches it or Studio retired it; bb's own rows
// and every other plugin's panels stay.
import { experimental_useSidebarThreadActions, type ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk/app";
import { handOffNewThreadSpace, spaceNewThreadTarget } from "../../studio/new-thread-space.js";

export const STUDIO_HUB = "studio/studio";

/** Add-on panels the Studio hub lists and opens. */
export const HUB_PANELS = [
  "pages/pages",
  "excalidraw/drawings",
  "artifacts/artifacts",
  "talk/recordings",
  "studio-tables/tables",
  "design/designs",
];

/**
 * Studio panels that never get a row, in the rows or in More. Their plugins
 * still run and their links still open.
 */
export const RETIRED_PANELS = [
  // Explore's panel inside Pages; explainers open from their links.
  "pages/explainers",
  // The retired Float plugin's Companions panel, while it's still installed.
  "float/companions",
  // Studio Chat's panel; chats start from Studio items and the overlay.
  "studio/chats",
  "studio-chat/chats",
];

export function studioNavigationItems(
  items: readonly ExperimentalSidebarNavigationItem[],
): ExperimentalSidebarNavigationItem[] {
  const hub = items.find((item) => item.id === STUDIO_HUB);
  const hubReachable = hub !== undefined && !hub.isDisabled && !hub.isLoading;
  return items.filter(
    (item) =>
      !RETIRED_PANELS.includes(item.id) &&
      !(hubReachable && HUB_PANELS.includes(item.id)),
  );
}

export function useStudioNavigationItems(
  items: readonly ExperimentalSidebarNavigationItem[],
): ExperimentalSidebarNavigationItem[] {
  return studioNavigationItems(items);
}

/**
 * New thread starts in the Space the sidebar shows, as the Space's own + does.
 * Returns whether it handled the click; ⌘-click (split) and no Space fall back to bb.
 */
export function useSpaceNewThread(): (item: ExperimentalSidebarNavigationItem, openInSplit: boolean) => boolean {
  const threads = experimental_useSidebarThreadActions();
  return (item, openInSplit) => {
    if (item.action.kind !== "new-thread" || openInSplit) return false;
    const target = spaceNewThreadTarget();
    if (!target) return false;
    handOffNewThreadSpace(target.spaceId, target.projectId);
    threads.openNewThread({ projectId: target.projectId, focusPrompt: true });
    return true;
  };
}
