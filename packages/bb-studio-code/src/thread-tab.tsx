// VS Code beside a conversation. The tab opens the thread's own worktree, so
// the user sees the agent's changes; Back lists the other workspaces, and a
// reply card opens the one it names.
import { useEffect, useState, type ReactNode } from "react";
import { useRpc, type JsonValue } from "@get-bb/plugin-sdk/app";
import { BAR_BUTTON, ThreadItemsPanel } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { WorkspaceView } from "./panel";
import { CHANNEL, KIND_ID, PLUGIN_ID, type CodeContract } from "./shared";

/** Tells the tab whether a workspace is open in its list, while it's mounted. */
function Opened({ onChange, children }: { onChange(open: boolean): void; children: ReactNode }) {
  useEffect(() => { onChange(true); return () => onChange(false); }, [onChange]);
  return <>{children}</>;
}

export function ThreadCodePanel({ threadId, params }: { threadId: string; params: JsonValue | null }) {
  const asked = params && typeof params === "object" && !Array.isArray(params) && typeof params.workspaceId === "string" ? params.workspaceId : null;
  const rpc = useRpc<CodeContract>();
  const [openId, setOpenId] = useState<string | null>(asked);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState("");
  // A workspace opened from the list takes the whole tab: the note goes.
  const [itemOpen, setItemOpen] = useState(false);
  useEffect(() => { if (asked) { setOpenId(asked); setListing(false); } }, [asked]);
  useEffect(() => {
    if (openId || listing) return;
    let live = true;
    rpc.call("forThread", { threadId }).then(
      ({ workspace }) => { if (live) setOpenId(workspace.id); },
      (cause) => { if (live) setError(errorMessage(cause)); },
    );
    return () => { live = false; };
  }, [rpc, threadId, openId, listing]);

  if (listing || error)
    return (
      <div className="flex h-full flex-col">
        {error && !listing && !itemOpen && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground">
            <span className="min-w-0 flex-1">{error}</span>
            <button type="button" className={BAR_BUTTON} onClick={() => { setError(""); setListing(false); }}>Try again</button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <ThreadItemsPanel
            threadId={threadId}
            pluginId={PLUGIN_ID}
            kind={KIND_ID}
            channel={CHANNEL}
            renderItem={(id, { backLabel, onBack }) => (
              <Opened key={id} onChange={setItemOpen}>
                <WorkspaceView id={id} backLabel={backLabel} onBack={onBack} compact />
              </Opened>
            )}
          />
        </div>
      </div>
    );
  if (!openId) return <p role="status" className="p-4 text-sm text-muted-foreground">Opening this thread's worktree…</p>;
  return <WorkspaceView key={openId} id={openId} backLabel="Workspaces" onBack={() => { setOpenId(null); setListing(true); }} compact />;
}
