import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { generateKeyPairSync, verify } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "./server.js";
import { DEVICE_TTL_MS, Http2ApnsSender, type ExpoMessage } from "./apns.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function setup() {
  const host = createFakePluginHost({
    pluginId: "mobile",
    sdk: { threads: { interactions: { list: async () => [] } } },
  });
  await plugin(host.bb);
  const forwarded: ExpoMessage[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const messages = JSON.parse(String(init.body)) as ExpoMessage[];
    forwarded.push(messages);
    return Response.json({ data: messages.map((message) => ({ status: "ok", id: message.to })) });
  }));
  const push = async (messages: ExpoMessage[]) => {
    const response = await host.harness.behavior.fetchHttp("POST", "/push", {
      body: JSON.stringify(messages), headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(200);
    return response.json();
  };
  return { ...host, forwarded, push };
}

describe("push relay", () => {
  it("does not refresh muted device timestamps past their TTL", async () => {
    const host = await setup();
    try {
      const to = "apns:" + "ab".repeat(32);
      await host.bb.storage.kv.set("devices", { [to]: Date.now() - DEVICE_TTL_MS - 1 });
      await host.harness.behavior.callRpc("mute_set", { threadId: "thr_muted", muted: true });
      expect(await host.push([{ to, body: "Done", data: { threadId: "thr_muted" } }])).toEqual({ data: [{ status: "ok" }] });
      expect(await host.bb.storage.kv.get("devices")).toEqual({});
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("persists one server identity across reloads", async () => {
    const host = await setup();
    try {
      const identity = await (await host.harness.behavior.fetchHttp("GET", "/identity")).json();
      expect(identity).toEqual({ serverId: expect.any(String) });
      await host.harness.lifecycle.reload(plugin);
      expect(await (await host.harness.behavior.fetchHttp("GET", "/identity")).json()).toEqual(identity);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("does not report failed APNs delivery as a send", async () => {
    const host = await setup();
    try {
      await host.bb.storage.kv.set("devices", { "apns:phone": Date.now() });
      expect(await host.harness.behavior.callRpc("notify", {
        title: "Result", body: "Useful result", kind: "turn-finished", threadId: "thr_a", projectId: "proj_demo",
      })).toEqual({ ok: true, sent: 0 });
    } finally { await host.harness.lifecycle.dispose(); }
  });
  it("acknowledges quiet APNs and Expo messages without delivering or remembering them", async () => {
    const host = await setup();
    try {
      expect(await host.push([
        { to: "apns:quiet", body: "", data: { kind: "turn-finished", threadId: "thr_quiet" } },
        { to: "ExponentPushToken[quiet]", body: " \n", data: { kind: "turn-finished" } },
      ])).toEqual({ data: [{ status: "ok" }, { status: "ok" }] });
      expect(host.forwarded).toEqual([]);
      expect(await host.bb.storage.kv.get("devices")).toEqual({});
      expect(await host.bb.storage.kv.get("notified-threads")).toBeUndefined();
      expect(await host.bb.storage.kv.get("last-delivery")).toMatchObject({ apns: 0, expo: 0, errors: [] });
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("preserves ticket ordering and delivers useful replies, questions, and errors in a mixed batch", async () => {
    const host = await setup();
    try {
      const messages: ExpoMessage[] = [
        { to: "ExponentPushToken[quiet]", body: "", data: { kind: "turn-finished" } },
        { to: "ExponentPushToken[result]", body: "Found a regression.", data: { kind: "turn-finished" } },
        { to: "apns:quiet", body: "\t", data: { kind: "turn-finished" } },
        { to: "ExponentPushToken[question]", body: "", data: { kind: "pending-interaction" } },
        { to: "ExponentPushToken[error]", body: "", data: { kind: "thread-error" } },
        { to: "apns:result", body: "Found a regression.", data: { kind: "turn-finished" } },
      ];
      expect(await host.push(messages)).toEqual({ data: [
        { status: "ok" }, { status: "ok", id: messages[1]!.to }, { status: "ok" },
        { status: "ok", id: messages[3]!.to }, { status: "ok", id: messages[4]!.to },
        { status: "error", message: "APNs key is not set", details: { error: "MobilePluginNotConfigured" } },
      ] });
      expect(host.forwarded).toEqual([[messages[1], messages[3], messages[4]]]);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("reports zero sends for quiet plugin notifications", async () => {
    const host = await setup();
    try {
      await host.bb.storage.kv.set("devices", { "apns:phone": Date.now() });
      expect(await host.harness.behavior.callRpc("notify", {
        title: "Check complete", body: "\t", kind: "turn-finished", threadId: "thr_quiet", projectId: "proj_demo",
      })).toEqual({ ok: true, sent: 0 });
      expect(host.forwarded).toEqual([]);
      expect(await host.bb.storage.kv.get("last-delivery")).toBeUndefined();
    } finally { await host.harness.lifecycle.dispose(); }
  });
});

function recordingSession() {
  const requests: Array<{ headers: Record<string, string>; body: string }> = [];
  vi.spyOn(Http2ApnsSender.prototype, "close").mockImplementation(() => {});
  vi.spyOn(Http2ApnsSender.prototype as any, "session").mockReturnValue({
    request: (headers: Record<string, string>) => {
      const request = new EventEmitter() as any;
      request.setTimeout = () => {};
      request.setEncoding = () => {};
      request.end = (body: string) => {
        requests.push({ headers, body });
        request.emit("response", { ":status": 200 });
        request.emit("close");
      };
      return request;
    },
  });
  return requests;
}

async function configuredHost() {
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const host = createFakePluginHost({ pluginId: "mobile", settings: { apnsKey: key, apnsKeyId: "test", apnsEnvironment: "production" },
    sdk: { threads: { interactions: { list: async () => [] } } },
  });
  await plugin(host.bb);
  return host;
}

describe("notify", () => {
  it("replaces the signing token when an equal-length PEM changes", async () => {
    const requests = recordingSession();
    const host = await configuredHost();
    try {
      await host.bb.storage.kv.set("devices", { ["apns:" + "a".repeat(64)]: Date.now() });
      const input = { title: "Build", body: "Running", kind: "turn-finished", threadId: "thr_a", projectId: "proj_demo" } as const;
      await host.harness.behavior.callRpc("notify", input);
      const replacement = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const key = replacement.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      await host.harness.behavior.setSettings({ apnsKey: key });
      await host.harness.behavior.callRpc("notify", input);
      const jwt = requests[1]!.headers.authorization!.replace(/^bearer /, "");
      const [header, payload, signature] = jwt.split(".");
      expect(verify("sha256", Buffer.from(`${header}.${payload}`), { key: replacement.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url"))).toBe(true);
      expect(requests[1]!.headers.authorization).not.toBe(requests[0]!.headers.authorization);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("sends the coalesce key as a collapse id, hashing keys over 64 bytes", async () => {
    const requests = recordingSession();
    const host = await configuredHost();
    try {
      await host.bb.storage.kv.set("devices", { ["apns:" + "a".repeat(64)]: Date.now() });
      const base = { title: "Build", body: "Running", kind: "turn-finished", threadId: "thr_a", projectId: "proj_demo" } as const;
      await host.harness.behavior.callRpc("notify", { ...base, coalesceKey: "build-status" });
      await host.harness.behavior.callRpc("notify", { ...base, coalesceKey: "é".repeat(40) });
      expect(requests[0]!.headers["apns-collapse-id"]).toBe("build-status");
      expect(requests[1]!.headers["apns-collapse-id"]).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.parse(requests[0]!.body)).not.toHaveProperty("collapseId");
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("does not send to devices unseen for longer than the device TTL", async () => {
    const requests = recordingSession();
    const host = await configuredHost();
    try {
      const fresh = "a".repeat(64);
      const stale = "b".repeat(64);
      await host.bb.storage.kv.set("devices", { ["apns:" + fresh]: Date.now(), ["apns:" + stale]: Date.now() - DEVICE_TTL_MS - 60_000 });
      expect(await host.harness.behavior.callRpc("notify", {
        title: "Result", body: "Done", kind: "turn-finished", threadId: "thr_a", projectId: "proj_demo",
      })).toEqual({ ok: true, sent: 1 });
      expect(requests.map((request) => request.headers[":path"])).toEqual([`/3/device/${fresh}`]);
    } finally { await host.harness.lifecycle.dispose(); }
  });
});

describe("muting", () => {
  it("keeps every thread when mutes arrive at the same time", async () => {
    const host = createFakePluginHost({ pluginId: "mobile" });
    await plugin(host.bb);
    try {
      await Promise.all(["thr_a", "thr_b", "thr_c"].map((threadId) => host.harness.behavior.callRpc("mute_set", { threadId, muted: true })));
      expect([...((await host.bb.storage.kv.get<string[]>("muted-threads")) ?? [])].sort()).toEqual(["thr_a", "thr_b", "thr_c"]);
    } finally { await host.harness.lifecycle.dispose(); }
  });
});

describe("clearing notifications", () => {
  async function clearingHost(interactions: () => Promise<never[]>) {
    const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const host = createFakePluginHost({ pluginId: "mobile", settings: { apnsKey: key, apnsKeyId: "test", apnsEnvironment: "production" },
      sdk: { threads: { get: async () => makeThreadResponse({ id: "thr_a", lastReadAt: 2000, latestAttentionAt: 1000 }), interactions: { list: interactions } } },
    });
    await plugin(host.bb);
    await host.bb.storage.kv.set("devices", { ["apns:" + "a".repeat(64)]: Date.now() });
    await host.bb.storage.kv.set("notified-threads", { thr_a: Date.now() });
    return host;
  }

  it("keeps tracking when the interactions lookup fails", async () => {
    vi.useFakeTimers();
    vi.spyOn(Http2ApnsSender.prototype, "close").mockImplementation(() => {});
    // The sender stores send as an instance field; intercept its session before any network use.
    const session = vi.spyOn(Http2ApnsSender.prototype as any, "session").mockImplementation(() => { throw new Error("must not send"); });
    const host = await clearingHost(async () => { throw new Error("temporary lookup failure"); });
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await host.bb.storage.kv.get("notified-threads")).toEqual({ thr_a: expect.any(Number) });
      expect(session).not.toHaveBeenCalled();
      expect(host.harness.logEntries.some((entry) => entry.level === "warn" && entry.message.includes("thr_a") && entry.message.includes("temporary lookup failure"))).toBe(true);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("retries a failed clear and includes its server identity", async () => {
    vi.useFakeTimers();
    const { EventEmitter } = await import("node:events");
    const payloads: string[] = [];
    let attempts = 0;
    vi.spyOn(Http2ApnsSender.prototype as any, "session").mockReturnValue({
      request: () => {
        const request = new EventEmitter() as any;
        request.setTimeout = () => {};
        request.setEncoding = () => {};
        request.end = (body: string) => {
          payloads.push(body);
          request.emit("response", { ":status": ++attempts === 1 ? 503 : 200 });
          request.emit("close");
        };
        return request;
      },
    });
    const host = await clearingHost(async () => []);
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await host.bb.storage.kv.get("notified-threads")).toEqual({ thr_a: expect.any(Number) });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await host.bb.storage.kv.get("notified-threads")).toEqual({});
      expect(payloads).toHaveLength(2);
      expect(JSON.parse(payloads[0]!)).toMatchObject({ serverId: expect.any(String), clearThreadIds: ["thr_a"] });
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("forgets a device Apple rejects for good instead of retrying the clear every minute", async () => {
    vi.useFakeTimers();
    const { EventEmitter } = await import("node:events");
    const goneToken = "b".repeat(64);
    const sent: string[] = [];
    vi.spyOn(Http2ApnsSender.prototype as any, "session").mockReturnValue({
      request: (headers: Record<string, string>) => {
        const request = new EventEmitter() as any;
        request.setTimeout = () => {};
        request.setEncoding = () => {};
        request.end = () => {
          sent.push(headers[":path"]!);
          const gone = headers[":path"]!.endsWith(goneToken);
          request.emit("response", { ":status": gone ? 410 : 200 });
          if (gone) request.emit("data", JSON.stringify({ reason: "Unregistered" }));
          request.emit("close");
        };
        return request;
      },
    });
    const host = await clearingHost(async () => []);
    try {
      await host.bb.storage.kv.set("devices", { ["apns:" + "a".repeat(64)]: Date.now(), ["apns:" + goneToken]: Date.now() });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await host.bb.storage.kv.get("notified-threads")).toEqual({});
      expect(Object.keys((await host.bb.storage.kv.get("devices")) as object)).toEqual(["apns:" + "a".repeat(64)]);
      expect(sent).toHaveLength(2);
    } finally { await host.harness.lifecycle.dispose(); }
  });
});

it("serializes overlapping device registrations without losing either device", async () => {
  const requests = recordingSession();
  const host = await configuredHost();
  const push = (to: string) => host.harness.behavior.fetchHttp("POST", "/push", { body: JSON.stringify([{ to, body: "Useful reply" }]), headers: { "content-type": "application/json" } });
  const firstToken = `apns:${"a".repeat(64)}`;
  const secondToken = `apns:${"b".repeat(64)}`;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const get = host.bb.storage.kv.get.bind(host.bb.storage.kv);
  let paused = false;
  vi.spyOn(host.bb.storage.kv, "get").mockImplementation(async (key) => {
    const value = await get(key);
    if (key === "devices" && !paused) { paused = true; await gate; }
    return value as never;
  });
  try {
    const first = push(firstToken);
    await vi.waitFor(() => expect(paused).toBe(true));
    const second = push(secondToken);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    release();
    await Promise.all([first, second]);
    expect(await get("devices")).toEqual({ [firstToken]: expect.any(Number), [secondToken]: expect.any(Number) });
  } finally { release(); await host.harness.lifecycle.dispose(); }
});

it.each(["request", "end"])("records a mixed APNs batch when %s throws synchronously", async (failure) => {
  const good = "a".repeat(64);
  vi.spyOn(Http2ApnsSender.prototype as any, "session").mockReturnValue({
    request: (headers: Record<string, string>) => {
      const bad = !headers[":path"]!.endsWith(good);
      if (bad && failure === "request") throw new Error("transport broke");
      const request = new EventEmitter() as any;
      request.setTimeout = () => {};
      request.setEncoding = () => {};
      request.close = () => request.emit("close");
      request.end = () => {
        if (bad) throw new Error("transport broke");
        request.emit("response", { ":status": 200 });
        request.emit("close");
      };
      return request;
    },
  });
  const host = await configuredHost();
  try {
    const response = await host.harness.behavior.fetchHttp("POST", "/push", { body: JSON.stringify([
      { to: `apns:${"b".repeat(64)}`, body: "Bad", data: { threadId: "thr_bad" } },
      { to: `apns:${good}`, body: "Good", data: { threadId: "thr_good" } },
    ]), headers: { "content-type": "application/json" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [{ status: "error", message: expect.stringContaining("transport broke") }, { status: "ok" }] });
    expect(await host.bb.storage.kv.get("notified-threads")).toEqual({ thr_good: expect.any(Number) });
    expect(await host.bb.storage.kv.get("last-delivery")).toMatchObject({ apns: 2, errors: [expect.any(String)] });
  } finally { await host.harness.lifecycle.dispose(); }
});

it("keeps a refreshed registration when an older clear rejects the same token", async () => {
  vi.useFakeTimers();
  const device = "a".repeat(64);
  let rejectClear: (() => void) | undefined;
  vi.spyOn(Http2ApnsSender.prototype as any, "session").mockReturnValue({
    request: () => {
      const request = new EventEmitter() as any;
      request.setTimeout = () => {};
      request.setEncoding = () => {};
      request.end = (body: string) => {
        if (JSON.parse(body).aps["content-available"] === 1) {
          rejectClear = () => {
            request.emit("response", { ":status": 410 });
            request.emit("data", JSON.stringify({ reason: "Unregistered" }));
            request.emit("close");
          };
        } else {
          request.emit("response", { ":status": 200 });
          request.emit("close");
        }
      };
      return request;
    },
  });
  const host = await configuredHost();
  host.harness.sdk.stub("threads.get", async () => makeThreadResponse({ id: "thr_a", lastReadAt: 2000, latestAttentionAt: 1000 }));
  try {
    await host.bb.storage.kv.set("devices", { [`apns:${device}`]: Date.now() - 1000 });
    await host.bb.storage.kv.set("notified-threads", { thr_a: Date.now() });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rejectClear).toBeDefined();
    const response = await host.harness.behavior.fetchHttp("POST", "/push", { body: JSON.stringify([{ to: `apns:${device}`, body: "Refreshed" }]), headers: { "content-type": "application/json" } });
    expect(response.status).toBe(200);
    rejectClear!();
    await vi.advanceTimersByTimeAsync(0);
    expect(await host.bb.storage.kv.get("devices")).toEqual({ [`apns:${device}`]: Date.now() });
  } finally { await host.harness.lifecycle.dispose(); }
});
