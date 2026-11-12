import type { CodeContract } from "./contract";
// VS Code beside a conversation, with no bar: the tab is VS Code alone.
//
// A tab opened with params (`{ environmentId }` or `{ projectId }`) is one
// folder's editor: a worktree's, or a project's. On a BB whose workbench has
// a Global section it stays open beside every thread, so the threads of one
// worktree share it. A tab opened without params is the thread's own: it
// shows the workspace of the thread's folder, and on such a BB hands over to
// that folder's tab.
import { useEffect, useState } from "react";
import { experimental_useAppPanel, useRpc, type ExperimentalPanelController } from "@get-bb/plugin-sdk/app";
import { BAR_BUTTON } from "../kit/app/index";
import { errorMessage } from "../kit/format";
import { openThreadTab, type ThreadTabProps } from "../kit/app/thread-panel";
import { codeTabFor } from "./file-opener";
import { WorkspaceView } from "./panel";
import { CODE_TAB, folderKey, parseCodeTabParams, type CodeTabParams, type Workspace } from "./shared";

/**
 * Hands the thread's own tab over to its folder's tab, where BB keeps those
 * open across threads: opens that one and closes this one. False when this
 * tab should show the editor itself (a BB without Global tabs, a workspace
 * with no folder identity, or a tab that isn't in front).
 */
export function moveToFolderTab(panel: Pick<ExperimentalPanelController, "openTab" | "getTabs" | "closeTab">, workspace: Pick<Workspace, "folderKey" | "title">, global?: boolean): boolean {
  const tab = codeTabFor(workspace, global);
  if (!tab.global) return false;
  try {
    const tabs = panel.getTabs();
    const own = tabs.tabs.find((each) => each.key === tabs.selectedKey);
    if (!own || own.detail.kind !== "plugin" || own.detail.tab.id !== CODE_TAB || own.detail.params !== null) return false;
    if (!openThreadTab(panel, tab)) return false;
    panel.closeTab(own.key);
    return true;
  } catch {
    return false;
  }
}

export function ThreadCodePanel({ threadId, params }: ThreadTabProps) {
  const folder = parseCodeTabParams(params);
  return <CodePanel key={folder ? folderKey(folder) : `thread:${threadId}`} threadId={threadId} folder={folder} />;
}

function CodePanel({ threadId, folder }: { threadId: string; folder: CodeTabParams | null }) {
  const rpc = useRpc<CodeContract>();
  const panel = experimental_useAppPanel();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    (folder ? rpc.call("code.forFolder", folder) : rpc.call("code.forThread", { threadId })).then(
      ({ workspace }) => {
        if (!live) return;
        if (!folder && moveToFolderTab(panel, workspace)) return;
        setWorkspaceId(workspace.id);
      },
      (cause) => { if (live) setError(errorMessage(cause)); },
    );
    return () => { live = false; };
    // A folder's tab keeps its editor as the thread beside it changes.
  }, [rpc, panel, folder ? null : threadId, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Review comments and questions from this editor go to the thread beside it.
  useEffect(() => {
    if (workspaceId && threadId) rpc.call("code.viewedFrom", { id: workspaceId, threadId }).catch(() => undefined);
  }, [rpc, workspaceId, threadId]);

  if (workspaceId) return <WorkspaceView key={workspaceId} id={workspaceId} />;
  if (error)
    return (
      <div className="flex flex-col items-start gap-2 p-4 text-sm text-muted-foreground">
        <p role="alert">{error}</p>
        <button type="button" className={BAR_BUTTON} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  return <p role="status" className="p-4 text-sm text-muted-foreground">{folder ? "Opening this folder…" : "Opening this thread's worktree…"}</p>;
}
