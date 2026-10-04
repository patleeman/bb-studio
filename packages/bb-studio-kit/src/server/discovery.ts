export interface DiscoveredPlugin {
  id: string;
  enabled: boolean;
  name: string | null;
  status: string;
  statusDetail: string | null;
  version: string;
  updatedAt?: string;
}

/** An empty complete result confirms absence; an outage never does. */
export type ProviderItems<T> =
  | { status: "ready"; items: T[]; complete: boolean }
  | { status: "unavailable"; error: string }
  | { status: "absent" };

export async function loadProviderItems<T>(load: () => Promise<{ items: T[]; truncated?: boolean }>): Promise<ProviderItems<T>> {
  try {
    const result = await load();
    return { status: "ready", items: result.items, complete: !result.truncated };
  } catch (error) {
    return { status: "unavailable", error: error instanceof Error ? error.message : String(error) };
  }
}

export interface ProviderDiscovery<T extends DiscoveredPlugin> {
  providers: T[];
  /** Installed and enabled, including add-ons omitted by failed discovery. */
  installed: readonly T[];
  complete: boolean;
}

export interface DiscoverySdk<T extends DiscoveredPlugin> {
  plugins: {
    list(): Promise<{ plugins: readonly T[] }>;
    experimental_discoverRpc(args: { method: string }): Promise<readonly { pluginId: string }[]>;
  };
}

/** Find installed, enabled providers; known add-ons retain their display order. */
export async function discoverProviderSnapshot<T extends DiscoveredPlugin>(
  sdk: DiscoverySdk<T>,
  options: { method: string; known: readonly string[]; exclude?: readonly string[] },
): Promise<ProviderDiscovery<T>> {
  const [{ plugins }, discovered] = await Promise.all([
    sdk.plugins.list(),
    sdk.plugins.experimental_discoverRpc({ method: options.method }).then(
      (methods) => ({ ids: methods.map((method) => method.pluginId), complete: true }),
      () => ({ ids: [] as string[], complete: false }),
    ),
  ]);
  const extras = [...new Set(discovered.ids)].filter((id) => !options.known.includes(id)).sort();
  const providers = [...options.known, ...extras].flatMap((id) => {
    const entry = plugins.find((plugin) => plugin.id === id);
    return entry?.enabled && !options.exclude?.includes(id) ? [entry] : [];
  });
  return { providers, installed: plugins.filter((plugin) => plugin.enabled && !options.exclude?.includes(plugin.id)), complete: discovered.complete };
}

/** Run one request per provider while isolating a provider's failure. */
export async function fanOutProviders<T, R>(
  providers: readonly T[],
  load: (provider: T) => Promise<R>,
  failed: (provider: T, error: unknown) => R,
): Promise<R[]> {
  return Promise.all(providers.map((provider) => load(provider).catch((error) => failed(provider, error))));
}
