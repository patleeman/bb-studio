// Studio's own settings (schema.ts), saved in Studio's key-value storage as
// one record of the values someone set. Unset ones follow their default.
import { checkSetting, effectiveSettings, isStudioSettingKey, type SettingValue, type StudioSettingValues } from "./schema";

export const SETTINGS_KV_KEY = "settings:values";

export interface SettingsKv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export type SettingsPatch = Record<string, SettingValue | null>;
type Listener = (next: StudioSettingValues, prev: StudioSettingValues) => void;

export class StudioSettingsStore {
  private stored: Record<string, SettingValue> = {};
  private values: StudioSettingValues = effectiveSettings({});
  private readonly listeners = new Set<Listener>();
  /** Writes run one at a time, so two quick changes can't drop each other. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly kv: SettingsKv) {}

  async load(): Promise<StudioSettingValues> {
    const raw = await this.kv.get<Record<string, unknown>>(SETTINGS_KV_KEY);
    this.stored = {};
    if (raw && typeof raw === "object") {
      for (const [key, value] of Object.entries(raw)) {
        const checked = checkSetting(key, value);
        if (checked.ok) this.stored[key] = checked.value;
      }
    }
    this.values = effectiveSettings(this.stored);
    return this.values;
  }

  /** The current values, defaults filled in. */
  current(): StudioSettingValues {
    return this.values;
  }

  /** Only the values someone set. */
  explicit(): Readonly<Record<string, SettingValue>> {
    return this.stored;
  }

  /**
   * Checks every value first, then saves them together; `null` puts a setting
   * back to its default. Throws on an unknown key or a bad value, saving none.
   */
  set(patch: SettingsPatch): Promise<StudioSettingValues> {
    const run = this.queue.then(async () => {
      const next = { ...this.stored };
      for (const [key, value] of Object.entries(patch)) {
        if (!isStudioSettingKey(key)) throw new Error(`There's no Studio setting called ${key}.`);
        if (value === null) { delete next[key]; continue; }
        const checked = checkSetting(key, value);
        if (!checked.ok) throw new Error(checked.error);
        next[key] = checked.value;
      }
      await this.kv.set(SETTINGS_KV_KEY, next);
      const prev = this.values;
      this.stored = next;
      this.values = effectiveSettings(next);
      if (JSON.stringify(prev) !== JSON.stringify(this.values)) {
        for (const listener of this.listeners) {
          try { listener(this.values, prev); } catch { /* one listener can't stop the others */ }
        }
      }
      return this.values;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
