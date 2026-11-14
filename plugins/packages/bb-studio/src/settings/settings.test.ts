import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginSecretsDir, StudioKeyStore } from "./key-store";
import { settingsCli } from "./cli";
import { combineSettings } from "./handle";
import { STUDIO_KEY_SETTINGS } from "./keys";
import { describeMigration, LEGACY_SETTINGS, migrateSettings, SETTINGS_MIGRATED_KEY } from "./migrate";
import { registerSettings } from "./register";
import { checkSetting, effectiveSettings, parseSettingText, SETTINGS_GROUPS, settingDefaults, STUDIO_SETTINGS, STUDIO_SETTING_KEYS, VISIBLE_SETTING_KEYS } from "./schema";
import { SETTINGS_KV_KEY, StudioSettingsStore } from "./store";
import { decisionsConstants, decisionsDefaults } from "../decisions/settings";
import { loopTimeZone } from "./constants";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function memoryKv(rows = new Map<string, unknown>()) {
  return { rows, get: async <T,>(key: string) => rows.get(key) as T | undefined, set: async (key: string, value: unknown) => { rows.set(key, value); } };
}

/** A BB-like settings handle over a plain object: defaults, then saved values; null unsets. */
function hostHandle(defaults: Record<string, unknown>, saved: Record<string, unknown> = {}) {
  const stored = { ...saved };
  const listeners: ((next: Record<string, unknown>, prev: Record<string, unknown>) => void)[] = [];
  const values = () => ({ ...defaults, ...stored });
  return {
    stored,
    get: async () => values(),
    experimental_set: vi.fn(async (patch: Record<string, unknown>) => {
      const prev = values();
      for (const [key, value] of Object.entries(patch)) { if (value === null) delete stored[key]; else stored[key] = value; }
      for (const listener of listeners) listener(values(), prev);
      return values();
    }),
    onChange: (listener: (next: Record<string, unknown>, prev: Record<string, unknown>) => void) => { listeners.push(listener); },
  };
}

const legacyDefaults = Object.fromEntries(Object.entries(LEGACY_SETTINGS).map(([key, descriptor]) => [key, "default" in descriptor ? descriptor.default : undefined]));

