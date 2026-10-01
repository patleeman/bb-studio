import type { PluginMentionProviderRegistration } from "@get-bb/plugin-sdk";

/** Bound mention search results while retaining each add-on's ids and resolver. */
export function defineItemMention(
  provider: PluginMentionProviderRegistration,
  limit = 50,
): PluginMentionProviderRegistration {
  return {
    ...provider,
    search(ctx) {
      const result = provider.search(ctx);
      return result instanceof Promise ? result.then((items) => items.slice(0, limit)) : result.slice(0, limit);
    },
  };
}
