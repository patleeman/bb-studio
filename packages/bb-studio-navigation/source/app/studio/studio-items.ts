// Which navigation rows Studio Navigation leaves out. A Studio panel goes
// when another surface already reaches it or Studio retired it; bb's own rows
// and every other plugin's panels stay.
import { experimental_useSidebarThreadActions, type ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk/app";

export const STUDIO_HUB = "studio/studio";

/** Add-on panels the Studio hub lists and opens. */
export const HUB_PANELS = [
  "pages/pages",
  "excalidraw/drawings",
  "artifacts/artifacts",
  "talk/recordings",
  "studio-tables/tables",
];

/**
 * Studio panels that never get a row, in the rows or in More. Their plugins
 * still run and their links still open.
 */
export const RETIRED_PANELS = [
  // Explore's panel inside Pages; explainers open from their links.
  "pages/explainers",
  // Float's Companions panel; Float's dock and toggle reach it.
  "float/companions",
  // Studio Chat's panel; chats start from Studio items and the overlay.
  "studio-chat/chats",
  // Teams' per-Space Command view; the sidebar's Space menu opens it.
  "bot-teams/command",
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

/** Studio Sidebar keeps the selected Space's default project here (By space, one Space shown). */
export const SPACE_NEW_THREAD_PROJECT_KEY = "bb-studio:space-new-thread-project";
/** And that Space's id, for the composer's Space picker. */
export const SPACE_NEW_THREAD_SPACE_KEY = "bb-studio:space-new-thread-space";
/** Read once by Studio's composer Space picker; see Studio Sidebar's new-thread-space.ts. */
const NEW_THREAD_SPACE_HANDOFF = "studio:new-thread-space";

/**
 * New thread starts in the Space the sidebar shows, as the Space's own + does.
 * Returns whether it handled the click; ⌘-click (split) and no Space fall back to bb.
 */
export function useSpaceNewThread(): (item: ExperimentalSidebarNavigationItem, openInSplit: boolean) => boolean {
  const threads = experimental_useSidebarThreadActions();
  return (item, openInSplit) => {
    if (item.action.kind !== "new-thread" || openInSplit) return false;
    let projectId: string | null = null;
    let spaceId: string | null = null;
    try {
      projectId = localStorage.getItem(SPACE_NEW_THREAD_PROJECT_KEY);
      spaceId = localStorage.getItem(SPACE_NEW_THREAD_SPACE_KEY);
    } catch { /* storage unavailable */ }
    if (!projectId) return false;
    if (spaceId) {
      const detail = { spaceId, projectId, at: Date.now() };
      try { sessionStorage.setItem(NEW_THREAD_SPACE_HANDOFF, JSON.stringify(detail)); } catch { /* storage unavailable */ }
      window.dispatchEvent(new CustomEvent(NEW_THREAD_SPACE_HANDOFF, { detail }));
    }
    threads.openNewThread({ projectId, focusPrompt: true });
    return true;
  };
}
