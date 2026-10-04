// Which navigation rows Studio Navigation leaves out. A Studio panel goes
// when another surface already reaches it or Studio retired it; bb's own rows
// and every other plugin's panels stay.
import type { ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk/app";

export const STUDIO_HUB = "studio/studio";

/** Add-on panels the Studio hub lists and opens. */
export const HUB_PANELS = [
  "pages/pages",
  "excalidraw/drawings",
  "artifacts/artifacts",
  "talk/recordings",
  "studio-tasks/tasks",
  "studio-tables/tables",
  "bot-teams/channels",
];

/**
 * Studio panels that never get a row, in the rows or in More. Their plugins
 * still run and their links still open.
 */
export const RETIRED_PANELS = [
  // Studio Explore, folded into Studio Pages.
  "explore/explainers",
  // The same panel inside Pages; explainers open from their links.
  "pages/explainers",
  // Float's Companions panel; Float's dock and toggle reach it.
  "float/companions",
  // Studio's legacy office panel ("Home").
  "studio/office",
  // Studio Chat's panel; chats start from Studio items and the overlay.
  "studio-chat/chats",
  // Old /views links redirect to channels; the row would only repeat Channels.
  "bot-teams/former-views",
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
