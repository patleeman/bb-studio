// Studio's settings on the server: the API keys (keys.ts, key-store.ts), Studio's own
// store (store.ts), the one-time migration (migrate.ts), the RPCs the
// settings sections and the iOS app use (contract.ts), and the push status
// Studio shows for the Mobile plugin.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { errorMessage } from "../kit/format";
import { settingsContract, pushStatusSchema, pushTestSchema, type PushStatus } from "./contract";
import { combineSettings, type StudioSettingsHandle } from "./handle";
import { STUDIO_KEY_SETTINGS } from "./keys";
import { pluginSecretsDir, StudioKeyStore } from "./key-store";
import { describeMigration, LEGACY_SETTINGS, migrateSettings, needsSettingsMigration } from "./migrate";
import { StudioSettingsStore } from "./store";
import { isHiddenSetting, SETTINGS_CHANNEL } from "./schema";
import { desktopHudEnabled } from "../desktop/gate";
import { loopTimeZone } from "./constants";

const MOBILE_PLUGIN_ID = "mobile";
/** After a migration, Studio reloads itself this long after loading, so BB's page drops the old fields. */
const RELOAD_AFTER_MIGRATION_MS = 3000;

export interface StudioSettings {
  settings: StudioSettingsHandle;
  store: StudioSettingsStore;
}

export async function registerSettings(bb: BbPluginApi, pluginId: string): Promise<StudioSettings> {
  const keys = new StudioKeyStore(pluginSecretsDir(bb.server.experimental_dataDir, pluginId), Object.keys(STUDIO_KEY_SETTINGS));
  await keys.get();
  const store = new StudioSettingsStore(bb.storage.kv);
  await store.load();
  if (await needsSettingsMigration(bb.storage.kv)) {
    // The old fields, declared for this load only, so BB returns their values.
    const legacy = bb.settings.define(LEGACY_SETTINGS);
    try {
      const report = await migrateSettings({
        kv: bb.storage.kv,
        store,
        legacy: { get: () => legacy.get(), experimental_set: (values) => legacy.experimental_set(values as never) },
        keys: { get: () => keys.get(), experimental_set: (values) => keys.experimental_set(values as never) },
      });
      if (report) {
        bb.log.info(describeMigration(report));
        const timer = setTimeout(() => {
          void Promise.resolve().then(() => bb.sdk.plugins.reload({ pluginId })).catch((error) => bb.log.warn(`Settings moved; reload Studio to hide the old fields (${errorMessage(error)}).`));
        }, RELOAD_AFTER_MIGRATION_MS);
        timer.unref?.();
        bb.onDispose(() => clearTimeout(timer));
      }
    } catch (error) {
      // No marker: the next load tries again, and nothing was lost meanwhile.
      bb.log.warn(`Couldn't move Studio's settings into its own storage; trying again next load: ${errorMessage(error)}`);
    }
  }
  const settings = await combineSettings(keys, store);
  store.onChange(() => void bb.realtime.publish(SETTINGS_CHANNEL, {}));
  keys.onChange(() => void bb.realtime.publish(SETTINGS_CHANNEL, {}));

  const desktopControl = desktopHudEnabled(process.env);
  const apiKeys = async () => {
    const set = await keys.status();
    return { keys: Object.entries(STUDIO_KEY_SETTINGS).map(([key, setting]) => ({ key, label: setting.label, description: setting.description, set: set[key] === true })) };
  };
  const answer = () => ({ values: { ...store.current(), desktopControl }, changed: Object.keys(store.explicit()).filter((key) => !isHiddenSetting(key)) });
  const mobile = async <T>(method: string, outputSchema: z.ZodType<T>): Promise<T | null> => {
    const { plugins } = await bb.sdk.plugins.list();
    const plugin = plugins.find((each) => each.id === MOBILE_PLUGIN_ID) as { id: string; enabled?: boolean } | undefined;
    if (!plugin || plugin.enabled === false) return null;
    return bb.sdk.plugins.callRpc({ pluginId: MOBILE_PLUGIN_ID, method, input: null, outputSchema, signal: AbortSignal.timeout(20_000) });
  };
  const notInstalled: PushStatus = { installed: false, ready: false, problem: "Install the Studio Mobile plugin to send pushes to the BB Studio app.", devices: 0, lastDelivery: null };

  bb.rpc.register(settingsContract, {
    "settings.get": async () => ({ ...answer(), timeZone: loopTimeZone() }),
    "settings.set": async ({ values }) => {
      await store.set(Object.fromEntries(Object.entries(values).filter(([key]) => !isHiddenSetting(key))));
      return answer();
    },
    "settings.keys.get": () => apiKeys(),
    "settings.keys.set": async ({ values }) => {
      await keys.experimental_set(values);
      return apiKeys();
    },
    "mobile.push.status": async () => {
      try {
        const status = await mobile("push_status", pushStatusSchema.omit({ installed: true }));
        return status ? { installed: true, ...status } : notInstalled;
      } catch (error) {
        return { installed: true, ready: false, problem: `The Mobile plugin didn't answer: ${errorMessage(error)}`, devices: 0, lastDelivery: null };
      }
    },
    "mobile.push.test": async () => {
      try {
        return (await mobile("push_test", pushTestSchema)) ?? { ok: false, sent: 0, message: notInstalled.problem! };
      } catch (error) {
        return { ok: false, sent: 0, message: errorMessage(error) };
      }
    },
  });
  return { settings, store };
}
