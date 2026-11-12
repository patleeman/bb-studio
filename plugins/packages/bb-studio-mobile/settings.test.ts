import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "./server.js";
import { Http2ApnsSender } from "./apns.js";
import { LEGACY_KEY_PATH_KEY, LEGACY_MOBILE_SETTINGS, migrateMobileSettings, MOBILE_MIGRATED_KEY, MOBILE_SETTINGS, mobileConstants } from "./settings.js";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function memoryKv() {
  const rows = new Map<string, unknown>();
  return { rows, get: async <T,>(key: string) => rows.get(key) as T | undefined, set: async (key: string, value: unknown) => { rows.set(key, value); } };
}

describe("Studio Mobile's settings", () => {
  it("declares only the APNs key (secret) and its Key ID", () => {
    expect(Object.keys(MOBILE_SETTINGS)).toEqual(["apnsKey", "apnsKeyId"]);
    expect(MOBILE_SETTINGS.apnsKey).toMatchObject({ secret: true });
  });

  it("makes the team ID, bundle ID, environment and Expo URL constants, overridable on the host", () => {
    expect(mobileConstants({})).toEqual({ teamId: "3753DAN98U", bundleId: "nyc.plee.bbgo", environment: "auto", expoPushUrl: "https://exp.host/--/api/v2/push/send" });
    expect(mobileConstants({ BB_MOBILE_APNS_TEAM_ID: "TEAM", BB_MOBILE_BUNDLE_ID: "com.example", BB_MOBILE_APNS_ENVIRONMENT: "development", BB_MOBILE_EXPO_PUSH_URL: "https://expo.test" }))
      .toEqual({ teamId: "TEAM", bundleId: "com.example", environment: "development", expoPushUrl: "https://expo.test" });
    expect(mobileConstants({ BB_MOBILE_APNS_ENVIRONMENT: "nonsense" }).environment).toBe("auto");
  });
});

describe("the one-time migration", () => {
  const legacyDefaults = Object.fromEntries(Object.entries(LEGACY_MOBILE_SETTINGS).map(([key, value]) => [key, value.default]));

  it("moves a readable key file's contents into an empty APNs key, once", async () => {
    const kv = memoryKv();
    const keys = { values: { apnsKey: "", apnsKeyId: "ABC" } as Record<string, unknown>, get: async () => keys.values, experimental_set: vi.fn(async (values: Record<string, string>) => { keys.values = { ...keys.values, ...values }; }) };
    const legacy = { get: async () => ({ ...legacyDefaults, apnsKeyPath: "~/keys/AuthKey.p8" }) };
    const readKeyFile = vi.fn(async () => "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n");
    expect(await migrateMobileSettings({ kv, keys, legacy, readKeyFile })).toEqual({ keyFile: "copied", retiredChanged: [] });
    expect(keys.values.apnsKey).toBe("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
    expect(kv.rows.get(MOBILE_MIGRATED_KEY)).toMatchObject({ keyFile: "copied" });
    expect(await migrateMobileSettings({ kv, keys, legacy, readKeyFile })).toBeNull();
    expect(readKeyFile).toHaveBeenCalledTimes(1);
  });

  it("leaves a set key alone, keeps an unreadable path as a fallback, and names changed retired settings", async () => {
    const set = memoryKv();
    const keys = { get: async () => ({ apnsKey: "pasted" }), experimental_set: vi.fn(async () => {}) };
    expect(await migrateMobileSettings({ kv: set, keys, legacy: { get: async () => ({ ...legacyDefaults, apnsKeyPath: "/k.p8" }) }, readKeyFile: async () => "file" }))
      .toEqual({ keyFile: "key-set", retiredChanged: [] });
    expect(keys.experimental_set).not.toHaveBeenCalled();

    const unreadable = memoryKv();
    const report = await migrateMobileSettings({
      kv: unreadable, keys: { get: async () => ({ apnsKey: "" }), experimental_set: vi.fn(async () => {}) },
      legacy: { get: async () => ({ ...legacyDefaults, apnsKeyPath: "/gone.p8", bundleId: "com.other" }) },
      readKeyFile: async () => { throw new Error("ENOENT"); },
    });
    expect(report).toEqual({ keyFile: "kept-path", retiredChanged: ["bundleId"] });
    expect(unreadable.rows.get(LEGACY_KEY_PATH_KEY)).toBe("/gone.p8");
  });

  it("runs on the first load, then reloads the plugin so the old fields go away", async () => {
    vi.useFakeTimers();
    const reload = vi.fn(async () => ({}));
    const host = createFakePluginHost({ pluginId: "mobile", sdk: { plugins: { reload } as never, threads: { interactions: { list: async () => [] } } } });
    await plugin(host.bb);
    expect(await host.bb.storage.kv.get(MOBILE_MIGRATED_KEY)).toBeTruthy();
    await vi.advanceTimersByTimeAsync(3000);
    expect(reload).toHaveBeenCalledWith({ pluginId: "mobile" });
    await host.harness.lifecycle.dispose();
    // The next load doesn't migrate or reload again.
    const again = createFakePluginHost({ pluginId: "mobile", sdk: { plugins: { reload } as never, threads: { interactions: { list: async () => [] } } } });
    await again.bb.storage.kv.set(MOBILE_MIGRATED_KEY, { at: 1 });
    await plugin(again.bb);
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).toHaveBeenCalledTimes(1);
    await again.harness.lifecycle.dispose();
  });
});

