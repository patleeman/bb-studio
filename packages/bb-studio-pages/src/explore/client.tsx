import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginRpcClient } from "@get-bb/plugin-sdk";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { rpcContract } from "./src/contract";
import type { exploreStatusContract } from "./status";

/** Explore's RPC methods, which Pages registers with an `explore_` prefix. */
export function useExploreRpc(): PluginRpcClient<typeof rpcContract> {
  const rpc = useRpc();
  return useMemo(() => ({ call: (method: string, input: unknown) => rpc.call("explore_" + method, input) }) as PluginRpcClient<typeof rpcContract>, [rpc]);
}

let cached: Promise<{ active: boolean; legacyInstalled: boolean }> | undefined;

/** Renders Explore only when it runs in Pages, not while the standalone Explore plugin is enabled. */
export function ExploreGate({ children, notice = false }: { children: ReactNode; notice?: boolean }) {
  const rpc = useRpc<typeof exploreStatusContract>();
  const [status, setStatus] = useState<{ active: boolean; legacyInstalled: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    cached ??= rpc.call("exploreStatus", null).catch((error) => { cached = undefined; throw error; });
    void cached.then(result => { if (live) setStatus(result); }).catch(() => {});
    return () => { live = false; };
  }, [rpc]);
  if (status?.active) return <>{children}</>;
  if (!notice || !status) return null;
  return <div className="p-6 text-sm text-muted-foreground">
    Explore is running in the standalone Studio Explore plugin. Disable that plugin and reload Studio Pages to use Explore here; its explainers and settings are copied over.
  </div>;
}
