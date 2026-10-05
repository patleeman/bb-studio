// Studio Pages' Next row offers quick replies along with things to explore
// and actions, in one line at the end of a reply. While it's on, smart
// reactions stay out of the way so agents aren't asked for two lines.

export const PAGES_PLUGIN_ID = "pages";

/** How often to recheck Pages' setting; `configure` is synchronous, so the answer is cached. */
export const NEXT_ROW_REFRESH_MS = 60_000;

interface NextRowSdk {
  plugins: {
    list(): Promise<{ plugins: readonly { id: string; enabled: boolean }[] }>;
    getSettings(args: { pluginId: string; signal?: AbortSignal }): Promise<{ values: Record<string, unknown> }>;
  };
}

/** Whether Pages is enabled with its Next row on (`explore_next`, on by default). */
export async function pagesNextRowOn(sdk: NextRowSdk): Promise<boolean> {
  try {
    const { plugins } = await sdk.plugins.list();
    if (!plugins.some((plugin) => plugin.id === PAGES_PLUGIN_ID && plugin.enabled)) return false;
    const { values } = await sdk.plugins.getSettings({ pluginId: PAGES_PLUGIN_ID, signal: AbortSignal.timeout(10_000) });
    return values.explore_next !== false;
  } catch {
    return false;
  }
}
