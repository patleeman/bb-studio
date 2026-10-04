// Registers the office UI. Until the sidebar and navigation modules are
// folded into core, `sidebar` stays off so the office's slots don't fight
// the installed Studio Sidebar and Studio Navigation plugins.
import { retainPanel } from "@bb-studio/kit/app";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { OfficeNavigation } from "./OfficeNavigation";
import { OfficePanel } from "./OfficePanel";
import { OfficeSidebar } from "./OfficeSidebar";
import { OFFICE_PANEL_PATH } from "./routes";

export function registerOfficeApp(app: PluginAppBuilder, options: { sidebar: boolean }): void {
  app.slots.navPanel({ id: "office", title: "Home", icon: "Home", path: OFFICE_PANEL_PATH, component: retainPanel("office", OfficePanel) });
  if (!options.sidebar) return;
  app.slots.experimental_sidebarNavigation({ id: "office-navigation", title: "Office", description: "Space switcher, Home, Inbox, Search and New thread.", component: OfficeNavigation });
  app.slots.experimental_threadList({ id: "office-sidebar", title: "Office", description: "Your team, favorites and folders for the current space.", component: OfficeSidebar });
}
