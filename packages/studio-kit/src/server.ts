// Server helpers for Studio add-ons. Pure functions over the SDK objects the
// caller passes in; no runtime imports, for the reason in contract.ts.
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { STUDIO_CHANGED_METHOD, STUDIO_PLUGIN_ID, type StudioSchemas } from "./contract";

export type StudioProviderHandlers = PluginRpcHandlers<StudioSchemas["provider"]>;

/**
 * Registers this plugin's `studio_*` methods. They're published for
 * discovery, which is how Studio finds its add-ons; publishing doesn't change
 * who may call them.
 */
export function registerStudioProvider(bb: Pick<BbPluginApi, "rpc">, schemas: StudioSchemas, handlers: StudioProviderHandlers): void {
  bb.rpc.register(schemas.provider, handlers, {
    experimental_discoverable: true,
    experimental_description: "BB Studio provider: lists and manages this plugin's items in the Studio collection.",
  });
}

interface CallRpc {
  callRpc(args: { pluginId: string; method: string; input?: unknown; outputSchema: unknown }): Promise<unknown>;
}

/**
 * Tells Studio this add-on's items changed, so an open Studio collection
 * refetches them. Bursts collapse into one call. Best effort: when Studio
 * isn't installed or running, the call fails quietly.
 */
export function createStudioNotifier(options: {
  plugins: CallRpc;
  pluginId: string;
  schemas: StudioSchemas;
  delayMs?: number;
}): { changed(): void; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const send = () => {
    timer = undefined;
    if (disposed) return;
    options.plugins
      .callRpc({
        pluginId: STUDIO_PLUGIN_ID,
        method: STUDIO_CHANGED_METHOD,
        input: { pluginId: options.pluginId },
        outputSchema: options.schemas.changed.output,
      })
      .catch(() => {});
  };
  return {
    changed() {
      if (disposed || timer) return;
      timer = setTimeout(send, options.delayMs ?? 250);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** The HTTP status of a failed cross-plugin call: 404 not installed, 503 not running. */
export function rpcErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}
