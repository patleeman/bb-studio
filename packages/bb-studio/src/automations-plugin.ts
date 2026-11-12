// Whether bb's automations plugin is confirmed off: installed and disabled,
// or not installed. A BB Studio copy imports it off (the fork's first-run
// import), so Studio runs its own automations on its trigger engine there.
// "Not answering" is not "off": a plugin that is on but failing still makes
// callers fail closed. Asked at most every 15 seconds.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

const CACHE_MS = 15_000;

export function automationsPluginOff(sdk: Pick<BbPluginApi["sdk"], "plugins">, now: () => number = Date.now): () => Promise<boolean> {
  let cached: { at: number; off: boolean } | null = null;
  return async () => {
    if (cached && now() - cached.at < CACHE_MS) return cached.off;
    let off = false;
    try {
      const { plugins } = await sdk.plugins.list();
      off = !plugins.some((plugin) => plugin.id === "automations" && plugin.enabled);
    } catch {
      return false;
    }
    cached = { at: now(), off };
    return off;
  };
}
