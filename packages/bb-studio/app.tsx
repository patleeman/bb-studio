// bb-studio frontend: the Studio collection, one nav panel whose
// sub-path filters it to a kind or opens a space, the sidebar's Studio tabs
// (spaces among them), each thread's spaces in its header, and Studio search.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ManageSpace } from "./src/ui/ManageSpace";
import { NewSpace } from "./src/ui/NewSpace";
import { QuickOpen, toggleQuickOpen } from "./src/ui/QuickOpen";
import { SidebarTabs } from "./src/ui/SidebarTabs";
import { StudioPanel } from "./src/ui/StudioPanel";
import { ThreadSpaces } from "./src/ui/ThreadSpaces";
import { ActivityPanel } from "./src/ui/HomePanel";

function StudioRoot({ subPath }: { subPath: string }) {
  const path = subPath.replace(/^\/+|\/+$/g, "");
  // "collection" is the old address of the landing page.
  return path === "activity" ? <ActivityPanel /> : <StudioPanel subPath={path === "collection" ? "" : path} />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "studio", title: "Studio", icon: "studio/studio", path: "studio", component: StudioRoot });
  // Renders nothing itself; portals the tabs section into the Studio Sidebar.
  app.slots.experimental_appOverlay({ id: "sidebar-tabs", component: SidebarTabs });
  app.slots.experimental_appOverlay({ id: "new-space", component: NewSpace });
  app.slots.experimental_appOverlay({ id: "manage-space", component: ManageSpace });
  app.slots.experimental_appOverlay({ id: "quick-open", component: QuickOpen });
  // Links a thread, channel or direct message back to its spaces.
  app.slots.experimental_threadHeaderAction({ id: "thread-spaces", title: "Spaces", component: ThreadSpaces });
  app.commands.register({
    id: "search",
    title: "Studio: Search everything",
    defaultShortcut: { key: "k", mod: true, shift: true },
    run: toggleQuickOpen,
  });
});