describe("the settings schema", () => {
  it("keeps API keys out of Studio's own settings, and every other setting in one", () => {
    const keys = Object.keys(STUDIO_KEY_SETTINGS);
    expect(keys).toEqual(["openaiApiKey", "decisions_openRouterApiKey", "decisions_typesafeApiKey", "decisions_vercelApiKey", "decisions_zenApiKey", "decisions_customJevApiKey"]);
    for (const descriptor of Object.values(STUDIO_KEY_SETTINGS)) expect(descriptor).toMatchObject({ type: "string", secret: true });
    expect(STUDIO_SETTING_KEYS.filter((key) => keys.includes(key))).toEqual([]);
    expect(STUDIO_SETTING_KEYS.filter((key) => /apikey$/i.test(key))).toEqual([]);
  });

  it("drops the old avatar key, the speech key and the settings that became constants", () => {
    for (const gone of ["botAvatarOpenaiApiKey", "openRouterApiKey", "decisions_typesafeModel", "decisions_jevTimeoutMs", "decisions_steerConfidence", "segmentSeconds", "loopTimeZone"]) {
      expect(STUDIO_SETTING_KEYS).not.toContain(gone);
      expect(Object.keys(STUDIO_KEY_SETTINGS)).not.toContain(gone);
    }
  });

  it("puts every setting in a section, in the planned order, with plain labels", () => {
    expect(SETTINGS_GROUPS.map((group) => group.title)).toEqual(["Voice", "Recordings and calls", "Agent replies", "Threads", "Windows", "Smart Queue model", "Advanced"]);
    const groups = new Set([...SETTINGS_GROUPS.map((group) => group.id), "attention"]);
    for (const key of STUDIO_SETTING_KEYS) {
      expect(groups.has(STUDIO_SETTINGS[key].group)).toBe(true);
      expect(STUDIO_SETTINGS[key].label).not.toMatch(/^(Explore|Speech|Call transcription|Hands-free voice|Smart Queue):/);
    }
    // The new hands-free settings are in Voice; batch confidence stays a field, in Advanced.
    for (const key of ["voiceLiveModel", "voiceLiveVoice", "voiceLiveBackendModel", "voiceLiveMonthlyCapUsd"] as const) expect(STUDIO_SETTINGS[key].group).toBe("voice");
    expect(STUDIO_SETTINGS.decisions_batchConfidence).toMatchObject({ group: "advanced", type: "number" });
    expect(["loopDailyBudget", "loopQuietStart", "loopQuietEnd"].map((key) => STUDIO_SETTINGS[key as keyof typeof STUDIO_SETTINGS].group)).toEqual(["attention", "attention", "attention"]);
    expect(STUDIO_SETTINGS.loopsEnabled.group).toBe("threads");
  });

  it("says what each API key is for, and no label says Jev", () => {
    for (const [key, setting] of Object.entries(STUDIO_KEY_SETTINGS)) {
      expect(setting.description).toMatch(key === "openaiApiKey" ? /^Hands-free voice\./ : /^Smart Queue\b/);
      expect(setting.label).not.toMatch(/Jev/);
    }
    expect(STUDIO_SETTINGS.decisions_jevProvider.label).toBe("Provider");
  });

  it("checks values against type and range, and parses command-line text", () => {
    expect(checkSetting("autoTitle", false)).toEqual({ ok: true, value: false });
    expect(checkSetting("autoTitle", "no")).toMatchObject({ ok: false });
    expect(checkSetting("loopQuietStart", 24)).toMatchObject({ ok: false, error: "loopQuietStart goes from 0 to 23." });
    expect(checkSetting("loopQuietStart", 2.5)).toMatchObject({ ok: false });
    expect(checkSetting("callAudioRetention", "1 day")).toMatchObject({ ok: false });
    expect(checkSetting("nope", 1)).toMatchObject({ ok: false });
    expect(parseSettingText("autoTitle", "off")).toEqual({ ok: true, value: false });
    expect(parseSettingText("decisions_batchConfidence", "1")).toEqual({ ok: true, value: 1 });
    expect(parseSettingText("decisions_batchConfidence", "")).toMatchObject({ ok: false });
    expect(effectiveSettings({ autoTitle: false, loopQuietStart: 99, bogus: 1 })).toMatchObject({ autoTitle: false, loopQuietStart: 22 });
  });
});

describe("Studio's settings store", () => {
  it("saves only what was set, all or nothing, and null restores a default", async () => {
    const kv = memoryKv();
    const store = new StudioSettingsStore(kv);
    await store.load();
    const changes = vi.fn();
    store.onChange(changes);
    await store.set({ autoTitle: false, loopDailyBudget: 3 });
    expect(kv.rows.get(SETTINGS_KV_KEY)).toEqual({ autoTitle: false, loopDailyBudget: 3 });
    expect(store.current()).toMatchObject({ autoTitle: false, loopDailyBudget: 3, autoMeetingNotes: false });
    await expect(store.set({ autoMeetingNotes: true, loopQuietEnd: 30 })).rejects.toThrow("loopQuietEnd goes from 0 to 23.");
    expect(store.current().autoMeetingNotes).toBe(false);
    await expect(store.set({ openaiApiKey: "sk" })).rejects.toThrow("There's no Studio setting called openaiApiKey.");
    await store.set({ autoTitle: null });
    expect(kv.rows.get(SETTINGS_KV_KEY)).toEqual({ loopDailyBudget: 3 });
    expect(changes).toHaveBeenCalledTimes(2);
    const again = new StudioSettingsStore(kv);
    expect((await again.load()).loopDailyBudget).toBe(3);
  });
});

