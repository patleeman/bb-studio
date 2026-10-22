// Studio Code — frontend entry. VS Code is the editor: one per thread.
//
// Surfaces:
//   - threadPanelAction "VS Code": the workbench tab beside a conversation,
//     open to the thread's own worktree.
//   - fileOpener "VS Code": a code file opens in the thread's VS Code tab, at
//     its lines; BB's preview stays one click away.
import type { definePluginApp } from "@get-bb/plugin-sdk/app";
import { CODE_ICON, CODE_TAB } from "./shared";
import { ThreadCodePanel } from "./thread-tab";
import { CODE_EXTENSIONS, VsCodeFileOpener } from "./file-opener";

export function registerCodeApp(app: Parameters<Parameters<typeof definePluginApp>[0]>[0]) {
  app.slots.threadPanelAction({
    id: CODE_TAB,
    title: "VS Code",
    icon: CODE_ICON,
    layout: "flush",
    component: ThreadCodePanel,
  });
  app.slots.fileOpener({ id: "vscode", title: "VS Code", extensions: CODE_EXTENSIONS, component: VsCodeFileOpener });
}
