import { ChatOverlay } from "./src/chat/ui/ChatOverlay";
import { ItemGestures } from "./src/ui/ItemGestures";
import { ConversationPage } from "./src/chat/ui/ConversationComposer";
import { CommandPage } from "./src/command/command-view";
// bb-studio frontend: the Studio collection, one nav panel whose
// sub-path filters it to a kind, the sidebar's Studio tabs and Spaces, the
// Space dialogs other plugins open by window event, each thread's space
// in its header, and Studio search.
import { RetainedPanels, retainPanel, StudioBarSlot } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ManageSpace } from "./src/ui/ManageSpace";
import { NewSpace } from "./src/ui/NewSpace";
import { QuickOpen, toggleQuickOpen } from "./src/ui/QuickOpen";
import { SidebarTabs } from "./src/ui/SidebarTabs";
import { StudioPanel } from "./src/ui/StudioPanel";
import { ComposerSpaces } from "./src/ui/ComposerSpaces";
import { publishCommandDraft } from "./src/command/draft-recipients";
import { ThreadSpaceLink } from "./src/ui/ThreadSpaceLink";
import { ActivityPanel } from "./src/ui/HomePanel";
import { SidebarSpacesSection } from "./src/ui/space/SidebarSpacesSection";
import { HealthFooter, HealthWatch, SETUP_SUBPATH, setHealthFooter, SetupPage } from "./src/ui/health/HealthViews";

function StudioRoot({ subPath }: { subPath: string }) {
  const path = subPath.replace(/^\/+|\/+$/g, "");
  if (path.startsWith("command/")) return <CommandPage subPath={path.slice("command/".length)} />;
  if (path === SETUP_SUBPATH) return <SetupPage />;
  // "collection" is the old address of the landing page.
  return path === "activity" ? <ActivityPanel /> : <StudioPanel subPath={path} />;
}

export default definePluginApp((app) => {
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
  // The Space Command view's "To" follows the mentions in its draft.
  app.composer.customize({ id: "command-recipients", scopes: ["new-thread"], richText: { onDraftChange: publishCommandDraft } });
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