describe("the combined handle Studio's server code reads", () => {
  it("serves API keys from BB and the rest from Studio's store, under the same keys", async () => {
    const host = hostHandle({ openaiApiKey: "" }, { openaiApiKey: "sk-live" });
    const store = new StudioSettingsStore(memoryKv());
    await store.load();
    const settings = await combineSettings(host, store);
    const seen: Record<string, unknown>[] = [];
    settings.onChange((next) => seen.push(next));
    expect(await settings.get()).toMatchObject({ openaiApiKey: "sk-live", autoTitle: true, voiceLiveMonthlyCapUsd: 20 });
    await settings.experimental_set({ voiceLiveModel: "gpt-realtime-2.1", openaiApiKey: "sk-next" });
    expect(host.experimental_set).toHaveBeenCalledWith({ openaiApiKey: "sk-next" });
    expect(store.explicit()).toEqual({ voiceLiveModel: "gpt-realtime-2.1" });
    expect(settings.current()).toMatchObject({ openaiApiKey: "sk-next", voiceLiveModel: "gpt-realtime-2.1" });
    expect(seen.at(-1)).toMatchObject({ voiceLiveModel: "gpt-realtime-2.1", openaiApiKey: "sk-next" });
  });

  it("gives every moved setting's consumer the value set in Studio's store", async () => {
    const store = new StudioSettingsStore(memoryKv());
    await store.load();
    const settings = await combineSettings(hostHandle({}), store);
    // A non-default value for each setting, as a consumer reads it by key.
    const changed = Object.fromEntries(STUDIO_SETTING_KEYS.map((key) => {
      const setting = STUDIO_SETTINGS[key] as { type: string; default: unknown; options?: readonly string[]; max?: number; min?: number };
      const value = setting.type === "boolean" ? !setting.default
        : setting.type === "number" ? (setting.default === setting.max ? setting.min : Math.min(setting.max!, Number(setting.default) + 1))
          : setting.type === "select" ? setting.options!.find((option) => option !== setting.default)
            : (setting as { timeZone?: true }).timeZone ? "Europe/Paris" : `${String(setting.default)}x`;
      return [key, value];
    }));
    await store.set(changed as Record<string, string | number | boolean>);
    const values = await settings.get();
    for (const key of STUDIO_SETTING_KEYS) expect(values[key]).toEqual(changed[key]);
  });

  it("Decisions reads its constants and Studio settings without the prefix", () => {
    expect(decisionsDefaults).toMatchObject({ typesafeModel: "jev-latest", jevTimeoutMs: 5000, steerConfidence: 0.5, batchConfidence: 0.5, jevProvider: "auto", enabled: true });
    expect(decisionsConstants({ STUDIO_JEV_TIMEOUT_MS: "8000", STUDIO_JEV_STEER_CONFIDENCE: "0.7", STUDIO_TYPESAFE_MODEL: "jev-preview" })).toEqual({ typesafeModel: "jev-preview", jevTimeoutMs: 8000, steerConfidence: 0.7 });
    expect(decisionsConstants({ STUDIO_JEV_TIMEOUT_MS: "99999" }).jevTimeoutMs).toBe(5000);
  });

  it("Todos' time zone is the setting, else STUDIO_LOOP_TIME_ZONE, else this Mac's", () => {
    expect(loopTimeZone({}, "America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(loopTimeZone({ STUDIO_LOOP_TIME_ZONE: "Europe/Paris" }, "America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(loopTimeZone({ STUDIO_LOOP_TIME_ZONE: "Europe/Paris" }, "")).toBe("Europe/Paris");
    expect(loopTimeZone({ STUDIO_LOOP_TIME_ZONE: "Europe/Paris" })).toBe("Europe/Paris");
    expect(loopTimeZone({ STUDIO_LOOP_TIME_ZONE: "Mars/Olympus" })).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(loopTimeZone({}, "Mars/Olympus")).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("checks the Todos time zone setting: an IANA zone or empty", () => {
    expect(STUDIO_SETTINGS.todosTimeZone).toMatchObject({ group: "attention", default: "" });
    expect(checkSetting("todosTimeZone", " America/Los_Angeles ")).toEqual({ ok: true, value: "America/Los_Angeles" });
    expect(checkSetting("todosTimeZone", "")).toEqual({ ok: true, value: "" });
    expect(checkSetting("todosTimeZone", "Mars/Olympus")).toMatchObject({ ok: false, error: "Mars/Olympus isn't a time zone, such as America/Los_Angeles." });
  });
});

describe("the one-time migration", () => {
  function deps(saved: Record<string, unknown>, keySaved: Record<string, unknown> = {}) {
    const kv = memoryKv();
    const store = new StudioSettingsStore(kv);
    const legacy = hostHandle(legacyDefaults, saved);
    const keys = hostHandle({ openaiApiKey: "" }, keySaved);
    return { kv, store, legacy, keys };
  }

  it("carries every changed value over under the same key, keeps defaults unset, and runs once", async () => {
    const d = deps({ autoTitle: false, loopDailyBudget: 3, loopQuietStart: 23, explore_replyItems: "👍 Yes", voiceLiveMonthlyCapUsd: 35, voiceLiveVoice: "cedar", decisions_batchConfidence: 1, callTranscription: "Home server", callServerUrl: "http://homelab:8000", snapshotsPerPage: 50, loopsEnabled: true });
    await d.store.load();
    const report = await migrateSettings(d);
    expect(report?.copied.sort()).toEqual(["autoTitle", "callServerUrl", "callTranscription", "decisions_batchConfidence", "explore_replyItems", "loopDailyBudget", "loopQuietStart", "loopsEnabled", "voiceLiveMonthlyCapUsd", "voiceLiveVoice"].sort());
    expect(d.store.current()).toMatchObject({ autoTitle: false, loopDailyBudget: 3, loopQuietStart: 23, explore_replyItems: "👍 Yes", voiceLiveMonthlyCapUsd: 35, decisions_batchConfidence: 1, callTranscription: "Home server", loopsEnabled: true, snapshotsPerPage: 50 });
    // snapshotsPerPage was at its default, so it follows the default.
    expect(d.store.explicit()).not.toHaveProperty("snapshotsPerPage");
    expect(d.kv.rows.get(SETTINGS_MIGRATED_KEY)).toMatchObject({ copied: report!.copied });
    // The old values stay in BB's table for a rollback.
    expect(d.legacy.stored).toMatchObject({ autoTitle: false, loopDailyBudget: 3 });
    // Run once: a later load does nothing, even when the old values differ.
    d.legacy.stored.autoTitle = true;
    expect(await migrateSettings(d)).toBeNull();
    expect(d.store.current().autoTitle).toBe(false);
  });

  it("clears the old avatar OpenAI key without copying it over the current key, and never reports the key", async () => {
    const d = deps({ botAvatarOpenaiApiKey: "sk-old-secret" }, { openaiApiKey: "sk-current-secret" });
    await d.store.load();
    const report = await migrateSettings(d);
    expect(report?.openai).toBe("cleared");
    expect(d.legacy.stored).not.toHaveProperty("botAvatarOpenaiApiKey");
    expect(d.legacy.experimental_set).toHaveBeenCalledWith({ botAvatarOpenaiApiKey: null });
    expect(d.keys.stored.openaiApiKey).toBe("sk-current-secret");
    expect(d.keys.experimental_set).not.toHaveBeenCalled();
    const text = `${JSON.stringify(report)} ${describeMigration(report!)} ${JSON.stringify([...d.kv.rows.values()])}`;
    expect(text).not.toContain("sk-");
  });

  it("moves the old avatar key into an empty OpenAI key, then clears it", async () => {
    const d = deps({ botAvatarOpenaiApiKey: "sk-old" });
    await d.store.load();
    expect((await migrateSettings(d))?.openai).toBe("copied");
    expect(d.keys.stored.openaiApiKey).toBe("sk-old");
    expect(d.legacy.stored).not.toHaveProperty("botAvatarOpenaiApiKey");
  });

  it("names retired settings whose changed values no longer apply", async () => {
    const d = deps({ decisions_jevTimeoutMs: 8000, segmentSeconds: 25 });
    await d.store.load();
    const report = await migrateSettings(d);
    expect(report?.retiredChanged).toEqual(["decisions_jevTimeoutMs"]);
    expect(describeMigration(report!)).toContain("decisions_jevTimeoutMs");
  });

  it("doesn't overwrite a value already in Studio's store", async () => {
    const d = deps({ autoTitle: false });
    await d.store.load();
    await d.store.set({ autoTitle: true });
    expect((await migrateSettings(d))?.copied).toEqual([]);
    expect(d.store.current().autoTitle).toBe(true);
  });
});

describe("Studio's API key files", () => {
  it("reads and writes BB's secret files, 0600, one key per file, and refuses keys it doesn't have", async () => {
    const dir = pluginSecretsDir(mkdtempSync(join(tmpdir(), "studio-keys-")), "studio");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "openaiApiKey"), "sk-saved");
    const keys = new StudioKeyStore(dir, ["openaiApiKey", "decisions_zenApiKey"]);
    expect(await keys.get()).toEqual({ openaiApiKey: "sk-saved", decisions_zenApiKey: "" });
    const changes = vi.fn();
    keys.onChange(changes);
    await keys.experimental_set({ decisions_zenApiKey: "  zen-key  " });
    expect(readFileSync(join(dir, "decisions_zenApiKey"), "utf8")).toBe("zen-key");
    expect(statSync(join(dir, "decisions_zenApiKey")).mode & 0o777).toBe(0o600);
    expect(await keys.status()).toEqual({ openaiApiKey: true, decisions_zenApiKey: true });
    await keys.experimental_set({ openaiApiKey: null, decisions_zenApiKey: "" });
    expect(existsSync(join(dir, "openaiApiKey"))).toBe(false);
    expect(existsSync(join(dir, "decisions_zenApiKey"))).toBe(false);
    expect(changes).toHaveBeenCalledTimes(2);
    await expect(keys.experimental_set({ autoTitle: "x" })).rejects.toThrow("There's no Studio API key called autoTitle.");
  });
});

describe("registerSettings on a host", () => {
  const plugin = (sdk: object = {}) => {
    const reload = vi.fn(async () => ({}));
    const dataDir = mkdtempSync(join(tmpdir(), "studio-settings-"));
    mkdirSync(pluginSecretsDir(dataDir, "studio"), { recursive: true });
    writeFileSync(join(pluginSecretsDir(dataDir, "studio"), "openaiApiKey"), "sk-new");
    const host = createFakePluginHost({
      pluginId: "studio",
      dataDir,
      settings: { autoTitle: false, loopQuietEnd: 6, emojiItems: "👍 Yes", botAvatarOpenaiApiKey: "sk-old" },
      sdk: { plugins: { reload, list: async () => ({ plugins: [] }) } as never, ...sdk },
    });
    return { host, reload, dataDir };
  };

  it("migrates on the first load, reloads itself once, then declares no BB settings", async () => {
    vi.useFakeTimers();
    const { host, reload } = plugin();
    const { settings } = await registerSettings(host.bb, "studio");
    expect(await settings.get()).toMatchObject({ autoTitle: false, loopQuietEnd: 6, emojiItems: "👍 Yes", openaiApiKey: "sk-new" });
    expect(host.harness.inspection.logEntries.map((entry) => entry.message).join("\n")).not.toContain("sk-");
    await vi.advanceTimersByTimeAsync(3000);
    expect(reload).toHaveBeenCalledWith({ pluginId: "studio" });

    const next = await host.harness.lifecycle.reload(async (bb: BbPluginApi) => {
      const again = await registerSettings(bb, "studio");
      expect(await again.settings.get()).toMatchObject({ autoTitle: false, loopQuietEnd: 6, openaiApiKey: "sk-new" });
      // Only the migrating load declared the old fields, so they can be declared here; the old avatar key is cleared.
      expect(await bb.settings.define({ botAvatarOpenaiApiKey: LEGACY_SETTINGS.botAvatarOpenaiApiKey! }).get()).toEqual({ botAvatarOpenaiApiKey: "" });
      expect((await bb.settings.define({ autoMeetingNotes: LEGACY_SETTINGS.autoMeetingNotes! }).get())).toEqual({ autoMeetingNotes: false });
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).toHaveBeenCalledTimes(1);
    await next.harness.lifecycle.dispose();
  });

  it("serves settings.get and settings.set, and tells open windows when they change", async () => {
    const { host } = plugin();
    await registerSettings(host.bb, "studio");
    const got = await host.harness.behavior.callRpc("settings.get", null) as { values: Record<string, unknown>; changed: string[]; timeZone: string };
    expect(got.values).toMatchObject({ autoTitle: false, loopQuietEnd: 6 });
    expect(got.values).not.toHaveProperty("openaiApiKey");
    expect(got.changed.sort()).toEqual(["autoTitle", "emojiItems", "loopQuietEnd"]);
    expect(got.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const zoned = await host.harness.behavior.callRpc("settings.set", { values: { todosTimeZone: "America/Los_Angeles" } }) as { timeZone: string; defaultTimeZone: string };
    expect(zoned).toMatchObject({ timeZone: "America/Los_Angeles", defaultTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    expect((await host.harness.behavior.callRpc("settings.get", null) as { timeZone: string }).timeZone).toBe("America/Los_Angeles");
    await expect(host.harness.behavior.callRpc("settings.set", { values: { todosTimeZone: "Mars/Olympus" } })).rejects.toThrow();
    await host.harness.behavior.callRpc("settings.set", { values: { todosTimeZone: null } });
    const before = host.harness.inspection.realtimeSignals.length;
    const set = await host.harness.behavior.callRpc("settings.set", { values: { loopDailyBudget: 2, autoTitle: null } }) as { values: Record<string, unknown> };
    expect(set.values).toMatchObject({ loopDailyBudget: 2, autoTitle: true });
    expect(host.harness.inspection.realtimeSignals.slice(before)).toEqual([expect.objectContaining({ channel: "studio-settings" })]);
    await expect(host.harness.behavior.callRpc("settings.set", { values: { openaiApiKey: "sk" } })).rejects.toThrow();
    await host.harness.lifecycle.dispose();
  });

  it("serves the API keys' labels and whether each is set, never a key, and saves them in BB's secret files", async () => {
    const { host, dataDir } = plugin();
    await host.bb.storage.kv.set(SETTINGS_MIGRATED_KEY, { at: 1 });
    const { settings } = await registerSettings(host.bb, "studio");
    const got = await host.harness.behavior.callRpc("settings.keys.get", null) as { keys: { key: string; label: string; set: boolean }[] };
    expect(got.keys.map((entry) => entry.key)).toEqual(Object.keys(STUDIO_KEY_SETTINGS));
    expect(got.keys.find((entry) => entry.key === "openaiApiKey")).toMatchObject({ label: "OpenAI API key", set: true });
    expect(JSON.stringify(got)).not.toContain("sk-new");
    const before = host.harness.inspection.realtimeSignals.length;
    const set = await host.harness.behavior.callRpc("settings.keys.set", { values: { decisions_typesafeApiKey: "ts-key" } }) as { keys: { key: string; set: boolean }[] };
    expect(set.keys.find((entry) => entry.key === "decisions_typesafeApiKey")?.set).toBe(true);
    expect(JSON.stringify(set)).not.toContain("ts-key");
    expect(readFileSync(join(pluginSecretsDir(dataDir, "studio"), "decisions_typesafeApiKey"), "utf8")).toBe("ts-key");
    expect(settings.current()).toMatchObject({ decisions_typesafeApiKey: "ts-key", openaiApiKey: "sk-new" });
    expect(host.harness.inspection.realtimeSignals.slice(before)).toEqual([expect.objectContaining({ channel: "studio-settings" })]);
    await expect(host.harness.behavior.callRpc("settings.keys.set", { values: { autoTitle: "x" } })).rejects.toThrow();
    await host.harness.lifecycle.dispose();
  });

  it("says the Mobile plugin isn't installed, and asks it for status and a test push when it is", async () => {
    const { host } = plugin();
    await registerSettings(host.bb, "studio");
    expect(await host.harness.behavior.callRpc("mobile.push.status", null)).toMatchObject({ installed: false, ready: false });
    expect(await host.harness.behavior.callRpc("mobile.push.test", null)).toMatchObject({ ok: false });
    await host.harness.lifecycle.dispose();

    const callRpc = vi.fn(async ({ method }: { method: string }) => method === "push_status"
      ? { ready: true, problem: null, devices: 2, lastDelivery: { at: 1, sent: 2 } }
      : { ok: true, sent: 2, message: "Sent to 2 phones." });
    const mobile = createFakePluginHost({ pluginId: "studio", sdk: { plugins: { list: async () => ({ plugins: [{ id: "mobile", enabled: true }] }), callRpc, reload: async () => ({}) } as never } });
    await mobile.bb.storage.kv.set(SETTINGS_MIGRATED_KEY, { at: 1 });
    await registerSettings(mobile.bb, "studio");
    expect(await mobile.harness.behavior.callRpc("mobile.push.status", null)).toEqual({ installed: true, ready: true, problem: null, devices: 2, lastDelivery: { at: 1, sent: 2 } });
    expect(await mobile.harness.behavior.callRpc("mobile.push.test", null)).toEqual({ ok: true, sent: 2, message: "Sent to 2 phones." });
    expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "mobile", method: "push_test" }));
    await mobile.harness.lifecycle.dispose();
  });
});

describe("bb studio settings", () => {
  async function storeWith(values: Record<string, unknown> = {}) {
    const store = new StudioSettingsStore(memoryKv(new Map([[SETTINGS_KV_KEY, values]])));
    await store.load();
    return store;
  }

  it("lists every setting by section, marking defaults, and points at the API keys", async () => {
    const out = await settingsCli([], await storeWith({ autoTitle: false }));
    expect(out.exitCode).toBe(0);
    const text = out.stdout!;
    for (const title of ["Voice", "Recordings and calls", "Agent replies", "Threads", "Smart Queue model", "Advanced", "Attention (Bot ▸ Controls)"]) expect(text).toContain(`${title}\n`);
    expect(text).toMatch(/ {2}autoTitle +false\n/);
    expect(text).toMatch(/ {2}autoMeetingNotes +false {2}\(default\)\n/);
    expect(text).toContain("API keys: Settings ▸ Studio ▸ API keys, or their environment variables.");
    expect(text.indexOf("Voice\n")).toBeLessThan(text.indexOf("Recordings and calls\n"));
    for (const key of VISIBLE_SETTING_KEYS) expect(text).toContain(`  ${key} `);
    expect(text).not.toContain("desktopControl");
    const json = JSON.parse((await settingsCli(["list", "--json"], await storeWith())).stdout!) as { key: string; changed: boolean }[];
    expect(json.map((row) => row.key)).toEqual(VISIBLE_SETTING_KEYS);
    expect((await settingsCli(["set", "desktopControl", "true"], await storeWith())).exitCode).toBe(1);
  });

  it("gets, sets and resets one setting, checking its type", async () => {
    const store = await storeWith();
    expect(await settingsCli(["get", "loopDailyBudget"], store)).toEqual({ exitCode: 0, stdout: "5\n" });
    expect(await settingsCli(["set", "loopDailyBudget", "3"], store)).toEqual({ exitCode: 0, stdout: "loopDailyBudget = 3\n" });
    expect(await settingsCli(["set", "autoTitle", "off"], store)).toEqual({ exitCode: 0, stdout: "autoTitle = false\n" });
    expect(await settingsCli(["set", "explore_replyItems", "👍", "Yes,", "❓", "Why"], store)).toEqual({ exitCode: 0, stdout: "explore_replyItems = \"👍 Yes, ❓ Why\"\n" });
    expect(store.current()).toMatchObject({ loopDailyBudget: 3, autoTitle: false });
    expect(JSON.parse((await settingsCli(["get", "autoTitle", "--json"], store)).stdout!)).toEqual({ key: "autoTitle", value: false, default: true, changed: true });
    expect(await settingsCli(["reset", "autoTitle"], store)).toEqual({ exitCode: 0, stdout: "autoTitle = true (default)\n" });
    const bad = await settingsCli(["set", "loopQuietStart", "25"], store);
    expect(bad).toMatchObject({ exitCode: 1 });
    expect(bad.stderr).toBe("loopQuietStart goes from 0 to 23.\n");
    expect((await settingsCli(["set", "callAudioRetention", "1 day"], store)).stderr).toContain("one of: 7 days, 30 days, Forever");
    expect((await settingsCli(["get", "openaiApiKey"], store)).stderr).toContain("There's no Studio setting called openaiApiKey.");
    expect((await settingsCli(["frob"], store))).toMatchObject({ exitCode: 1 });
    expect(settingDefaults().loopDailyBudget).toBe(5);
  });
});
