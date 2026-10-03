import { useModuleRpc } from "../app";
import { useCallback, useEffect, useState } from "react";
import { useBbNavigate, useRealtime } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";
import { EmptyState, openCompanion } from "@bb-studio/kit/app";
import { ErrorMessage, message } from "./bot-ui";
import { affects } from "./realtime";

type ProfileThread = {
  threadId: string;
  title: string;
  archived: boolean;
  updatedAt: number;
};

/** The threads working as this bot, newest first. */
export function ProfileThreads({ id }: { id: string }) {
  const rpc = useModuleRpc<typeof rpcContract>("teams"),
    navigate = useBbNavigate();
  const [threads, setThreads] = useState<ProfileThread[] | null>(null),
    [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    rpc.call("profileThreads", { id }).then(
      (next) => {
        setThreads(next);
        setError(null);
      },
      (cause) => setError(message(cause)),
    );
  }, [rpc, id]);
  useEffect(load, [load]);
  useRealtime("scoped-changed", (event) => { if (affects(event, "bots", id)) load(); });
  if (!threads) return <ErrorMessage error={error} />;
  if (!threads.length)
    return (
      <EmptyState icon="MessageSquare" title="No threads yet">
        Choose Work as bot in any thread's composer, or use Chat.
      </EmptyState>
    );
  return (
    <ol className="flex min-w-0 flex-col py-1">
      <ErrorMessage error={error} />
      {threads.map((thread) => (
        <li key={thread.threadId}>
          <button
            type="button"
            className="flex min-h-7 w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-state-hover focus-visible:bg-state-hover"
            onClick={() => { if (!openCompanion({ kind: "thread", threadId: thread.threadId })) navigate.toThread(thread.threadId); }}
          >
            <span className="min-w-0 flex-1 truncate">{thread.title}</span>
            {thread.archived && <span className="text-xs text-muted-foreground">Archived</span>}
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {new Date(thread.updatedAt).toLocaleDateString()}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
