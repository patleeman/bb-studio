// Registers the office UI: its panel, the approval card for bots that ask
// first, and the sidebar (address bar and Essentials on top, Pinned and Today
// tabs below), which replaces the Studio Sidebar and Studio Navigation modules.
import { retainPanel } from "@bb-studio/kit/app";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { openCommandBar } from "./CommandBar";
import { OfficePanel } from "./OfficePanel";
import { OfficeTabs, reopenClosedTab } from "./OfficeTabs";
import { OfficeTop } from "./OfficeTop";
import { OFFICE_PANELS, OFFICE_PANEL_PATH } from "./routes";
import { TrustRequest } from "./TrustRequest";

/**
 * `sidebar` and `navigation` are gated builders (modules/app.ts moduleApp):
 * while the legacy Studio Sidebar or Studio Navigation plugin is still
 * enabled, it keeps its slot and the office's stays quiet.
 */
export function registerOfficeApp(app: PluginAppBuilder, options: { sidebar: PluginAppBuilder | null; navigation: PluginAppBuilder | null }): void {
  app.slots.navPanel({ id: "office", title: "Home", icon: "studio/home", path: OFFICE_PANEL_PATH, component: retainPanel("office", OfficePanel) });
  for (const [head, panel] of Object.entries(OFFICE_PANELS)) {
    const Panel = ({ subPath }: { subPath: string }) => <OfficePanel subPath={subPath ? `${head}/${subPath}` : head} />;
    app.slots.navPanel({ id: panel.path, title: panel.title, icon: panel.icon, path: panel.path, component: retainPanel(panel.path, Panel) });
  }
  // Approvals for bots set to "Ask first" (office/trust.ts, origin rendererId office-trust).
  app.slots.pendingInteraction({ id: "office-trust", component: TrustRequest });
  // The Arc-style sidebar (docs/office-tabs.md).
  options.navigation?.slots.experimental_sidebarNavigation({ id: "office-navigation", title: "Office", description: "Address bar and Essentials.", component: OfficeTop });
  options.sidebar?.slots.experimental_threadList({ id: "office-sidebar", title: "Office", description: "Pinned and Today tabs for the current space.", component: OfficeTabs });
  if (options.navigation) {
    app.commands.register({ id: "office-open", title: "Search or open", defaultShortcut: { key: "t", mod: true }, run: () => openCommandBar() });
    app.commands.register({ id: "office-reopen", title: "Reopen closed tab", defaultShortcut: { key: "t", mod: true, shift: true }, run: () => reopenClosedTab() });
  }
}
