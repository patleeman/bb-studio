// Registers Spaces. A Space opens on its lead's thread page; its status,
// threads, items and page are thread panel tabs beside the lead, listed in the
// workbench's New tab menu. Also the Spaces sidebar section, and the Space
// page beside every Space thread.
import { retainPanel } from "@bb-studio/kit/app";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { ThreadSpaceOverview } from "./Overview";
import { SPACES_PANEL } from "./routes";
import { SidebarSpacesSection } from "./SidebarSpacesSection";
import { SpaceItemTab, SpaceThreadTab } from "./SpaceTabs";
import { SpaceLeadHeader, SpacesHeader, SpacesPanel } from "./SpaceView";
import { SPACE_ITEM_ACTION, SPACE_STATUS_ACTION, SPACE_THREAD_ACTION, newDraftId } from "./tabs";
import { OpenSpacePage, SPACE_PAGE_ACTION, ThreadSpacePage } from "./ThreadSpacePage";

export function registerSpaces(app: PluginAppBuilder): void {
  app.slots.navPanel({ id: SPACES_PANEL, title: "Spaces", icon: "Folder", path: SPACES_PANEL, component: retainPanel(SPACES_PANEL, SpacesPanel), headerContent: SpacesHeader });
  app.slots.threadPanelAction({ id: SPACE_STATUS_ACTION, title: "Space status", icon: "Activity", layout: "flush", component: ThreadSpaceOverview });
  app.slots.threadPanelAction({ id: SPACE_PAGE_ACTION, title: "Space page", icon: "FileText", layout: "flush", component: ThreadSpacePage });
  app.slots.threadPanelAction({ id: SPACE_THREAD_ACTION, title: "Space thread", icon: "MessageSquare", layout: "flush", component: SpaceThreadTab });
  // Each pick opens its own tab, which becomes the item made in it.
  app.slots.threadPanelAction({
    id: SPACE_ITEM_ACTION,
    title: "New in Space",
    // Also the icon of every item tab it opens.
    icon: "FileText",
    layout: "flush",
    component: SpaceItemTab,
    run: (context) => { context.openPanel({ title: "New in Space", params: { draft: newDraftId() } }); },
  });
  // Opens the Space's status beside its lead, and its page beside other threads.
  app.slots.experimental_threadHeaderAction({ id: "space-page-opener", title: "Space page", component: OpenSpacePage });
  app.slots.experimental_threadHeaderAction({ id: "space-lead", title: "Space", component: SpaceLeadHeader });
  app.slots.experimental_appOverlay({ id: "sidebar-spaces", component: SidebarSpacesSection });
}
