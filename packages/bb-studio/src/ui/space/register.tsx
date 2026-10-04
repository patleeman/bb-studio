// Registers Spaces as projects: the Spaces panel (a Space's lead in the
// middle; its Overview, Page and Thread as fixed workbench tabs), the Spaces
// sidebar section, the Space page beside every Space thread, and Hand off.
import { retainPanel } from "@bb-studio/kit/app";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { ThreadHandoffAction } from "./Handoff";
import { SpaceOverviewTab, SpaceThreadTab, THREAD_TAB, ThreadSpaceOverview } from "./Overview";
import { SPACES_PANEL } from "./routes";
import { SidebarSpacesSection } from "./SidebarSpacesSection";
import { SpacePageTab, SpacesPanel } from "./SpaceView";
import { SPACE_PAGE_ACTION, ThreadSpacePage } from "./ThreadSpacePage";

export function registerSpaces(app: PluginAppBuilder): void {
  app.slots.navPanel({
    id: SPACES_PANEL,
    title: "Spaces",
    icon: "Folder",
    path: SPACES_PANEL,
    component: retainPanel(SPACES_PANEL, SpacesPanel),
    fixedTabs: [
      { panelId: SPACES_PANEL, id: "overview", title: "Overview", icon: "Folder", component: SpaceOverviewTab, layout: "flush" },
      { panelId: SPACES_PANEL, id: "page", title: "Page", icon: "FileText", component: SpacePageTab, layout: "flush" },
      { ...THREAD_TAB, title: "Thread", icon: "MessageSquare", component: SpaceThreadTab, layout: "flush" },
    ],
  });
  // Every thread in a Space gets the Space's page beside it, opened once by itself (from the header action).
  app.slots.threadPanelAction({ id: SPACE_PAGE_ACTION, title: "Space page", icon: "FileText", layout: "flush", component: ThreadSpacePage });
  app.slots.threadPanelAction({ id: "space-overview", title: "Space overview", icon: "Folder", layout: "flush", component: ThreadSpaceOverview });
  // Move a thread (or a Space's lead) to another provider or model.
  app.slots.experimental_threadHeaderAction({ id: "handoff", title: "Hand off", component: ThreadHandoffAction });
  app.slots.experimental_appOverlay({ id: "sidebar-spaces", component: SidebarSpacesSection });
}
