// The BB Studio setup summary from Studio's server, refreshed whenever a
// health check finishes. See src/setup.ts.
import { HEALTH_REALTIME_CHANNEL } from "@bb-studio/kit/health";
import { errorMessage } from "@bb-studio/kit/format";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SetupActionResult, setupContract, SetupSummary } from "../../setup-contract";

const FRESH_MS = 60_000;
const CACHED_MS = 3_600_000;

export function useSetup() {
  const rpc = useRpc<typeof setupContract>();
  const [summary, setSummary] = useState<SetupSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The last action's failures, by plugin id. */
  const [failures, setFailures] = useState<Record<string, string>>({});
  /** What's running now: "check", "install-all", or a plugin id. */
  const [busy, setBusy] = useState<string | null>(null);

  /** Counts summaries applied; a load that started before the latest one is stale and dropped. */
  const applied = useRef(0);

  const load = useCallback(async (maxAgeMs: number) => {
    const started = applied.current;
    try {
      const fresh = await rpc.call("setup.summary", { maxAgeMs });
      if (applied.current !== started) return;
      applied.current++;
      setSummary(fresh);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [rpc]);
  useEffect(() => { void load(FRESH_MS); }, [load]);
  useRealtime(HEALTH_REALTIME_CHANNEL, () => void load(CACHED_MS));

  const act = useCallback(async (key: string, ids: readonly string[], work: () => Promise<SetupActionResult>) => {
    setBusy(key);
    try {
      const result = await work();
      applied.current++;
      setSummary(result.summary);
      setFailures((current) => {
        const next = { ...current };
        for (const id of ids) delete next[id];
        for (const failure of result.failures) next[failure.id] = failure.error;
        return next;
      });
      setError(null);
    } catch (cause) {
      setFailures((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, errorMessage(cause)])) }));
    } finally {
      setBusy(null);
    }
  }, []);

  return {
    summary,
    error,
    failures,
    busy,
    checkAgain: async () => { setBusy("check"); await load(0); setBusy(null); },
    install: (ids: string[], key = ids[0]!) => act(key, ids, () => rpc.call("setup.install", { pluginIds: ids })),
    enable: (id: string) => act(id, [id], () => rpc.call("setup.enable", { pluginId: id })),
    remove: (id: string) => act(id, [id], () => rpc.call("setup.remove", { pluginId: id })),
  };
}

export type SetupApi = ReturnType<typeof useSetup>;
