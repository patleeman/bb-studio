// VS Code for where you are, for the launcher's VS Code row
// (src/launcher/items.ts asks BB's main window for VSCODE_MAIN_PATH): beside
// the thread in view, on its folder; with no thread (or none VS Code can
// open), VS Code's nav panel, on the workspace used last, else its picker.
import { codeTabFor, post } from "./file-opener";
import { WORKSPACES_PATH } from "./page-title";
import type { Workspace } from "./shared";
import { routeContainer } from "../kit/app/container";
import { requestThreadTab, type ThreadTabOpen } from "../kit/app/thread-panel";
import { openFrom } from "../ui/studio-open";

export interface OpenVsCodeDeps {
  /** The thread in BB's main view, or null. */
  threadId: string | null;
  call(method: "code.forThread", input: unknown): Promise<unknown>;
  /** Asks the thread for its VS Code tab; false when it declined. */
  openTab(threadId: string, open: ThreadTabOpen): Promise<boolean>;
  /** Shows a Studio path in the main view. */
  show(href: string): void;
}

/** Answers where it opened VS Code: beside the thread, or in its own panel. */
export async function openVsCode({ threadId, call, openTab, show }: OpenVsCodeDeps): Promise<"thread" | "panel"> {
  if (threadId) {
    try {
      const { workspace } = await call("code.forThread", { threadId }) as { workspace: Workspace };
      if (await openTab(threadId, codeTabFor(workspace))) return "thread";
    } catch { /* a thread with no folder on this machine: the panel instead */ }
  }
  show(WORKSPACES_PATH);
  return "panel";
}

export async function runVsCode(): Promise<void> {
  const container = routeContainer();
  await openVsCode({
    threadId: container?.kind === "thread" ? container.threadId : null,
    call: post,
    openTab: requestThreadTab,
    show: (href) => openFrom(null, { href, title: "VS Code" }, { target: "main" }, { toThread: () => {}, openUrl: () => false }),
  });
}
