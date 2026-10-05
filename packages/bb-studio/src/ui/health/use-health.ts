// The plugin health summary from Studio's server, kept current by its
// realtime signal. See src/health.ts.
import { HEALTH_REALTIME_CHANNEL } from "@bb-studio/kit/health";
import { errorMessage } from "@bb-studio/kit/format";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import type { healthContract, HealthSummary } from "../../health-contract";

/** A result this recent is reused when a view opens. */
const FRESH_MS = 60_000;
/** Any cached result, for realtime refreshes the server already ran. */
const CACHED_MS = 3_600_000;

export function useHealth() {
  const rpc = useRpc<typeof healthContract>();
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (work: () => Promise<HealthSummary>) => {
    setBusy(true);
    try {
      setSummary(await work());
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void run(() => rpc.call("health.summary", { maxAgeMs: FRESH_MS }));
  }, [rpc, run]);
  useRealtime(HEALTH_REALTIME_CHANNEL, () => void run(() => rpc.call("health.summary", { maxAgeMs: CACHED_MS })));
  return {
    summary,
    error,
    busy,
    checkAgain: () => run(() => rpc.call("health.summary", { maxAgeMs: 0 })),
    hide: (key: string, hidden: boolean) => run(() => rpc.call("health.hide", { key, hidden })),
    disable: (pluginId: string) => run(() => rpc.call("health.disable", { pluginId })),
  };
}

export type HealthApi = ReturnType<typeof useHealth>;
