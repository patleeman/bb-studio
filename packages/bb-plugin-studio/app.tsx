// bb-plugin-studio frontend: the Studio collection, one nav panel whose
// sub-path filters it to a kind, the sidebar's Studio tabs, and Studio search.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { QuickOpen, toggleQuickOpen } from "./src/ui/QuickOpen";
import { SidebarTabs } from "./src/ui/SidebarTabs";
import { StudioPanel } from "./src/ui/StudioPanel";

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "studio", title: "Studio", icon: "studio/studio", path: "studio", component: StudioPanel });
  // Renders nothing itself; portals the tabs section into the Studio Sidebar.
  app.slots.experimental_appOverlay({ id: "sidebar-tabs", component: SidebarTabs });
  app.slots.experimental_appOverlay({ id: "quick-open", component: QuickOpen });
  app.commands.register({
    id: "search",
    title: "Studio: Search items",
    defaultShortcut: { key: "k", mod: true, shift: true },
    run: toggleQuickOpen,
  });
});
