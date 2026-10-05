// Studio Pages' Next row offers quick replies along with things to explore
// and actions, in one line at the end of a reply. While it's on, smart
// reactions stay out of the way so agents aren't asked for two lines.

export const PAGES_PLUGIN_ID = "pages";
/** Pages' setting for the Next row. Pages versions without it have no Next row. */
export const NEXT_ROW_SETTING = "explore_next";

/** How often to recheck Pages' setting; `configure` is synchronous, so the answer is cached. */
export const NEXT_ROW_REFRESH_MS = 60_000;
/** How long one check may take before smart reactions apply as usual. */
export const NEXT_ROW_TIMEOUT_MS = 10_000;

/**
 * Pages states in which its `configure` adds the Next row's instructions.
 * `starting` counts so a BB launch doesn't ask for both lines while Pages loads.
 */
const LOADED = new Set(["running", "degraded", "starting"]);

interface NextRowSdk {
  plugins: {
    list(): Promise<{ plugins: readonly { id: string; enabled: boolean; status?: string }[] }>;
    getSettings(args: { pluginId: string; signal?: AbortSignal }): Promise<{ schema?: Record<string, unknown>; values: Record<string, unknown> }>;
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Whether Pages is loaded with its Next row on (`explore_next`, on by default).
 * Anything uncertain (Pages disabled, failed, too old for the setting, or not
 * answering) counts as off, so smart reactions still apply.
 */
export async function pagesNextRowOn(sdk: NextRowSdk, timeoutMs: number = NEXT_ROW_TIMEOUT_MS): Promise<boolean> {
  try {
    const { plugins } = await withTimeout(sdk.plugins.list(), timeoutMs);
    const pages = plugins.find((plugin) => plugin.id === PAGES_PLUGIN_ID);
    if (!pages?.enabled || (pages.status !== undefined && !LOADED.has(pages.status))) return false;
    const { schema, values } = await withTimeout(
      sdk.plugins.getSettings({ pluginId: PAGES_PLUGIN_ID, signal: AbortSignal.timeout(timeoutMs) }),
      timeoutMs,
    );
    if (!schema || !(NEXT_ROW_SETTING in schema)) return false;
    return values[NEXT_ROW_SETTING] !== false;
  } catch {
    return false;
  }
}
