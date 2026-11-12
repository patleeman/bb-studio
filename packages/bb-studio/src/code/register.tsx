// Studio Code — frontend entry. VS Code is the editor: one per worktree
// (or project folder), shared by the threads on it.
//
// Surfaces:
//   - thread tab "VS Code": the workbench tab beside a conversation, open to
//     the thread's worktree. Where BB's workbench has a Global section, it is
//     one tab per folder (params `{ environmentId }` or `{ projectId }`),
//     named for the folder and kept open across threads.
//   - fileOpener "VS Code": a code file opens in that tab, at its lines.
import type { definePluginApp } from "@get-bb/plugin-sdk/app";
import { CODE_ICON, CODE_TAB, codeTabIcon } from "./shared";
import { registerThreadTab } from "../kit/app/thread-panel";
import { newTabFields, newTabTitle } from "../tab-kinds";
import { ThreadCodePanel } from "./thread-tab";
import { CODE_EXTENSIONS, HANDLE_OPEN, VsCodeFileOpener } from "./file-opener";

/** A folder's tab draws a branch or a folder, where BB asks (`experimental_instanceIcon`); a BB without it ignores the field. */
const TAB_ICON: object = { experimental_instanceIcon: codeTabIcon };

export function registerCodeApp(app: Parameters<Parameters<typeof definePluginApp>[0]>[0]) {
  registerThreadTab(app, {
    id: CODE_TAB,
    title: newTabTitle(CODE_TAB) ?? "VS Code",
    // Under the New Tab page's "Open" heading (src/tab-kinds.ts).
    ...newTabFields(CODE_TAB),
    icon: CODE_ICON,
    layout: "flush",
    component: ThreadCodePanel,
    ...TAB_ICON,
  });
  app.slots.fileOpener({ id: "vscode", title: "VS Code", extensions: CODE_EXTENSIONS, component: VsCodeFileOpener, ...HANDLE_OPEN });
}
