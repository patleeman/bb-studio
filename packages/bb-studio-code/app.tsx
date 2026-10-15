// bb-studio-code — frontend entry. VS Code is the editor: one per thread.
//
// Surfaces:
//   - threadPanelAction "VS Code": the workbench tab beside a conversation,
//     open to the thread's own worktree.
//   - experimental_threadHeaderAction: a "VS Code" chip in the thread header
//     once the thread has a workspace or has edited files.
//   - fileOpener "VS Code": a code file opens in the thread's VS Code tab, at
//     its lines; BB's preview stays one click away.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { CODE_ICON, CODE_TAB } from "./src/shared";
import { ThreadCodePanel } from "./src/thread-tab";
import { ThreadCodeChip } from "./src/thread-chip";
import { CODE_EXTENSIONS, VsCodeFileOpener } from "./src/file-opener";

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: CODE_TAB,
    title: "VS Code",
    icon: CODE_ICON,
    layout: "flush",
    component: ThreadCodePanel,
  });
  app.slots.fileOpener({ id: "vscode", title: "VS Code", extensions: CODE_EXTENSIONS, component: VsCodeFileOpener });
  app.slots.experimental_threadHeaderAction({ id: "code-chip", title: "VS Code", component: ThreadCodeChip });
});
