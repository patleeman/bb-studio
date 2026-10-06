// `::workspace{id="cws_…"}` in a reply: a card that opens the workspace in
// the thread's workbench, beside the chat.
import { useCallback, useEffect, useState } from "react";
import { ItemDirectiveCard, remember } from "@bb-studio/kit/app";
import { relativeTime } from "@bb-studio/kit/format";
import { useBbNavigate, useRealtime, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { CHANNEL, CODE_ICON, CODE_TAB, PANEL_PATH, isWorkspaceId, type CodeContract, type Workspace } from "./shared";

function useWorkspace(id: string): Workspace | null | undefined {
  const rpc = useRpc<CodeContract>();
  const [workspace, setWorkspace] = useState<Workspace | null | undefined>(undefined);
  const load = useCallback(() => {
    if (!id) return;
    rpc.call("get", { id }).then(({ workspace }) => setWorkspace(workspace), () => setWorkspace(null));
  }, [rpc, id]);
  useEffect(load, [load]);
  useRealtime(CHANNEL, (event) => {
    if ((event as { id?: string } | null)?.id === id) load();
  });
  return workspace;
}

export function WorkspaceCard({ attributes }: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const id = attributes.id ?? "";
  const valid = isWorkspaceId(id);
  const workspace = remember(`workspace:${id}`, useWorkspace(valid ? id : ""));
  if (!valid || workspace === null) return <ItemDirectiveCard state="deleted" kind="workspace" icon={CODE_ICON} />;
  if (!workspace) return <ItemDirectiveCard state="loading" kind="workspace" icon={CODE_ICON} />;
  const title = workspace.title.trim() || "Untitled workspace";
  const folders = workspace.folders.length === 1 ? "1 folder" : `${workspace.folders.length} folders`;
  return (
    <ItemDirectiveCard
      state="ready"
      kind="workspace"
      icon={CODE_ICON}
      title={title}
      details={`${workspace.threadId ? "Thread worktree" : "VS Code workspace"} · ${folders} · ${relativeTime(workspace.updatedAt)}`}
      preview={<span className="font-mono text-xs">{workspace.folders.join(" · ")}</span>}
      onOpen={() => {
        // The workbench when there is one; the main area otherwise.
        if (!navigate.openThreadPanel({ actionId: CODE_TAB, title, params: { workspaceId: id } }))
          navigate.toPluginPanel(PANEL_PATH, { subPath: id });
      }}
    />
  );
}
