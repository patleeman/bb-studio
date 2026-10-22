import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import type { PluginRpcResult } from "@get-bb/plugin-sdk/app";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import { requestGeneration } from "../kit/ui/request-generation";
import { errorMessage } from "../kit/format";
import { applyItemChanges } from "../partial";

type Overview = PluginRpcResult<typeof rpcContract.overview>;
const REFETCH_DEBOUNCE_MS = 300;

export function useOverview(rpc: ReturnType<typeof useRpc<typeof rpcContract>>) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requests] = useState(requestGeneration);
  const running = useRef(false);
  const pending = useRef<"full" | "delta" | null>(null);
  const cursor = useRef<number | null>(null);
  // Full and incremental loads share one queue and one cursor owner.
  const load = useCallback(async (mode: "full" | "delta") => {
    if (running.current) {
      pending.current = pending.current === "full" || mode === "full" ? "full" : "delta";
      return;
    }
    running.current = true;
    const current = requests.begin();
    const full = mode === "full" || cursor.current === null;
    try {
      if (full) {
        const checkpoint = await rpc.call("changes", { since: 0 });
        if (!current()) return;
        const result = await rpc.call("overview", null);
        if (!current()) return;
        setData(result);
        cursor.current = checkpoint.cursor;
        setError(null);
        // Changes during the full load are caught by the same queue.
        const later = await rpc.call("changes", { since: checkpoint.cursor });
        if (!current()) return;
        if (later.reset) pending.current = "full";
        else if (later.changes.length && !pending.current) pending.current = "delta";
      } else {
        const result = await rpc.call("changes", { since: cursor.current! });
        if (!current()) return;
        if (result.reset) { pending.current = "full"; return; }
        const groups = new Map<string, string[]>();
        for (const change of result.changes) {
          if (!change.removed) groups.set(change.pluginId, [...(groups.get(change.pluginId) ?? []), change.id]);
        }
        const fetched = await Promise.all([...groups].map(([pluginId, ids]) => rpc.call("items", { pluginId, ids })));
        if (!current()) return;
        setData((previous) => previous && { ...previous, items: applyItemChanges(previous.items, fetched.flatMap(({ items }) => items), result.changes.filter((change) => change.removed)) });
        cursor.current = result.cursor;
        setError(null);
      }
    } catch (cause) {
      if (!current()) return;
      setError(errorMessage(cause));
      if (!full) pending.current = "full";
    } finally {
      if (current()) {
        running.current = false;
        const next = pending.current;
        pending.current = null;
        if (next) void load(next);
      }
    }
  }, [rpc, requests]);
  const refetch = useCallback(() => { void load("full"); }, [load]);
  useEffect(() => {
    refetch();
    const onVisible = () => document.visibilityState === "visible" && refetch();
    document.addEventListener("visibilitychange", onVisible);
    return () => { requests.invalidate(); running.current = false; pending.current = null; document.removeEventListener("visibilitychange", onVisible); };
  }, [refetch, requests]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  useRealtime(STUDIO_REALTIME_CHANNEL, () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void load("delta"); }, REFETCH_DEBOUNCE_MS);
  });
  return { data, error, refetch, setData };
}

