// VS Code beside a conversation: the thread's own worktree, so the user sees
// the agent's changes, or the workspace a reply card names. The tab is VS
// Code alone, with no bar; other workspaces live on the Workspaces page.
import { useEffect, useState } from "react";
import { useRpc, type JsonValue } from "@get-bb/plugin-sdk/app";
import { BAR_BUTTON } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { WorkspaceView } from "./panel";
import type { CodeContract } from "./shared";
import { needsWorktree, tabView } from "./thread-tab-plan";

export function ThreadCodePanel({ threadId, params }: { threadId: string; params: JsonValue | null }) {
  const fields = params && typeof params === "object" && !Array.isArray(params) ? params : null;
  const asked = typeof fields?.workspaceId === "string" ? fields.workspaceId : null;
  // Each open from the header is a new request, even for the same workspace.
  const at = typeof fields?.at === "number" ? fields.at : null;
  const rpc = useRpc<CodeContract>();
  const [worktreeId, setWorktreeId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(asked);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setOpenId(asked), [asked, at]);
  const lookup = needsWorktree(openId);
  useEffect(() => {
    if (!lookup) return;
    let live = true;
    setError("");
    rpc.call("forThread", { threadId }).then(
      ({ workspace }) => { if (live) setWorktreeId(workspace.id); },
      (cause) => { if (live) setError(errorMessage(cause)); },
    );
    return () => { live = false; };
  }, [rpc, threadId, attempt, lookup]);

  const view = tabView({ openId, worktreeId, error });
  if (view.kind === "workspace") return <WorkspaceView key={view.id} id={view.id} />;
  if (view.kind === "error")
    return (
      <div className="flex flex-col items-start gap-2 p-4 text-sm text-muted-foreground">
        <p role="alert">{view.message}</p>
        <button type="button" className={BAR_BUTTON} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  return <p role="status" className="p-4 text-sm text-muted-foreground">Opening this thread's worktree…</p>;
}
