// Registers the work UI (the model on page pg_7fe6aafc7a1c7c05): BB's own
// navigation with Studio's places only, a sidebar of Projects and Threads,
// the Projects panel (a project's lead in the middle, its page and threads
// as fixed workbench tabs), and the Inbox.
import { retainPanel } from "@bb-studio/kit/app";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { Inbox } from "./Inbox";
import { TrustRequest } from "./TrustRequest";
import { Navigation } from "./Navigation";
import { ProjectOverviewTab, ProjectThreadTab, THREAD_TAB, ThreadProjectOverview } from "./Overview";
import { ProjectPageTab, ProjectPanel } from "./ProjectPanel";
import { PROJECTS_PANEL } from "./routes";
import { Sidebar } from "./Sidebar";
import { ThreadHandoffAction } from "./Handoff";
import { PROJECT_PAGE_ACTION, ThreadProjectPage } from "./ThreadProjectPage";

/**
 * `sidebar` and `navigation` are gated builders (modules/app.ts moduleApp):
 * while the legacy Studio Sidebar or Studio Navigation plugin is enabled, it
 * keeps its slot and this one stays quiet.
 */
export function registerWork(app: PluginAppBuilder, options: { sidebar: PluginAppBuilder | null; navigation: PluginAppBuilder | null }): void {
  app.slots.navPanel({
    id: PROJECTS_PANEL,
    title: "Projects",
    icon: "Folder",
    path: PROJECTS_PANEL,
    component: retainPanel(PROJECTS_PANEL, ProjectPanel),
    // The workbench beside a project: what's going on, its page (the real
    // Pages editor), and whichever thread you opened from the overview.
    fixedTabs: [
      { panelId: PROJECTS_PANEL, id: "overview", title: "Overview", icon: "Folder", component: ProjectOverviewTab, layout: "flush" },
      { panelId: PROJECTS_PANEL, id: "page", title: "Page", icon: "FileText", component: ProjectPageTab, layout: "flush" },
      { ...THREAD_TAB, title: "Thread", icon: "MessageSquare", component: ProjectThreadTab, layout: "flush" },
    ],
  });
  app.slots.navPanel({ id: "office-inbox", title: "Inbox", icon: "studio/inbox", path: "office-inbox", component: retainPanel("office-inbox", Inbox) });
  // Every thread of a project gets the project's page beside it, opened once by itself.
  app.slots.threadPanelAction({ id: PROJECT_PAGE_ACTION, title: "Project page", icon: "FileText", layout: "flush", component: ThreadProjectPage });
  app.slots.threadPanelAction({ id: "project-overview", title: "Project overview", icon: "Folder", layout: "flush", component: ThreadProjectOverview });
  // Move a thread (or a project's lead) to another provider or model; also opens the project page beside project threads.
  app.slots.experimental_threadHeaderAction({ id: "handoff", title: "Hand off", component: ThreadHandoffAction });
  // Approvals for agents set to "Ask first" (office/trust.ts, rendererId office-trust).
  app.slots.pendingInteraction({ id: "office-trust", component: TrustRequest });
  options.navigation?.slots.experimental_sidebarNavigation({ id: "work-navigation", title: "Studio", description: "BB's navigation, with Studio's Inbox, Projects and Library.", component: Navigation });
  options.sidebar?.slots.experimental_threadList({ id: "work-sidebar", title: "Projects and threads", description: "Your projects, then your one-off threads.", component: Sidebar });
}
