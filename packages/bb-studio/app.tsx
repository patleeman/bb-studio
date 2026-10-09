import { useEffect } from "react";
import { StudioWorkspace, WorkspaceBridge } from "./src/ui/Workspace";
import { ChatOverlay } from "./src/chat/ui/ChatOverlay";
import { ItemGestures } from "./src/ui/ItemGestures";
import { ConversationPage } from "./src/chat/ui/ConversationComposer";
import { CommandPage } from "./src/command/command-view";
// bb-studio frontend: the Studio collection, one nav panel whose
// sub-path filters it to a kind, the sidebar's Studio tabs and Spaces, the
// Space dialogs other plugins open by window event, each thread's space
// in its header, and Studio search.
import { openAppPath, RetainedPanels, retainPanel, StudioBarSlot, usePathname, WORKSPACE_PATH } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ManageSpace } from "./src/ui/ManageSpace";
import { NewSpace } from "./src/ui/NewSpace";
import { QuickOpen, toggleQuickOpen } from "./src/ui/QuickOpen";
import { SidebarTabs } from "./src/ui/SidebarTabs";
import { openCollection, StudioPanel } from "./src/ui/StudioPanel";
import { ComposerSpaces } from "./src/ui/ComposerSpaces";
import { ThreadSpaceLink } from "./src/ui/ThreadSpaceLink";
import { ActivityPanel } from "./src/ui/HomePanel";
import { SidebarSpacesSection } from "./src/ui/space/SidebarSpacesSection";
import { HealthFooter, HealthWatch, SETUP_SUBPATH, setHealthFooter } from "./src/ui/health/HealthViews";
import { SetupPage } from "./src/ui/setup/SetupPage";

/**
 * An old address that showed the item list (`collection`, a kind such as
 * `page`) or the workspace: the workspace, with the list as a new tab
 * except for `workspace`. Retained, so it checks each time it's shown. In a
 * pane of its own, such as a restored BB split, it offers the move instead.
 */
function ToWorkspace({ path }: { path: string }) {
  const pathname = usePathname();
  const go = (replace: boolean) => {
    if (path !== "workspace") openCollection(path === "collection" ? null : decodeSegment(path));
    openAppPath(WORKSPACE_PATH, { standalone: true, replace });
  };
  // Either side may be percent-encoded; compare them decoded.
  const here = decodeSegment(pathname.replace(/\/+$/, "")) === decodeSegment(`${WORKSPACE_PATH}/${path}`);
  useEffect(() => { if (here) go(true); }, [here]); // eslint-disable-line react-hooks/exhaustive-deps
  if (here) return null;
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
    <p>Studio's item list now opens as a new tab in Studio.</p>
    <button type="button" className="rounded-md border px-3 py-1.5 text-foreground hover:bg-state-hover" onClick={() => go(false)}>Open in Studio</button>
  </div>;
}

/** A path segment, or "" for a malformed one like `100%`. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

function StudioRoot({ subPath }: { subPath: string }) {
  const path = subPath.replace(/^\/+|\/+$/g, "");
  // Studio opens on its tabbed workspace; the item list is only its new tab page.
  if (path === "") return <StudioWorkspace />;
  if (path === "browse") return <StudioPanel />;
  if (path.startsWith("command/")) return <CommandPage subPath={path.slice("command/".length)} />;
  if (path === SETUP_SUBPATH) return <SetupPage />;
  if (path === "activity") return <ActivityPanel />;
  return <ToWorkspace path={path} />;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "workspace-bridge", component: WorkspaceBridge });
  app.slots.experimental_appOverlay({ id: "chat", component: ChatOverlay });
  // Right-click and Mod-click on Studio items and threads anywhere on screen.
  app.slots.experimental_appOverlay({ id: "item-gestures", component: ItemGestures });
  app.slots.navPanel({ id: "chats", path: "chats", title: "Chat", icon: "MessageSquare", component: retainPanel("chats", ConversationPage), headerContent: StudioBarSlot });
  app.slots.experimental_appOverlay({ id: "retained-chats", component: () => <RetainedPanels path="chats" render={subPath => <ConversationPage subPath={subPath} />} /> });
  app.slots.navPanel({ id: "studio", title: "Studio", icon: "studio/studio", path: "studio", component: retainPanel("studio", StudioRoot), headerContent: StudioBarSlot });
  // Keeps the panel's views alive across route changes (with retainPanel).
  app.slots.experimental_appOverlay({ id: "retained", component: () => <RetainedPanels path="studio" render={(subPath) => <StudioRoot subPath={subPath} />} /> });
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
  // Plugin health: a footer item that opens itself when a plugin needs setup or breaks.
  setHealthFooter(app.experimental_sidebarFooter.register({ kind: "disclosure", id: "health", label: "Plugin health", icon: "ElectricPlugs", component: HealthFooter }));
  app.slots.experimental_appOverlay({ id: "health-watch", component: HealthWatch });
  app.commands.register({
    id: "search",
    title: "Studio: Search everything",
    defaultShortcut: { key: "k", mod: true, shift: true },
    run: toggleQuickOpen,
  });
});
