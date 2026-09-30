// Whether a suite plugin is installed and running. Add-ons hand their
// collection over to Studio when it is, and Pages hands its chat over to
// Studio Chat.
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { STUDIO_CHAT_PLUGIN_ID, STUDIO_PLUGIN_ID } from "../contract";

type Presence = boolean | null;

const cached = new Map<string, { value: boolean; at: number }>();
const CACHE_MS = 30_000;

interface PluginLister {
  plugins: { list(): Promise<{ plugins: readonly { id: string; enabled: boolean; status?: string }[] }> };
}

const fresh = (pluginId: string) => {
  const entry = cached.get(pluginId);
  return entry && Date.now() - entry.at < CACHE_MS ? entry.value : null;
};

async function lookUp(sdk: PluginLister, pluginId: string): Promise<boolean> {
  const known = fresh(pluginId);
  if (known !== null) return known;
  const { plugins } = await sdk.plugins.list();
  const entry = plugins.find((plugin) => plugin.id === pluginId);
  const value = Boolean(entry?.enabled && entry.status !== "error" && entry.status !== "incompatible");
  cached.set(pluginId, { value, at: Date.now() });
  return value;
}

/** null while checking; a failed check counts as absent. */
export function usePluginPresent(pluginId: string): Presence {
  const sdk = useSdk() as unknown as PluginLister;
  const [present, setPresent] = useState<Presence>(() => fresh(pluginId));
  useEffect(() => {
    let live = true;
    lookUp(sdk, pluginId).then(
      (value) => live && setPresent(value),
      () => live && setPresent(false),
    );
    return () => {
      live = false;
    };
  }, [sdk, pluginId]);
  return present;
}

export const useStudioPresent = (): Presence => usePluginPresent(STUDIO_PLUGIN_ID);
export const useStudioChatPresent = (): Presence => usePluginPresent(STUDIO_CHAT_PLUGIN_ID);
