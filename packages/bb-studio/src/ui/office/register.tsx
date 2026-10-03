// Registers the office UI: its panel, the approval card for bots that ask
// first, and the sidebar (navigation on top, Team/Favorites/Folders below),
// which replaces the Studio Sidebar and Studio Navigation modules.
import { retainPanel } from "@bb-studio/kit/app";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { OfficeNavigation } from "./OfficeNavigation";
import { OfficePanel } from "./OfficePanel";
import { OfficeSidebar } from "./OfficeSidebar";
import { OFFICE_PANEL_PATH } from "./routes";
import { TrustRequest } from "./TrustRequest";

/**
 * `sidebar` and `navigation` are gated builders (modules/app.ts moduleApp):
 * while the legacy Studio Sidebar or Studio Navigation plugin is still
 * enabled, it keeps its slot and the office's stays quiet.
 */
export function registerOfficeApp(app: PluginAppBuilder, options: { sidebar: PluginAppBuilder | null; navigation: PluginAppBuilder | null }): void {
  app.slots.navPanel({ id: "office", title: "studio/home", icon: "studio/home", path: OFFICE_PANEL_PATH, component: retainPanel("office", OfficePanel) });
  // Approvals for bots set to "Ask first" (office/trust.ts, origin rendererId office-trust).
  app.slots.pendingInteraction({ id: "office-trust", component: TrustRequest });
  options.navigation?.slots.experimental_sidebarNavigation({ id: "office-navigation", title: "Office", description: "Space switcher, Home, Inbox, Search and New thread.", component: OfficeNavigation });
  options.sidebar?.slots.experimental_threadList({ id: "office-sidebar", title: "Office", description: "Your team, favorites and folders for the current space.", component: OfficeSidebar });
}