describe("push status and the test push (Studio shows them on BB's Mobile page)", () => {
  it("says what's missing before the key is set", async () => {
    const host = createFakePluginHost({ pluginId: "mobile", sdk: { threads: { interactions: { list: async () => [] } } } });
    await host.bb.storage.kv.set(MOBILE_MIGRATED_KEY, { at: 1 });
    await plugin(host.bb);
    try {
      expect(await host.harness.behavior.callRpc("push_status", null)).toEqual({ ready: false, problem: "APNs key is not set", devices: 0, lastDelivery: null });
      expect(await host.harness.behavior.callRpc("push_test", null)).toEqual({ ok: false, sent: 0, message: "APNs key is not set" });
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("counts phones, sends a test push to each and reports the delivery", async () => {
    const requests: string[] = [];
    vi.spyOn(Http2ApnsSender.prototype, "close").mockImplementation(() => {});
    vi.spyOn(Http2ApnsSender.prototype as any, "session").mockReturnValue({
      request: () => {
        const request = new EventEmitter() as any;
        request.setTimeout = () => {};
        request.setEncoding = () => {};
        request.end = (body: string) => { requests.push(body); request.emit("response", { ":status": 200 }); request.emit("close"); };
        return request;
      },
    });
    const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const host = createFakePluginHost({ pluginId: "mobile", settings: { apnsKey: key, apnsKeyId: "test" }, sdk: { threads: { interactions: { list: async () => [] } } } });
    await host.bb.storage.kv.set(MOBILE_MIGRATED_KEY, { at: 1 });
    await plugin(host.bb);
    try {
      expect(await host.harness.behavior.callRpc("push_test", null)).toMatchObject({ ok: false, sent: 0 });
      await host.bb.storage.kv.set("devices", { ["apns:" + "a".repeat(64)]: Date.now(), ["apns:" + "b".repeat(64)]: Date.now(), "ExponentPushToken[x]": Date.now() });
      expect(await host.harness.behavior.callRpc("push_status", null)).toMatchObject({ ready: true, problem: null, devices: 2, lastDelivery: null });
      expect(await host.harness.behavior.callRpc("push_test", null)).toEqual({ ok: true, sent: 2, message: "Sent to 2 phones." });
      const status = await host.harness.behavior.callRpc("push_status", null) as { lastDelivery: { at: number; sent: number } };
      expect(status.lastDelivery.sent).toBe(2);
      expect(requests).toHaveLength(2);
      expect(JSON.parse(requests[0]!).aps.alert).toMatchObject({ title: "BB Studio", body: "Test push from Studio Mobile. Pushes work." });
    } finally { await host.harness.lifecycle.dispose(); }
  });
});
