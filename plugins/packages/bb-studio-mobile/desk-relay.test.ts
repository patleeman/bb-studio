// The desk hold through the relay: BB's /push route and the notify RPC, with a
// fake APNs session.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "./server.js";
import { Http2ApnsSender, type ExpoMessage } from "./apns.js";
import { DESK_FRESH_MS } from "./desk.js";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const device = "e".repeat(64);
const PHONE = `apns:${device}`;

async function relay() {
  const sent: Array<Record<string, any>> = [];
  vi.spyOn(Http2ApnsSender.prototype, "close").mockImplementation(() => {});
  vi.spyOn(Http2ApnsSender.prototype as any, "session").mockReturnValue({
    request: () => {
      const request = new EventEmitter() as any;
      request.setTimeout = () => {};
      request.setEncoding = () => {};
      request.end = (body: string) => {
        sent.push(JSON.parse(body));
        request.emit("response", { ":status": 200 });
        request.emit("close");
      };
      return request;
    },
  });
  const read = new Map<string, number>();
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const host = createFakePluginHost({
    pluginId: "mobile", settings: { apnsKey: key, apnsKeyId: "test" },
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, lastReadAt: read.get(threadId) ?? 0, latestAttentionAt: 1 }),
        interactions: { list: async () => [] },
        events: { list: async () => [] },
      },
    } as never,
  });
  await plugin(host.bb);
  await host.bb.storage.kv.set("devices", { [PHONE]: Date.now() });
  const push = async (threadId: string, title: string) => (await host.harness.behavior.fetchHttp("POST", "/push", {
    body: JSON.stringify([{ to: PHONE, title, body: "Done", sound: "default", data: { kind: "needs-you", threadId, projectId: "proj_demo", botId: "bot_1", conversationId: threadId } }] satisfies ExpoMessage[]),
    headers: { "content-type": "application/json" },
  })).json();
  const beat = (state: "active" | "away", clientId = "desktop-test1") => host.harness.behavior.callRpc("desk_beat", { clientId, state, source: "system" });
  const status = async () => (await host.harness.behavior.callRpc("push_status", null) as { deskHold: unknown }).deskHold;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  return { ...host, sent, read, push, beat, status, settle };
}

describe("hold phone notifications while at the desk", () => {
  it("is on by default and fails open with no heartbeat", async () => {
    const host = await relay();
    try {
      expect(await host.status()).toEqual({ enabled: true, atDesk: null, held: 0 });
      expect(await host.push("thr_a", "Alpha")).toEqual({ data: [{ status: "ok" }] });
      expect(host.sent).toHaveLength(1);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("holds while at the desk and sends when the user goes away with the thread unread", async () => {
    const host = await relay();
    try {
      await host.beat("active");
      expect(await host.push("thr_a", "Alpha")).toEqual({ data: [{ status: "ok" }] });
      expect(host.sent).toEqual([]);
      expect(await host.status()).toEqual({ enabled: true, atDesk: true, held: 1 });
      await host.beat("away");
      await host.settle();
      expect(host.sent).toHaveLength(1);
      expect(host.sent[0]!.aps.alert).toMatchObject({ title: "Alpha" });
      expect(await host.status()).toEqual({ enabled: true, atDesk: false, held: 0 });
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("drops a held push once the thread was read at the desk", async () => {
    const host = await relay();
    try {
      await host.beat("active");
      await host.push("thr_a", "Alpha");
      host.read.set("thr_a", 5);
      await host.beat("away");
      await host.settle();
      expect(host.sent).toEqual([]);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("sends one summary for several threads", async () => {
    const host = await relay();
    try {
      await host.beat("active");
      await host.push("thr_a", "Alpha");
      await host.push("thr_b", "Beta");
      await host.push("thr_c", "Gamma");
      await host.beat("away");
      await host.settle();
      expect(host.sent).toHaveLength(1);
      expect(host.sent[0]!.aps.alert).toMatchObject({ title: "3 updates while you were away" });
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("fails open once the heartbeat goes stale, and sends what it held", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const host = await relay();
    try {
      await host.beat("active");
      await host.push("thr_a", "Alpha");
      expect(host.sent).toEqual([]);
      await vi.advanceTimersByTimeAsync(DESK_FRESH_MS + 5);
      expect(host.sent).toHaveLength(1);
      await host.push("thr_b", "Beta");
      expect(host.sent).toHaveLength(2);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("with the switch off sends as today, and turning it off sends what waits", async () => {
    const host = await relay();
    try {
      await host.beat("active");
      await host.push("thr_a", "Alpha");
      expect(host.sent).toEqual([]);
      expect(await host.harness.behavior.callRpc("desk_hold_set", { enabled: false })).toEqual({ enabled: false, atDesk: true, held: 0 });
      expect(host.sent).toHaveLength(1);
      await host.push("thr_b", "Beta");
      expect(host.sent).toHaveLength(2);
      expect(await host.bb.storage.kv.get("desk-hold")).toEqual({ enabled: false });
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("never holds the test push", async () => {
    const host = await relay();
    try {
      await host.beat("active");
      expect(await host.harness.behavior.callRpc("push_test", null)).toMatchObject({ ok: true, sent: 1 });
      expect(host.sent).toHaveLength(1);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("notify holds too and still counts the phone", async () => {
    const host = await relay();
    try {
      await host.beat("active");
      expect(await host.harness.behavior.callRpc("notify", { title: "Alpha", body: "Done", kind: "turn-finished", threadId: "thr_a", projectId: "proj_demo" })).toEqual({ ok: true, sent: 1 });
      expect(host.sent).toEqual([]);
    } finally { await host.harness.lifecycle.dispose(); }
  });
});

describe("the delivery journal", () => {
  it("records what happened to each push, with no titles or bodies, and `bb mobile deliveries` counts them per hour", async () => {
    const host = await relay();
    try {
      await host.beat("active");
      await host.push("thr_a", "Alpha");
      await host.beat("away");
      await host.settle();
      await host.push("thr_b", "Beta");
      await host.settle();
      const out = JSON.parse((await host.harness.behavior.runCli(["deliveries", "--json"])).stdout ?? "{}");
      expect(out.entries.map((entry: { outcome: string; later?: string; threadId: string }) => [entry.outcome, entry.later ?? null, entry.threadId])).toEqual([
        ["desk", null, "thr_a"], ["sent", "desk", "thr_a"], ["sent", null, "thr_b"],
      ]);
      expect(JSON.stringify(out)).not.toMatch(/Alpha|Beta|Done|eeee/);
      expect(out.summary).toHaveLength(1);
      expect(out.summary[0].outcomes).toEqual({ desk: 1, sent: 2 });
      expect(out.summary[0].sent).toEqual({ "needs-you (desk)": 1, "needs-you": 1 });
      const text = (await host.harness.behavior.runCli(["deliveries"])).stdout ?? "";
      expect(text).toContain("sent: needs-you (desk) 1, needs-you 1");
    } finally { await host.harness.lifecycle.dispose(); }
  });
});
