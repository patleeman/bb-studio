// One settings handle for Studio's server code, shaped like BB's
// (get, experimental_set, onChange): the API keys come from BB's secret
// fields (keys.ts) and everything else from Studio's own store (store.ts).
// Consumers read the same keys they always did.
import { isStudioSettingKey } from "./schema";
import type { SettingsPatch, StudioSettingsStore } from "./store";

type Values = Record<string, unknown>;

/** The part of BB's PluginSettingsHandle this needs. */
export interface HostSettings {
  get(): Promise<Values>;
  experimental_set(values: Values): Promise<Values>;
  onChange(listener: (next: Values, prev: Values) => void): void;
}

export interface StudioSettingsHandle {
  get(): Promise<Values>;
  /** Routes each key to BB (API keys) or Studio's store; `null` clears a key or restores a default. */
  experimental_set(values: Values): Promise<Values>;
  onChange(listener: (next: Values, prev: Values) => void): void;
  /** The last values read, for code that can't wait. */
  current(): Values;
}

export async function combineSettings(host: HostSettings, store: StudioSettingsStore): Promise<StudioSettingsHandle> {
  let hostValues = await host.get();
  const merged = () => ({ ...hostValues, ...store.current() });
  const listeners = new Set<(next: Values, prev: Values) => void>();
  const emit = (prev: Values) => {
    const next = merged();
    for (const listener of listeners) {
      try { listener(next, prev); } catch { /* one listener can't stop the others */ }
    }
  };
  host.onChange((next) => {
    const prev = merged();
    hostValues = next;
    emit(prev);
  });
  store.onChange((_next, prevStore) => emit({ ...hostValues, ...prevStore }));
  return {
    get: async () => {
      hostValues = await host.get();
      return merged();
    },
    experimental_set: async (values) => {
      const own: SettingsPatch = {};
      const keys: Values = {};
      for (const [key, value] of Object.entries(values)) {
        if (isStudioSettingKey(key)) own[key] = value as SettingsPatch[string];
        else keys[key] = value;
      }
      if (Object.keys(own).length) await store.set(own);
      if (Object.keys(keys).length) hostValues = await host.experimental_set(keys);
      return merged();
    },
    onChange: (listener) => { listeners.add(listener); },
    current: merged,
  };
}
