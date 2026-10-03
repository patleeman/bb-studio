import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginRpcClient, PluginRpcContract } from "@get-bb/plugin-sdk";
import { useMemo } from "react";

/** Keep module frontend contracts while sharing Studio's transport context. */
export function useModuleRpc<C extends PluginRpcContract>(module: string): PluginRpcClient<C> {
  const rpc = useRpc();
  return useMemo(() => ({ call: (method: string, input: unknown) => rpc.call(`${module}_${method}`, input) }) as PluginRpcClient<C>, [rpc, module]);
}
