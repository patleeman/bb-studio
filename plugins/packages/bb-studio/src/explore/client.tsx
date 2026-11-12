import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginRpcClient } from "@get-bb/plugin-sdk";
import type { rpcContract } from "./contract";

/** Explore's RPC methods: Studio's `explore.*`. */
export function useExploreRpc(): PluginRpcClient<typeof rpcContract> {
  return useRpc<typeof rpcContract>();
}
