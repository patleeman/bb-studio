// bb-studio-code — frontend entry.
//
// Surfaces:
//   - navPanel "Workspaces" (Code's own page, not Studio content): opens the
//     last used VS Code workspace (making one for a project if there is
//     none), and the editor full-page at workspaces/<id>, with a workspace
//     switcher in the title bar.
//   - threadPanelAction "VS Code": the workbench tab beside a conversation,
//     open to the thread's own worktree, or the workspace a card names.
//   - messageDirective `::workspace{id="cws_…"}`: a card in a reply that
//     opens the workspace in the workbench.
//   - experimental_threadHeaderAction: a "VS Code" chip in the thread header
//     once the thread has a workspace or has edited files.
//   - fileOpener "VS Code": BB's file preview with an "Open in VS Code" bar.
import { useLayoutEffect } from "react";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { RetainedPanels, retainPanel, StudioBarSlot } from "@bb-studio/kit/app";
import { WorkspaceCard } from "./src/card";
import { CodePanel, RecentWorkspace, panelRoute } from "./src/panel";
import { leaveStudioWorkspace } from "./src/own-page";
import { CODE_ICON, CODE_TAB, PANEL_PATH } from "./src/shared";
import { ThreadCodePanel } from "./src/thread-tab";
import { ThreadCodeChip } from "./src/thread-chip";
import { CODE_EXTENSIONS, VsCodeFileOpener } from "./src/file-opener";

const RetainedCodePanel = retainPanel(PANEL_PATH, CodePanel);

/** The root isn't retained: each visit finds the latest workspace again. */
function CodeNavPanel({ subPath }: { subPath: string }) {
  return panelRoute(subPath).kind === "root" ? <RecentWorkspace /> : <RetainedCodePanel subPath={subPath} />;
}

/** Open editors stay alive across route changes, on Code's page rather than in Studio's tabs. */
function RetainedCode() {
  // Runs after RetainedPanels registered the panel with Studio's workspace.
  useLayoutEffect(() => { leaveStudioWorkspace(); }, []);
  return <RetainedPanels path={PANEL_PATH} render={(subPath) => <CodePanel subPath={subPath} />} />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "workspaces",
    title: "Workspaces",
    icon: CODE_ICON,
    path: PANEL_PATH,
    component: CodeNavPanel,
    headerContent: StudioBarSlot,
  });
  // Keeps open editors alive across route changes (with retainPanel), so
  // VS Code doesn't reload every time the user looks at something else.
  app.slots.experimental_appOverlay({ id: "retained", component: RetainedCode });
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
  app.slots.fileOpener({ id: "vscode", title: "VS Code", extensions: CODE_EXTENSIONS, component: VsCodeFileOpener });
  app.slots.experimental_threadHeaderAction({ id: "code-chip", title: "VS Code", component: ThreadCodeChip });
});
