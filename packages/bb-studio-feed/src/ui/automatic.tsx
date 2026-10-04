import { GHOST_BUTTON, SECTION_TITLE, cn } from "@bb-studio/kit/app";
import { relativeTime, errorMessage } from "@bb-studio/kit/format";
import { experimental_useSidebarThreads as useSidebarThreads, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useState, useSyncExternalStore } from "react";
import type { rpcContract } from "../contract";
import type { AutomaticUpdate } from "../automatic-contract";
import { REALTIME_CHANNEL } from "../shared";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type Snapshot = { updates: AutomaticUpdate[]; failures: { id: string; name: string; error: string }[]; degraded: boolean; error: string | null };

// One shared copy for every surface (the sidebar count, the Inbox page, Float):
// one timer and one inbox.updates call per change, however many are mounted.
const shared = {
  snapshot: { updates: [], failures: [], degraded: false, error: null } as Snapshot,
  listeners: new Set<() => void>(),
  rpc: null as Rpc | null,
  timer: null as ReturnType<typeof setInterval> | null,
  scheduled: false,
  loading: false,
  again: false,
};
function emit(next: Partial<Snapshot>) {
  shared.snapshot = { ...shared.snapshot, ...next };
  for (const listener of shared.listeners) listener();
}
function fetchUpdates() {
  const rpc = shared.rpc;
  if (!rpc) return;
  if (shared.loading) { shared.again = true; return; }
  shared.loading = true;
  rpc.call("inbox.updates", {}).then(
    result => emit({ updates: result.updates, failures: result.failures, degraded: result.degraded, error: null }),
    cause => emit({ error: errorMessage(cause) }),
  ).finally(() => {
    shared.loading = false;
    if (shared.again) { shared.again = false; fetchUpdates(); }
  });
}
/** Coalesces reloads requested in the same tick, such as one realtime event seen by every mounted surface. */
function reload() {
  if (shared.scheduled) return;
  shared.scheduled = true;
  setTimeout(() => { shared.scheduled = false; fetchUpdates(); }, 0);
}
function subscribe(rpc: Rpc, listener: () => void) {
  shared.rpc = rpc;
  shared.listeners.add(listener);
  if (shared.listeners.size === 1) {
    reload();
    // Automation failures have no lifecycle event in the stable SDK.
    shared.timer = setInterval(reload, 60_000);
  }
  return () => {
    shared.listeners.delete(listener);
    if (!shared.listeners.size && shared.timer) { clearInterval(shared.timer); shared.timer = null; }
  };
}

export function useAutomaticUpdates() {
  const rpc = useRpc<typeof rpcContract>();
  const { threads } = useSidebarThreads();
  const { updates, failures, error, degraded } = useSyncExternalStore(useCallback(listener => subscribe(rpc, listener), [rpc]), () => shared.snapshot);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    if (payload && typeof payload === "object" && "type" in payload && payload.type === "automatic") reload();
  });
  // Reading in another pane immediately clears the badge, without polling.
  const live = new Map(threads.map(t => [t.id, t]));
  return { failures, updates: updates.filter(row => {
    const thread = live.get(row.threadId);
    return !thread || (!thread.isArchived && !thread.isHidden);
  }).map(row => ({ ...row, read: row.read || (live.get(row.threadId)?.lastReadAt ?? 0) >= row.at })), error, degraded, load: reload };
}

export function AutomaticUpdates() {
  const { updates, error, degraded, load } = useAutomaticUpdates();
  const rpc = useRpc<typeof rpcContract>();
  const [actionError, setActionError] = useState<string | null>(null);
  if (!updates.length && !error) return null;
  return <section aria-labelledby="inbox-results" className="mb-8">
    <h2 id="inbox-results" className={cn("mb-2", SECTION_TITLE)}>New results</h2>
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
