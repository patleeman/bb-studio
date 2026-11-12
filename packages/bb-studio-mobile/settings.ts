// Studio Mobile's settings after the settings cleanup: only the APNs key
// (secret) and its Key ID are BB settings. The team ID, bundle ID, APNs
// environment and Expo URL are constants a BB host can override with an
// environment variable. The key file path folded into the key: on the first
// load after the upgrade, a readable file's contents move into the key.
//
// BB returns only declared keys, so that load declares the old fields once
// more (LEGACY_MOBILE_SETTINGS), migrates, sets a marker and reloads the
// plugin so BB's settings page drops them. Key contents are never logged.
import type { PluginSettingDescriptor } from "@get-bb/plugin-sdk";

export const MOBILE_SETTINGS = {
  apnsKey: {
    type: "string",
    label: "APNs key",
    description: "Paste the .p8 key from Apple; line breaks are optional. It stays secret on the BB server.",
    secret: true,
  },
  apnsKeyId: { type: "string", label: "Key ID", description: "The 10-character ID Apple shows next to the key.", default: "" },
} as const satisfies Record<string, PluginSettingDescriptor>;

const MOVING = "Moving out of Studio Mobile’s settings; this field goes away in a moment.";
export const LEGACY_MOBILE_SETTINGS = {
  apnsKeyPath: { type: "string", label: "APNs auth key file (moving)", description: MOVING, default: "" },
  apnsTeamId: { type: "string", label: "Apple team ID (moving)", description: MOVING, default: "3753DAN98U" },
  bundleId: { type: "string", label: "App bundle ID (moving)", description: MOVING, default: "nyc.plee.bbgo" },
  apnsEnvironment: { type: "select", label: "APNs environment (moving)", description: MOVING, options: ["auto", "production", "development"], default: "auto" },
  expoPushUrl: { type: "string", label: "Expo push URL (moving)", description: MOVING, default: "https://exp.host/--/api/v2/push/send" },
} as const satisfies Record<string, PluginSettingDescriptor>;

export type ApnsEnvironment = "auto" | "production" | "development";

/** The settings that became constants, with the host's overrides. */
export function mobileConstants(env: NodeJS.ProcessEnv = process.env) {
  const environment = env.BB_MOBILE_APNS_ENVIRONMENT?.trim();
  return {
    teamId: env.BB_MOBILE_APNS_TEAM_ID?.trim() || LEGACY_MOBILE_SETTINGS.apnsTeamId.default,
    bundleId: env.BB_MOBILE_BUNDLE_ID?.trim() || LEGACY_MOBILE_SETTINGS.bundleId.default,
    environment: (environment === "production" || environment === "development" ? environment : "auto") as ApnsEnvironment,
    expoPushUrl: env.BB_MOBILE_EXPO_PUSH_URL?.trim() || LEGACY_MOBILE_SETTINGS.expoPushUrl.default,
  };
}

export const MOBILE_MIGRATED_KEY = "settings:migrated";
/** A key file path that couldn't be read during the migration; still tried when the key is empty. */
export const LEGACY_KEY_PATH_KEY = "settings:apns-key-path";

export interface MobileMigrationDeps {
  kv: { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> };
  keys: { get(): Promise<Record<string, unknown>>; experimental_set(values: Record<string, string>): Promise<unknown> };
  legacy: { get(): Promise<Record<string, unknown>> };
  readKeyFile(path: string): Promise<string>;
}

export interface MobileMigrationReport {
  /** "copied": the key file's contents are the key now; "kept-path": unreadable, so its path is kept as a fallback. */
  keyFile: "none" | "copied" | "kept-path" | "key-set";
  /** Retired settings that weren't at their default; their constant (or environment variable) applies now. */
  retiredChanged: string[];
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Runs once: null when the marker is set. */
export async function migrateMobileSettings(deps: MobileMigrationDeps): Promise<MobileMigrationReport | null> {
  if (await deps.kv.get(MOBILE_MIGRATED_KEY)) return null;
  const old = await deps.legacy.get();
  const path = text(old.apnsKeyPath);
  let keyFile: MobileMigrationReport["keyFile"] = "none";
  if (path) {
    if (text((await deps.keys.get()).apnsKey)) keyFile = "key-set";
    else {
      const contents = await deps.readKeyFile(path).then(text, () => "");
      if (contents) {
        await deps.keys.experimental_set({ apnsKey: contents });
        keyFile = "copied";
      } else {
        await deps.kv.set(LEGACY_KEY_PATH_KEY, path);
        keyFile = "kept-path";
      }
    }
  }
  const retiredChanged = (["apnsTeamId", "bundleId", "apnsEnvironment", "expoPushUrl"] as const)
    .filter((key) => old[key] !== undefined && old[key] !== LEGACY_MOBILE_SETTINGS[key].default);
  await deps.kv.set(MOBILE_MIGRATED_KEY, { at: Date.now(), keyFile });
  return { keyFile, retiredChanged };
}

export function describeMobileMigration(report: MobileMigrationReport): string {
  const parts = [
    report.keyFile === "copied" ? "moved the APNs key file's contents into the APNs key" : report.keyFile === "kept-path" ? "couldn't read the APNs key file, so its path stays as a fallback; paste the key into APNs key" : null,
    report.retiredChanged.length ? `these are constants now and their changed values no longer apply: ${report.retiredChanged.join(", ")} (set BB_MOBILE_APNS_TEAM_ID, BB_MOBILE_BUNDLE_ID, BB_MOBILE_APNS_ENVIRONMENT or BB_MOBILE_EXPO_PUSH_URL on the BB host)` : null,
  ].filter(Boolean);
  return `Settings migration: ${parts.join("; ") || "nothing to move"}.`;
}
