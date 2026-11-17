import { getThreadPluginMetadata, type DbQueryConnection } from "@bb/db";
import type { ForkProviderOptionsContext } from "@get-bb/plugin-sdk";

export function forkProviderOptionsContext(
  deps: {
    db: DbQueryConnection;
    providerRegistry: {
      get(providerId: string): { pluginId: string } | null;
    };
  },
  providerId: string,
  threadId: string,
): ForkProviderOptionsContext {
  const pluginId = deps.providerRegistry.get(providerId)?.pluginId;
  if (pluginId === undefined) return {};
  return {
    experimental_pluginMetadata: getThreadPluginMetadata(
      deps.db,
      threadId,
      pluginId,
    ).metadata,
  };
}
