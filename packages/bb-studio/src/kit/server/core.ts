// Server helpers for Studio add-ons. Pure functions over the SDK objects the
// caller passes in; no runtime imports, for the reason in contract.ts.
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { STUDIO_CHANGED_MAX_IDS, STUDIO_CHANGED_METHOD, STUDIO_PLUGIN_ID, type StudioSchemas } from "../contract";


export type StudioProviderHandlers = PluginRpcHandlers<StudioSchemas["provider"]>;
type OptionalMethods = "studio_rename" | "studio_duplicate" | "studio_template" | "studio_instantiate" | "studio_export";
export type StudioProviderRegistration = Omit<StudioProviderHandlers, OptionalMethods> & Partial<Pick<StudioProviderHandlers, OptionalMethods>>;

/**
 * Registers this plugin's `studio_*` methods. They're published for
 * discovery, which is how Studio finds its add-ons; publishing doesn't change
 * who may call them.
 */
export function registerStudioProvider(bb: Pick<BbPluginApi, "rpc">, schemas: StudioSchemas, handlers: StudioProviderRegistration): void {
  const unsupported = () => { throw new Error("This provider does not support this operation."); };
  bb.rpc.register(schemas.provider, {
    studio_rename: unsupported,
    studio_duplicate: unsupported,
    studio_template: unsupported,
    studio_instantiate: unsupported,
    studio_export: unsupported,
    ...handlers,
  }, {
    experimental_discoverable: true,
    experimental_description: "BB Studio provider: lists and manages this plugin's items in the Studio collection.",
  });
}

interface CallRpc {
  callRpc(args: { pluginId: string; method: string; input?: unknown; outputSchema: unknown }): Promise<unknown>;
}

export type StudioChanged = (pluginId: string, ids?: string[]) => Promise<unknown>;

/**
 * Tells Studio this add-on's items changed, so an open Studio collection
 * refetches them. Bursts collapse into one call. Built-ins retry failed
 * notifications; external add-ons retain a full refresh for their next change.
 */
export function createStudioNotifier(options: {
  plugins: CallRpc;
  /** Built-ins notify Studio directly; external add-ons use the RPC bridge. */
  notify?: StudioChanged;
  pluginId: string;
  schemas: StudioSchemas;
  delayMs?: number;
}): { changed(id?: string): void; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const ids = new Set<string>();
  let full = false;
  const send = () => {
    timer = undefined;
    if (disposed) return;
    const changedIds = [...ids];
    ids.clear();
    const reset = full;
    full = false;
    // Handle synchronous failures and rejected promises the same way.
    Promise.resolve()
      .then(() => options.notify
        ? options.notify(options.pluginId, !reset && changedIds.length ? changedIds : undefined)
        : options.plugins.callRpc({
        pluginId: STUDIO_PLUGIN_ID,
        method: STUDIO_CHANGED_METHOD,
        input: { pluginId: options.pluginId, ...(!reset && changedIds.length ? { ids: changedIds } : {}) },
        outputSchema: options.schemas.changed.output,
      }))
      .catch(() => {
        if (disposed) return;
        ids.clear();
        full = true;
        if (options.notify && !timer) timer = setTimeout(send, 1000);
      });
  };
  return {
    changed(id) {
      if (disposed) return;
      if (!id) {
        ids.clear();
        full = true;
      } else if (!full) {
        ids.add(id);
        if (ids.size > STUDIO_CHANGED_MAX_IDS) {
          ids.clear();
          full = true;
        }
      }
      if (timer) return;
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
