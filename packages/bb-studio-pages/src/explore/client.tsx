import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginRpcClient } from "@get-bb/plugin-sdk";
import { useMemo } from "react";
import type { rpcContract } from "./src/contract";

/** Explore's RPC methods, which Pages registers with an `explore_` prefix. */
export function useExploreRpc(): PluginRpcClient<typeof rpcContract> {
  const rpc = useRpc();
  return useMemo(() => ({ call: (method: string, input: unknown) => rpc.call("explore_" + method, input) }) as PluginRpcClient<typeof rpcContract>, [rpc]);
}
