// bb-studio-code — frontend entry.
//
// Surfaces:
//   - navPanel "Workspaces": Studio's collection of VS Code workspaces, and
//     the editor at workspaces/<id>. With Studio installed, Studio's page
//     takes over the collection.
//   - threadPanelAction "VS Code": the workbench tab beside a conversation,
//     open to the thread's own worktree, or the workspace a card names.
//   - messageDirective `::workspace{id="cws_…"}`: a card in a reply that
//     opens the workspace in the workbench.
//   - experimental_threadHeaderAction: a "VS Code" chip in the thread header
//     once the thread has a workspace or has edited files.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { RetainedPanels, retainPanel, StudioBarSlot } from "@bb-studio/kit/app";
import { WorkspaceCard } from "./src/card";
import { CodePanel } from "./src/panel";
import { CODE_ICON, CODE_TAB, PANEL_PATH } from "./src/shared";
import { ThreadCodePanel } from "./src/thread-tab";
import { ThreadCodeChip } from "./src/thread-chip";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "workspaces",
    title: "Workspaces",
    icon: CODE_ICON,
    path: PANEL_PATH,
    component: retainPanel(PANEL_PATH, CodePanel),
    headerContent: StudioBarSlot,
  });
  // Keeps open editors alive across route changes (with retainPanel), so
  // VS Code doesn't reload every time the user looks at something else.
  app.slots.experimental_appOverlay({ id: "retained", component: () => <RetainedPanels path={PANEL_PATH} render={(subPath) => <CodePanel subPath={subPath} />} /> });
  app.slots.threadPanelAction({
    id: CODE_TAB,
    title: "VS Code",
    icon: CODE_ICON,
    layout: "flush",
    component: ThreadCodePanel,
  });
  app.slots.messageDirective({ id: "workspace", component: WorkspaceCard });
  // A quiet "VS Code" chip in a thread's header once it has a workspace or
  // has edited files: one click to the exact workspace.
  app.slots.experimental_threadHeaderAction({ id: "code-chip", title: "VS Code", component: ThreadCodeChip });
});
