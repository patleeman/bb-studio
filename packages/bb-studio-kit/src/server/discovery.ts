export interface DiscoveredPlugin {
  id: string;
  enabled: boolean;
  name: string | null;
  status: string;
  statusDetail: string | null;
  version: string;
}

export interface DiscoverySdk<T extends DiscoveredPlugin> {
  plugins: {
    list(): Promise<{ plugins: readonly T[] }>;
    experimental_discoverRpc(args: { method: string }): Promise<readonly { pluginId: string }[]>;
  };
}

/** Find installed, enabled providers; known add-ons retain their display order. */
export async function discoverProviders<T extends DiscoveredPlugin>(
  sdk: DiscoverySdk<T>,
  options: { method: string; known: readonly string[]; exclude?: readonly string[] },
): Promise<T[]> {
  const [{ plugins }, discovered] = await Promise.all([
    sdk.plugins.list(),
    sdk.plugins.experimental_discoverRpc({ method: options.method }).then(
      (methods) => methods.map((method) => method.pluginId),
      () => [] as string[],
    ),
  ]);
  const extras = [...new Set(discovered)].filter((id) => !options.known.includes(id)).sort();
  return [...options.known, ...extras].flatMap((id) => {
    const entry = plugins.find((plugin) => plugin.id === id);
    return entry?.enabled && !options.exclude?.includes(id) ? [entry] : [];
  });
}

/** Run one request per provider while isolating a provider's failure. */
export async function fanOutProviders<T, R>(
  providers: readonly T[],
  load: (provider: T) => Promise<R>,
  failed: (provider: T, error: unknown) => R,
): Promise<R[]> {
  return Promise.all(providers.map((provider) => load(provider).catch((error) => failed(provider, error))));
}
