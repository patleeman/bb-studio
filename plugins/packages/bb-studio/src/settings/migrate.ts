// The one-time move of Studio's settings out of BB's declared settings and
// into Studio's own store (store.ts), on the first load after the upgrade.
//
// BB returns only declared keys from `settings.get()`, so on that load
// Studio declares the old fields once more (LEGACY_SETTINGS), reads them,
// copies every value someone changed, clears the old avatar OpenAI key, sets
// a marker and reloads itself so BB's settings page loses the old fields.
// From then on only the API keys are declared (keys.ts).
//
// The old non-secret values stay in BB's table, unread: if Studio is ever
// rolled back, they are still there. Secret values are never returned,
// logged or compared outside this file.
import type { PluginSettingDescriptor } from "@get-bb/plugin-sdk";
import { LEGACY_OPENAI_KEY_SETTING, openaiKeyMigration, OPENAI_KEY_SETTING } from "../openai-key";
import { checkSetting, STUDIO_SETTINGS, STUDIO_SETTING_KEYS, type SettingValue, type StudioSetting } from "./schema";
import type { SettingsKv, StudioSettingsStore } from "./store";

export const SETTINGS_MIGRATED_KEY = "settings:migrated";

/** Settings that became constants. Their old values aren't carried; the report names any that differed. */
export const RETIRED_SETTINGS: Record<string, PluginSettingDescriptor & { default: SettingValue }> = {
  decisions_typesafeModel: { type: "select", label: "decisions_typesafeModel", options: ["jev-latest", "jev-preview", "jev-1.13.0"], default: "jev-latest" },
  decisions_jevTimeoutMs: { type: "number", label: "decisions_jevTimeoutMs", default: 5000 },
  decisions_steerConfidence: { type: "number", label: "decisions_steerConfidence", default: 0.5 },
  segmentSeconds: { type: "number", label: "segmentSeconds", default: 25 },
  loopTimeZone: { type: "string", label: "loopTimeZone", default: "America/New_York" },
};

const MOVING = "Moving to Studio’s own settings; this field goes away in a moment.";

function legacyDescriptor(key: string, setting: StudioSetting): PluginSettingDescriptor {
  const label = `${setting.label} (${key})`;
  switch (setting.type) {
    case "boolean": return { type: "boolean", label, description: MOVING, default: setting.default };
    case "number": return { type: "number", label, description: MOVING, default: setting.default };
    case "string": return { type: "string", label, description: MOVING, default: setting.default };
    case "select": return { type: "select", label, description: MOVING, options: [...setting.options], default: setting.default };
  }
}

/**
 * The old declarations, as BB needs them to read the stored values: the same
 * types, options and defaults. Declared only on the migrating load.
 */
export const LEGACY_SETTINGS: Record<string, PluginSettingDescriptor> = {
  ...Object.fromEntries(STUDIO_SETTING_KEYS.map((key) => [key, legacyDescriptor(key, STUDIO_SETTINGS[key])])),
  ...RETIRED_SETTINGS,
  [LEGACY_OPENAI_KEY_SETTING]: { type: "string", label: "Old Bot avatars OpenAI key", description: MOVING, secret: true, default: "" },
};

export interface MigrationDeps {
  kv: SettingsKv;
  store: StudioSettingsStore;
  /** The old declarations' handle (LEGACY_SETTINGS). */
  legacy: { get(): Promise<Record<string, unknown>>; experimental_set(values: Record<string, null>): Promise<unknown> };
  /** BB's key fields' handle (keys.ts), for the OpenAI key. */
  keys: { get(): Promise<Record<string, unknown>>; experimental_set(values: Record<string, string>): Promise<unknown> };
}

export interface MigrationReport {
  /** Keys whose values moved into Studio's store. */
  copied: string[];
  /** What happened to the old avatar OpenAI key. */
  openai: "none" | "copied" | "cleared";
  /** Retired settings that weren't at their default; their constant applies now. */
  retiredChanged: string[];
}

/** Whether this load must declare LEGACY_SETTINGS and migrate. */
export async function needsSettingsMigration(kv: SettingsKv): Promise<boolean> {
  return !(await kv.get(SETTINGS_MIGRATED_KEY));
}

/**
 * Copies each old value that differs from its default into Studio's store
 * (unless the store already has one), moves or clears the old avatar OpenAI
 * key, then sets the marker. Runs once: null when the marker is set.
 */
export async function migrateSettings(deps: MigrationDeps): Promise<MigrationReport | null> {
  if (!(await needsSettingsMigration(deps.kv))) return null;
  const old = await deps.legacy.get();
  const already = deps.store.explicit();
  const patch: Record<string, SettingValue> = {};
  for (const key of STUDIO_SETTING_KEYS) {
    if (!Object.hasOwn(old, key) || Object.hasOwn(already, key)) continue;
    const value = old[key];
    if (value === undefined || value === STUDIO_SETTINGS[key].default) continue;
    const checked = checkSetting(key, value);
    if (checked.ok) patch[key] = checked.value;
  }
  if (Object.keys(patch).length) await deps.store.set(patch);

  const keyValues = await deps.keys.get();
  const openai = openaiKeyMigration({ [OPENAI_KEY_SETTING]: keyValues[OPENAI_KEY_SETTING], [LEGACY_OPENAI_KEY_SETTING]: old[LEGACY_OPENAI_KEY_SETTING] });
  const copiedKey = openai.patch[OPENAI_KEY_SETTING];
  if (typeof copiedKey === "string") await deps.keys.experimental_set({ [OPENAI_KEY_SETTING]: copiedKey });
  if (openai.outcome !== "none") await deps.legacy.experimental_set({ [LEGACY_OPENAI_KEY_SETTING]: null });

  const retiredChanged = Object.entries(RETIRED_SETTINGS).filter(([key, descriptor]) => old[key] !== undefined && old[key] !== descriptor.default).map(([key]) => key);
  const report: MigrationReport = { copied: Object.keys(patch), openai: openai.outcome, retiredChanged };
  await deps.kv.set(SETTINGS_MIGRATED_KEY, { at: Date.now(), copied: report.copied, openai: report.openai });
  return report;
}

/** The report in one log line, with key names only. */
export function describeMigration(report: MigrationReport): string {
  const parts = [
    report.copied.length ? `moved ${report.copied.length} settings into Studio's storage (${report.copied.join(", ")})` : "no changed settings to move",
    report.openai === "copied" ? "moved the old Bot avatars OpenAI key into the OpenAI API key and cleared it" : report.openai === "cleared" ? "cleared the old Bot avatars OpenAI key" : null,
    report.retiredChanged.length ? `these are constants now and their changed values no longer apply: ${report.retiredChanged.join(", ")} (see the README for the environment variables)` : null,
  ];
  return `Settings migration: ${parts.filter(Boolean).join("; ")}.`;
}
