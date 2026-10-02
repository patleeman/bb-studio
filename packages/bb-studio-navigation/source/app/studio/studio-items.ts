// Which navigation rows Studio Navigation leaves out. A Studio panel goes only
// when another surface on screen already reaches it; bb's own rows and every
// other plugin's panels stay.
import type { ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk/app";
import { useSidebarHosted } from "@bb-studio/kit/app";

export const STUDIO_HUB = "studio/studio";

/** Add-on panels the Studio hub lists and opens. */
export const HUB_PANELS = [
  "pages/pages",
  "excalidraw/drawings",
  "artifacts/artifacts",
  "talk/recordings",
  "studio-tasks/tasks",
  "studio-tables/tables",
  "bot-teams/views",
];

/** Legacy channel links are reached through saved Studio items. */
export const SECTION_PANELS = ["bot-teams/channels"];

export function studioNavigationItems(
  items: readonly ExperimentalSidebarNavigationItem[],
  sidebarHosted: boolean,
): ExperimentalSidebarNavigationItem[] {
  const hub = items.find((item) => item.id === STUDIO_HUB);
  const hubReachable = hub !== undefined && !hub.isDisabled && !hub.isLoading;
  return items.filter(
    (item) =>
      item.id !== "bot-teams/former-channels" &&
      !(hubReachable && HUB_PANELS.includes(item.id)) &&
      !(sidebarHosted && SECTION_PANELS.includes(item.id)),
  );
}

export function useStudioNavigationItems(
  items: readonly ExperimentalSidebarNavigationItem[],
): ExperimentalSidebarNavigationItem[] {
  return studioNavigationItems(items, useSidebarHosted());
}
