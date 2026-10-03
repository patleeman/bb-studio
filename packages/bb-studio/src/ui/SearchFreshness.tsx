import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { rpcContract, SearchStatus } from "../contract";

/** Status reads never start a rebuild or wait for a provider. */
export function useSearchFreshness(enabled = true) {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [error, setError] = useState(false);
  const [signal, setSignal] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useRealtime(STUDIO_REALTIME_CHANNEL, () => { if (enabled) setSignal((value) => value + 1); });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await rpc.call("searchStatus", null);
        if (live) { setStatus(next); setError(false); }
      } catch { if (live) setError(true); }
      finally { busy = false; }
    };
    void refresh();
    // Also catch missed realtime events, including recovery while this view is open.
    const timer = setInterval(() => { void refresh(); }, 3_000);
    return () => { live = false; clearInterval(timer); };
  }, [rpc, enabled, signal]);
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try { setStatus(await rpc.call("searchRetry", null)); setError(false); }
    catch { setError(true); }
    finally { setRetrying(false); setSignal((value) => value + 1); }
  };
  return { status, error, retrying, retry, revision: status?.revision ?? 0 };
}

export function freshnessMessage(status: SearchStatus | null, error = false): string | null {
  if (error) return "Search freshness could not be checked.";
  if (!status || status.state === "current") return null;
  if (status.state === "initializing") return "Preparing Studio search…";
  if (status.state === "recovering") return "Updating Studio search. Results may be incomplete.";
  if (status.discoveryIncomplete) return "Some add-ons could not be checked. Studio results may be out of date.";
  if (status.unavailableProviders.length) return "Some add-ons are unavailable. Studio results may be out of date.";
  return "Studio search is incomplete. Some recent content may be missing.";
}

export function SearchFreshness({ status, error, retrying, retry }: Pick<ReturnType<typeof useSearchFreshness>, "status" | "error" | "retrying" | "retry">) {
  const message = freshnessMessage(status, error);
  if (!message) return null;
  const canRetry = error || status?.state === "stale";
  return <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
    <span role="status" aria-live="polite">{message}</span>
    {canRetry ? <button type="button" className="shrink-0 rounded underline underline-offset-2 focus-visible:outline focus-visible:outline-2" disabled={retrying} onClick={() => { void retry(); }}>{retrying ? "Retrying…" : "Retry"}</button> : null}
  </div>;
}
