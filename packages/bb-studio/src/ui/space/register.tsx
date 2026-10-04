// Registers Spaces: lead chat on the left; dashboard and Page in the
// workbench on the right, the Spaces
// sidebar section, and the Space page beside every Space thread.
import { retainPanel } from "@bb-studio/kit/app";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { SpaceDashboardTab, ThreadSpaceOverview } from "./Overview";
import { SPACES_PANEL } from "./routes";
import { SidebarSpacesSection } from "./SidebarSpacesSection";
import { SpacePageTab, SpacesPanel } from "./SpaceView";
import { OpenSpacePage, SPACE_PAGE_ACTION, ThreadSpacePage } from "./ThreadSpacePage";

export function registerSpaces(app: PluginAppBuilder): void {
  app.slots.navPanel({
    id: SPACES_PANEL,
    title: "Spaces",
    icon: "Folder",
    path: SPACES_PANEL,
    component: retainPanel(SPACES_PANEL, SpacesPanel),
    fixedTabs: [
      { panelId: SPACES_PANEL, id: "overview", title: "Dashboard", icon: "Folder", component: SpaceDashboardTab, layout: "flush" },
      { panelId: SPACES_PANEL, id: "page", title: "Page", icon: "FileText", component: SpacePageTab, layout: "flush" },
    ],
  });
  // Every thread in a Space gets the Space's page beside it, opened once by itself (from the header action).
  app.slots.threadPanelAction({ id: SPACE_PAGE_ACTION, title: "Space page", icon: "FileText", layout: "flush", component: ThreadSpacePage });
  app.slots.threadPanelAction({ id: "space-overview", title: "Space overview", icon: "Folder", layout: "flush", component: ThreadSpaceOverview });
  // Mount the invisible Space page opener in the thread context.
  app.slots.experimental_threadHeaderAction({ id: "space-page-opener", title: "Space page", component: OpenSpacePage });
  app.slots.experimental_appOverlay({ id: "sidebar-spaces", component: SidebarSpacesSection });
}
