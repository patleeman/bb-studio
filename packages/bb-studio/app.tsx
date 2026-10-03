// bb-studio frontend: the Studio collection, one nav panel whose
// sub-path filters it to a kind or opens a space, the sidebar's Studio tabs
// (spaces among them), each thread's spaces under its composer, and Studio
// search.
import { FloatPanels, retainPanel } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ManageSpace } from "./src/ui/ManageSpace";
import { NewSpace } from "./src/ui/NewSpace";
import { QuickOpen, toggleQuickOpen } from "./src/ui/QuickOpen";
import { SidebarTabs } from "./src/ui/SidebarTabs";
import { StudioPanel } from "./src/ui/StudioPanel";
import { ComposerSpaces } from "./src/ui/ComposerSpaces";
import { ComposerTrim } from "./src/ui/ComposerTrim";
import { ActivityPanel } from "./src/ui/HomePanel";
import { registerOfficeApp } from "./src/ui/office/register";

function StudioRoot({ subPath }: { subPath: string }) {
  const path = subPath.replace(/^\/+|\/+$/g, "");
  // "collection" is the old address of the landing page.
  return path === "activity" ? <ActivityPanel /> : <StudioPanel subPath={path} />;
}

export default definePluginApp((app) => {
  // The office (docs/office-model.md). The sidebar slots switch on once the
  // Sidebar and Navigation modules are folded into core.
  registerOfficeApp(app, { sidebar: false });
  app.slots.navPanel({ id: "studio", title: "Studio", icon: "studio/studio", path: "studio", component: retainPanel("studio", StudioRoot) });
  // Shows the panel in Float windows open on its paths.
  app.slots.experimental_appOverlay({ id: "float", component: () => <FloatPanels path="studio" render={(subPath) => <StudioRoot subPath={subPath} />} /> });
  // Renders nothing itself; portals the tabs section into the Studio Sidebar.
  app.slots.experimental_appOverlay({ id: "sidebar-tabs", component: SidebarTabs });
  app.slots.experimental_appOverlay({ id: "new-space", component: NewSpace });
  app.slots.experimental_appOverlay({ id: "manage-space", component: ManageSpace });
  app.slots.experimental_appOverlay({ id: "quick-open", component: QuickOpen });
  // Links a thread, channel or direct message back to its spaces, and picks
  // the spaces a new thread joins.
  // Collapses the row under the composer into a ⋯ menu.
  app.composer.customize({ id: "thread-spaces", scopes: ["thread", "new-thread"], actions: [{ id: "spaces", component: ComposerSpaces }] });
  app.composer.customize({ id: "composer-trim", scopes: ["thread"], actions: [{ id: "trim", component: ComposerTrim }] });
  app.commands.register({
    id: "search",
    title: "Studio: Search everything",
    defaultShortcut: { key: "k", mod: true, shift: true },
    run: toggleQuickOpen,
  });
});
