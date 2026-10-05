import { CommandPage } from "./src/command/command-view";
// bb-studio frontend: the Studio collection, one nav panel whose
// sub-path filters it to a kind, the sidebar's Studio tabs and Spaces, the
// Space dialogs other plugins open by window event, each thread's space
// in its header, and Studio search.
import { FloatPanels, retainPanel, StudioBarSlot } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ManageSpace } from "./src/ui/ManageSpace";
import { NewSpace } from "./src/ui/NewSpace";
import { QuickOpen, toggleQuickOpen } from "./src/ui/QuickOpen";
import { SidebarTabs } from "./src/ui/SidebarTabs";
import { StudioPanel } from "./src/ui/StudioPanel";
import { ComposerSpaces } from "./src/ui/ComposerSpaces";
import { ThreadSpaceLink } from "./src/ui/ThreadSpaceLink";
import { ActivityPanel } from "./src/ui/HomePanel";
import { SidebarSpacesSection } from "./src/ui/space/SidebarSpacesSection";

function StudioRoot({ subPath }: { subPath: string }) {
  const path = subPath.replace(/^\/+|\/+$/g, "");
  if (path.startsWith("command/")) return <CommandPage subPath={path.slice("command/".length)} />;
  // "collection" is the old address of the landing page.
  return path === "activity" ? <ActivityPanel /> : <StudioPanel subPath={path} />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "studio", title: "Studio", icon: "studio/studio", path: "studio", component: retainPanel("studio", StudioRoot), headerContent: StudioBarSlot });
  // Shows the panel in Float windows open on its paths.
  app.slots.experimental_appOverlay({ id: "float", component: () => <FloatPanels path="studio" render={(subPath) => <StudioRoot subPath={subPath} />} /> });
  // Renders nothing itself; portals the tabs section into the Studio Sidebar.
  app.slots.experimental_appOverlay({ id: "sidebar-tabs", component: SidebarTabs });
  // Spaces: threads and Studio items, with an optional lead (docs/spaces.md).
  app.slots.experimental_appOverlay({ id: "sidebar-spaces", component: SidebarSpacesSection });
  app.slots.experimental_appOverlay({ id: "new-space", component: NewSpace });
  app.slots.experimental_appOverlay({ id: "manage-space", component: ManageSpace });
  app.slots.experimental_appOverlay({ id: "quick-open", component: QuickOpen });
  // Links a thread back to its space from its header, and picks the space a
  // new thread joins under its composer.
  app.slots.experimental_threadHeaderAction({ id: "space-link", title: "Space", component: ThreadSpaceLink });
  app.composer.customize({ id: "thread-spaces", scopes: ["new-thread"], actions: [{ id: "spaces", component: ComposerSpaces }] });
  app.commands.register({
    id: "search",
    title: "Studio: Search everything",
    defaultShortcut: { key: "k", mod: true, shift: true },
    run: toggleQuickOpen,
  });
});
