import { moduleComponent } from "./Notice";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginRpcClient, PluginRpcContract } from "@get-bb/plugin-sdk";
import { useMemo } from "react";

/** Keep module frontend contracts while sharing Studio's transport context. */
export function useModuleRpc<C extends PluginRpcContract>(module: string): PluginRpcClient<C> {
  const rpc = useRpc();
  return useMemo(() => ({ call: (method: string, input: unknown) => rpc.call(`${module}_${method}`, input) }) as PluginRpcClient<C>, [rpc, module]);
}

/** Suppress module surfaces while an enabled legacy plugin still owns them. */
export function moduleApp(host: import("@get-bb/plugin-sdk/app").PluginAppBuilder, name: string) {
  return { ...host,
    contentScripts: { register(registration: Parameters<typeof host.contentScripts.register>[0]) {
      host.contentScripts.register({ ...registration, id: `${name}-${registration.id}`, async mount(context) {
        const response = await fetch("/api/v1/plugins/studio/rpc/modules_status", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "null", signal: context.signal,
        });
        const status = await response.json() as { ok: boolean; result?: { active: string[] } };
        if (!context.signal.aborted && status.ok && status.result?.active.includes(name)) return registration.mount(context);
      } });
    } },
    composer: { ...host.composer, customize(registration: Parameters<typeof host.composer.customize>[0]) {
      host.composer.customize({ ...registration,
        ...(registration.actions ? { actions: registration.actions.map(action => ({ ...action, component: moduleComponent(name, action.component) })) } : {}),
        ...(registration.banners ? { banners: registration.banners.map(banner => ({ ...banner, component: moduleComponent(name, banner.component) })) } : {}),
      });
    } },
    slots: new Proxy(host.slots, { get(target, property) {
    const register = Reflect.get(target, property);
    if (typeof register !== "function") return register;
    return (registration: { component?: import("react").ComponentType<object>; headerContent?: import("react").ComponentType<object> }) => register.call(target, { ...registration, ...(registration.component ? { component: moduleComponent(name, registration.component) } : {}), ...(registration.headerContent ? { headerContent: moduleComponent(name, registration.headerContent) } : {}) });
  } }) };
}
