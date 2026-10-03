import { useRpc, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import type { PluginRpcClient } from "@get-bb/plugin-sdk";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { rpcContract } from "./src/contract";
import type { exploreStatusContract } from "./status";
import { registerApp } from "./app";

export function useExploreRpc(): PluginRpcClient<typeof rpcContract> {
  const rpc = useRpc();
  return useMemo(() => ({ call: (method: string, input: unknown) => rpc.call("explore_" + method, input) }) as PluginRpcClient<typeof rpcContract>, [rpc]);
}
function gate(Component: ComponentType<object>) {
  return function ExploreSurface(props: object) {
    const rpc = useRpc<typeof exploreStatusContract>();
    const [active, setActive] = useState(false);
    useEffect(() => {
      let live = true;
      void rpc.call("exploreStatus", null).then(result => { if (live) setActive(result.active); }).catch(() => {});
      return () => { live = false; };
    }, [rpc]);
    return active ? <Component {...props} /> : null;
  };
}
export function registerExploreApp(host: PluginAppBuilder) {
  registerApp({ ...host, slots: new Proxy(host.slots, { get(target, property) {
    const register = Reflect.get(target, property);
    if (typeof register !== "function") return register;
    return (registration: { component?: ComponentType<object> }) => register.call(target, { ...registration,
      ...(registration.component ? { component: gate(registration.component) } : {}),
    });
  } }) });
}
