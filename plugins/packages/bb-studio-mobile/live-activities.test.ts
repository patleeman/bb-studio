import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { DEVICE_TTL_MS } from "./apns.js";
import { activityTokenSchema, liveActivityPayload, liveActivityPriority, liveActivityPushSchema, LiveActivityTokens, MAX_TOKENS, MAX_TOKENS_PER_DEVICE, MOBILE_MIGRATIONS } from "./live-activities.js";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

function store() {
  const { bb, harness } = createFakePluginHost({ pluginId: "mobile" });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MOBILE_MIGRATIONS);
  let now = 1_700_000_000_000;
  return { tokens: new LiveActivityTokens(db, () => now), tick: (ms: number) => { now += ms; }, db };
}

const hex = (char: string) => char.repeat(64);

describe("LiveActivityTokens", () => {
  it("keeps one token per device, Bot and kind, replacing it on a new registration", () => {
    const x = store();
    x.tokens.register({ deviceId: "phone-0001", botId: "dot", kind: "update", token: hex("a") });
    x.tokens.register({ deviceId: "phone-0001", botId: "dot", kind: "update", token: hex("b") });
    x.tokens.register({ deviceId: "phone-0001", botId: "dot", kind: "push-to-start", token: hex("c") });
    x.tokens.register({ deviceId: "phone-0001", botId: "home", kind: "push-to-start", token: hex("c") });
    expect(x.tokens.forBot("dot", "update").map((each) => each.token)).toEqual([hex("b")]);
    expect(x.tokens.forBot("dot", "push-to-start").map((each) => each.token)).toEqual([hex("c")]);
    expect(x.tokens.forBot("home", "push-to-start").map((each) => each.token)).toEqual([hex("c")]);
  });

  it("unregisters one Bot's kind, one Bot, or the whole device, and leaves other devices alone", () => {
    const x = store();
    for (const deviceId of ["phone-0001", "ipad-00002"]) {
      for (const botId of ["dot", "home"]) for (const kind of ["update", "push-to-start"] as const) x.tokens.register({ deviceId, botId, kind, token: hex(deviceId[0]!) });
    }
    expect(x.tokens.unregister({ deviceId: "phone-0001", botId: "dot", kind: "update" })).toBe(1);
    expect(x.tokens.unregister({ deviceId: "phone-0001", botId: "dot" })).toBe(1);
    expect(x.tokens.unregister({ deviceId: "phone-0001" })).toBe(2);
    expect(x.tokens.unregister({ deviceId: "phone-0001" })).toBe(0);
    expect(x.tokens.all()).toHaveLength(4);
    expect(x.tokens.all().every((each) => each.deviceId === "ipad-00002")).toBe(true);
  });

  it("drops tokens not registered again within the device TTL", () => {
    const x = store();
    x.tokens.register({ deviceId: "phone-0001", botId: "dot", kind: "update", token: hex("a") });
    x.tick(DEVICE_TTL_MS + 1);
    expect(x.tokens.forBot("dot", "update")).toEqual([]);
    expect(x.tokens.all()).toEqual([]);
  });

  it("caps tokens per device and in total, dropping the oldest", () => {
    const x = store();
    for (let n = 0; n < MAX_TOKENS_PER_DEVICE + 3; n++) { x.tokens.register({ deviceId: "phone-0001", botId: `bot${n}`, kind: "update", token: hex("a") }); x.tick(1); }
    const phone = x.tokens.all();
    expect(phone).toHaveLength(MAX_TOKENS_PER_DEVICE);
    expect(phone.some((each) => each.botId === "bot0" || each.botId === "bot2")).toBe(false);
    for (let n = 0; n < MAX_TOKENS + 10; n++) { x.tokens.register({ deviceId: `device-${String(n).padStart(4, "0")}`, botId: "dot", kind: "update", token: hex("b") }); x.tick(1); }
    expect(x.tokens.all()).toHaveLength(MAX_TOKENS);
    expect(x.tokens.all().some((each) => each.deviceId === "phone-0001")).toBe(false);
  });
});

describe("Live Activity payloads", () => {
  const now = 1_700_000_000_123;

  it("builds start, update and end payloads in Apple's shape", () => {
    const start = liveActivityPushSchema.parse({ event: "start", botId: "dot", attributesType: "BotActivityAttributes", attributes: { botId: "dot" }, contentState: { state: "working", workers: 2 }, alert: { title: "Dot", body: "2 workers" } });
    expect(JSON.parse(liveActivityPayload(start, now))).toEqual({ aps: {
      timestamp: 1_700_000_000, event: "start", "content-state": { state: "working", workers: 2 },
      "attributes-type": "BotActivityAttributes", attributes: { botId: "dot" }, alert: { title: "Dot", body: "2 workers" },
    } });
    const update = liveActivityPushSchema.parse({ event: "update", botId: "dot", contentState: { state: "needs" }, staleDate: 1_700_000_900 });
    expect(JSON.parse(liveActivityPayload(update, now))).toEqual({ aps: { timestamp: 1_700_000_000, event: "update", "content-state": { state: "needs" }, "stale-date": 1_700_000_900 } });
    const end = liveActivityPushSchema.parse({ event: "end", botId: "dot", contentState: { state: "idle" }, dismissalDate: 1_700_000_060 });
    expect(JSON.parse(liveActivityPayload(end, now))).toEqual({ aps: { timestamp: 1_700_000_000, event: "end", "content-state": { state: "idle" }, "dismissal-date": 1_700_000_060 } });
    expect([liveActivityPriority(start), liveActivityPriority(update), liveActivityPriority(end)]).toEqual([10, 5, 10]);
    expect(liveActivityPriority(liveActivityPushSchema.parse({ event: "update", botId: "dot", contentState: {}, alert: { title: "Dot", body: "Needs you" } }))).toBe(10);
  });

  it("refuses a payload over APNs' 4 KB and fields an event doesn't use", () => {
    const big = liveActivityPushSchema.parse({ event: "update", botId: "dot", contentState: { line: "x".repeat(4100) } });
    expect(() => liveActivityPayload(big, now)).toThrow(/at most 4096/);
    expect(liveActivityPushSchema.safeParse({ event: "end", botId: "dot", contentState: {}, alert: { title: "a", body: "b" } }).success).toBe(false);
    expect(liveActivityPushSchema.safeParse({ event: "update", botId: "dot", contentState: {}, attributes: {} }).success).toBe(false);
    expect(liveActivityPushSchema.safeParse({ event: "start", botId: "dot", contentState: {}, attributes: {} }).success).toBe(false);
  });

  it("takes tokens as hex, lowercased", () => {
    expect(activityTokenSchema.parse(` ${"AB".repeat(32)} `)).toBe("ab".repeat(32));
    expect(activityTokenSchema.safeParse("zz".repeat(32)).success).toBe(false);
    expect(activityTokenSchema.safeParse("ab".repeat(10)).success).toBe(false);
  });
});
