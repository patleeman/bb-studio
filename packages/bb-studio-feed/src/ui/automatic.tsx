import { GHOST_BUTTON, cn } from "@bb-studio/kit/app";
import { relativeTime, errorMessage } from "@bb-studio/kit/format";
import { experimental_useSidebarThreads as useSidebarThreads, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import type { rpcContract } from "../contract";
import type { AutomaticUpdate } from "../automatic-contract";
import { REALTIME_CHANNEL } from "../shared";

export function useAutomaticUpdates() {
  const rpc = useRpc<typeof rpcContract>();
  const { threads } = useSidebarThreads();
  const [updates, setUpdates] = useState<AutomaticUpdate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ id: string; name: string; error: string }[]>([]);
  const [degraded, setDegraded] = useState(false);
  const load = useCallback(() => {
    let cancelled = false;
    rpc.call("inbox.updates", {}).then(result => {
      if (cancelled) return;
      setUpdates(result.updates); setFailures(result.failures); setDegraded(result.degraded); setError(null);
    }, cause => { if (!cancelled) setError(errorMessage(cause)); });
    return () => { cancelled = true; };
  }, [rpc]);
  useEffect(load, [load]);
  // Automation failures have no lifecycle event in the stable SDK.
  useEffect(() => { const timer = setInterval(load, 60_000); return () => clearInterval(timer); }, [load]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    if (payload && typeof payload === "object" && "type" in payload && payload.type === "automatic") load();
  });
  // Reading in another pane immediately clears the badge, without polling.
  const live = new Map(threads.map(t => [t.id, t]));
  return { failures, updates: updates.filter(row => {
    const thread = live.get(row.threadId);
    return !thread || (!thread.isArchived && !thread.isHidden);
  }).map(row => ({ ...row, read: row.read || (live.get(row.threadId)?.lastReadAt ?? 0) >= row.at })), error, degraded, load };
}

export function AutomaticUpdates() {
  const { updates, error, degraded, load } = useAutomaticUpdates();
  const rpc = useRpc<typeof rpcContract>();
  const [actionError, setActionError] = useState<string | null>(null);
  if (!updates.length && !error) return null;
  return <section aria-labelledby="inbox-results" className="mb-8">
    <h2 id="inbox-results" className="mb-2 text-lg font-semibold">New results</h2>
    {error || actionError ? <p role="alert" className="text-sm text-destructive">{error || actionError}</p> : null}
    {degraded ? <p className="mb-2 text-xs text-muted-foreground">Smart filtering is unavailable. Results are still delivered.</p> : null}
    <ol className="divide-y divide-border/60">
      {updates.map(row => <li key={row.threadId} className="flex items-start gap-3 py-3">
        <a href={`/threads/${encodeURIComponent(row.threadId)}`} className="min-w-0 flex-1 rounded focus-visible:outline focus-visible:outline-2">
          <span className={cn("block text-sm", row.read ? "text-muted-foreground" : "font-semibold")}>
            {row.urgent ? "Urgent · " : ""}{row.headline}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">{row.title} · {relativeTime(row.at)}</span>
          {row.body.includes("\n") ? <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">{row.body.split("\n").slice(1).join("\n").trim()}</span> : null}
        </a>
        {!row.read ? <button type="button" className={cn(GHOST_BUTTON, "shrink-0 text-xs")} aria-label={`Mark result from ${row.title} read`}
          onClick={() => { void rpc.call("inbox.read", { threadId: row.threadId, at: row.at }).then(() => { setActionError(null); load(); }, cause => setActionError(errorMessage(cause))); }}>Mark read</button> : null}
      </li>)}
    </ol>
  </section>;
}
