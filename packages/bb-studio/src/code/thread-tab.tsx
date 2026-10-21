import type { CodeContract } from "./contract";
// VS Code beside a conversation: the thread's own worktree, so the user sees
// the agent's changes. Each thread has one; the tab is VS Code alone, with no bar.
import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { BAR_BUTTON } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { WorkspaceView } from "./panel";


export function ThreadCodePanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<CodeContract>();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    rpc.call("code.forThread", { threadId }).then(
      ({ workspace }) => { if (live) setWorkspaceId(workspace.id); },
      (cause) => { if (live) setError(errorMessage(cause)); },
    );
    return () => { live = false; };
  }, [rpc, threadId, attempt]);
  // Review comments submitted from this editor go to this thread.
  useEffect(() => {
    if (workspaceId) rpc.call("code.viewedFrom", { id: workspaceId, threadId }).catch(() => undefined);
  }, [rpc, workspaceId, threadId]);

  if (workspaceId) return <WorkspaceView key={workspaceId} id={workspaceId} />;
  if (error)
    return (
      <div className="flex flex-col items-start gap-2 p-4 text-sm text-muted-foreground">
        <p role="alert">{error}</p>
        <button type="button" className={BAR_BUTTON} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  return <p role="status" className="p-4 text-sm text-muted-foreground">Opening this thread's worktree…</p>;
}
