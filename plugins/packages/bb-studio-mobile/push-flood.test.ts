import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "./server.js";
import { Http2ApnsSender, type ExpoMessage } from "./apns.js";
import { triggerOf, turnPushAllowed } from "./notifications.js";
import { PUSH_WINDOW_MS, summaryBody, windowKey } from "./push-window.js";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const device = "d".repeat(64);
const KEEPALIVE = "[studio:cache-keepalive] Studio keeps your prompt cache warm while the user is away. This isn't from the user: don't use tools, don't mention it, and reply exactly [PASS].";

type Turn = { request?: Record<string, unknown> | null; reply?: string | null };
type Row = { type: string; scope: { kind: string; turnId?: string }; data: Record<string, unknown> };

function rows(turns: Turn[]): Row[] {
  const out: Row[] = [];
  turns.forEach((turn, index) => {
    const turnId = `turn_${index}`;
    const requestId = `creq_${index}`;
    if (turn.request) {
      out.push({ type: "client/turn/requested", scope: { kind: "thread" }, data: { requestId, ...turn.request } });
      out.push({ type: "turn/input/accepted", scope: { kind: "turn", turnId }, data: { clientRequestId: requestId } });
    }
    out.push({ type: "turn/started", scope: { kind: "turn", turnId }, data: {} });
    out.push({ type: "item/completed", scope: { kind: "turn", turnId }, data: { item: { type: "commandExecution" } } });
    if (turn.reply != null) out.push({ type: "item/completed", scope: { kind: "turn", turnId }, data: { item: { type: "agentMessage", text: turn.reply } } });
  });
  return out;
}

const user = (text: string) => ({ initiator: "user", senderThreadId: null, input: [{ type: "text", text }] });
const system = (text: string) => ({ initiator: "system", systemMessageKind: "child-completed", input: [{ type: "text", text }] });
const agent = (text: string) => ({ initiator: "agent", senderThreadId: "thr_sender", input: [{ type: "text", text: `[bb message from thread:thr_sender] ${text}` }] });
const automation = (text: string) => ({ initiator: "user", input: [{ type: "text", text: `[bb automation due:2026-11-14T13:00:00Z] ${text}` }] });
const keepalive = { initiator: "user", input: [{ type: "text", text: KEEPALIVE, visibility: "agent-only" }] };

function recordingSession() {
  const requests: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
  vi.spyOn(Http2ApnsSender.prototype, "close").mockImplementation(() => {});
  vi.spyOn(Http2ApnsSender.prototype as any, "session").mockReturnValue({
    request: (headers: Record<string, string>) => {
      const request = new EventEmitter() as any;
      request.setTimeout = () => {};
      request.setEncoding = () => {};
      request.end = (body: string) => {
        requests.push({ headers, body: JSON.parse(body) });
        request.emit("response", { ":status": 200 });
        request.emit("close");
      };
      return request;
    },
  });
  return requests;
}

type ReplyTag = { decision: "push" | "quiet" | "unknown"; ask: string | null };

async function relay(options: { threads?: Record<string, Turn[]>; failEvents?: boolean; replyTags?: Record<string, ReplyTag>; asked?: string[] } = {}) {
  const requests = recordingSession();
  const threads = new Map(Object.entries(options.threads ?? {}));
  const read = new Map<string, { lastReadAt: number; latestAttentionAt: number }>();
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const host = createFakePluginHost({
    pluginId: "mobile", settings: { apnsKey: key, apnsKeyId: "test" },
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, ...(read.get(threadId) ?? { lastReadAt: 0, latestAttentionAt: 1 }) }),
        interactions: { list: async () => [] },
        events: {
          list: async ({ threadId, types, limit }: { threadId: string; types: string[]; limit: string }) => {
            if (options.failEvents) throw new Error("events unavailable");
            return rows(threads.get(threadId) ?? []).filter((row) => types.includes(row.type)).reverse().slice(0, Number(limit));
          },
        },
      },
      plugins: {
        callRpc: async ({ pluginId, method, input }: { pluginId: string; method: string; input: { threadId: string } }) => {
          if (pluginId !== "studio" || method !== "strands.replyPush") throw new Error(`no ${method}`);
          options.asked?.push(input.threadId);
          const tag = options.replyTags?.[input.threadId];
          if (!tag) throw new Error("Studio is not running");
          return tag;
        },
      },
    } as never,
  });
  await plugin(host.bb);
  await host.bb.storage.kv.set("devices", { ["apns:" + device]: Date.now() });
  const push = async (threadId: string, body: string) => (await host.harness.behavior.fetchHttp("POST", "/push", {
    body: JSON.stringify([{ to: "apns:" + device, title: "Lead", body, sound: "default", data: { kind: "turn-finished", threadId, projectId: "proj_demo", subscriptionId: "sub_1" } }] satisfies ExpoMessage[]),
    headers: { "content-type": "application/json" },
  })).json();
  return { ...host, requests, threads, read, push };
}

describe("BB's push for a finished turn, by the reply's tag (strands)", () => {
  it("drops a status reply, sends one that needs you with its ask line, and sends as before when Studio can't tell", async () => {
    const asked: string[] = [];
    const host = await relay({
      asked,
      threads: {
        thr_status: [{ request: user("how's the disk?"), reply: "Cleared DerivedData: 7.8 GB back." }],
        thr_needs: [{ request: user("book the furnace"), reply: "Ace has Saturday 9 AM. Please sign in to the Ace portal so I can book it." }],
        thr_unknown: [{ request: user("ship it"), reply: "Shipped as v1.2." }],
        thr_down: [{ request: user("and the docs?"), reply: "Docs are updated." }],
      },
      replyTags: {
        thr_status: { decision: "quiet", ask: null },
        thr_needs: { decision: "push", ask: "Please sign in to the Ace portal so I can book it." },
        thr_unknown: { decision: "unknown", ask: null },
      },
    });
    try {
      for (const threadId of ["thr_status", "thr_needs", "thr_unknown", "thr_down"]) expect(await host.push(threadId, "reply")).toEqual({ data: [{ status: "ok" }] });
      expect(host.requests.map((request) => request.body.threadId)).toEqual(["thr_needs", "thr_unknown", "thr_down"]);
      expect(host.requests[0]!.body).toMatchObject({ aps: { alert: { body: "Please sign in to the Ace portal so I can book it." } } });
      expect(host.requests[1]!.body).toMatchObject({ aps: { alert: { body: "reply" } } });
      expect(asked).toEqual(["thr_status", "thr_needs", "thr_unknown", "thr_down"]);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("lets a reply that needs you through when a worker's notice started the turn; a status or untagged one there stays off", async () => {
    const asked: string[] = [];
    const host = await relay({
      asked,
      threads: {
        thr_merge: [{ request: system("[bb system]\n\n@thread:thr_w completed:"), reply: "The worker finished and the tests pass. Want me to merge it?" }],
        thr_done: [{ request: system("[bb system]\n\n@thread:thr_w completed:"), reply: "The worker finished." }],
        thr_lost: [{ request: system("[bb system]\n\n@thread:thr_w completed:"), reply: "The worker finished." }],
      },
      replyTags: { thr_merge: { decision: "push", ask: "Want me to merge it?" }, thr_done: { decision: "quiet", ask: null } },
    });
    try {
      for (const threadId of ["thr_merge", "thr_done", "thr_lost"]) await host.push(threadId, "reply");
      expect(host.requests.map((request) => request.body.threadId)).toEqual(["thr_merge"]);
      expect(host.requests[0]!.body).toMatchObject({ aps: { alert: { body: "Want me to merge it?" } } });
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("decides a held push on its first pass: the window's flush keeps its 'N new' summary and asks Studio no more", async () => {
    vi.useFakeTimers();
    const asked: string[] = [];
    const host = await relay({ asked, threads: { thr_ask: [{ request: user("book it?"), reply: "Want me to book Ace?" }] }, replyTags: { thr_ask: { decision: "push", ask: "Want me to book Ace?" } } });
    try {
      await host.push("thr_ask", "first");
      await host.push("thr_ask", "second");
      expect(asked).toEqual(["thr_ask", "thr_ask"]);
      await vi.advanceTimersByTimeAsync(PUSH_WINDOW_MS);
      expect(host.requests).toHaveLength(2);
      expect(host.requests[1]!.body).toMatchObject({ aps: { alert: { body: "2 new · Want me to book Ace?" } } });
      expect(asked).toEqual(["thr_ask", "thr_ask"]);
      expect(JSON.stringify(host.requests[1]!.body)).not.toContain("checked");
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("leaves Studio's own pushes and turns nobody needs to hear about alone", async () => {
    const asked: string[] = [];
    const host = await relay({ asked, threads: { thr_pass: [{ request: user("Anything new?"), reply: "[PASS]" }] }, replyTags: { thr_pass: { decision: "push", ask: "x" } } });
    try {
      await host.push("thr_pass", "[PASS]");
      expect(host.requests).toEqual([]);
      expect(asked).toEqual([]);
    } finally { await host.harness.lifecycle.dispose(); }
  });
});

describe("BB's push for a finished turn", () => {
  it("is dropped for a [PASS] turn, and for a relayed message folded with [PASS]", async () => {
    const host = await relay({ threads: { thr_pass: [{ request: user("Anything new?"), reply: "[PASS]" }], thr_fold: [{ request: agent("CI is green."), reply: "**[PASS]**" }] } });
    try {
      expect(await host.push("thr_pass", "[PASS]")).toEqual({ data: [{ status: "ok" }] });
      expect(await host.push("thr_fold", "Finished and waiting for you")).toEqual({ data: [{ status: "ok" }] });
      expect(host.requests).toEqual([]);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("is dropped for a cache keepalive turn, whatever it replied", async () => {
    const host = await relay({ threads: { thr_main: [{ request: keepalive, reply: "Okay." }] } });
    try {
      await host.push("thr_main", "Okay.");
      expect(host.requests).toEqual([]);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("is dropped for an automation, a system relay or a continuation that ended with no reply", async () => {
    const host = await relay({ threads: {
      thr_auto: [{ request: automation('Check-in "Daily": look at the leads'), reply: null }],
      thr_child: [{ request: system("[bb system]\n\n@thread:thr_w completed:"), reply: null }],
      thr_cont: [{ request: null, reply: null }],
    } });
    try {
      for (const threadId of ["thr_auto", "thr_child", "thr_cont"]) await host.push(threadId, "Finished and waiting for you");
      expect(host.requests).toEqual([]);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("goes out for a real reply to the user or an automation, never for a lead answering its workers", async () => {
    const host = await relay({ threads: {
      thr_user: [{ request: user("Ship it?"), reply: "Shipped as v1.2." }],
      thr_relay: [{ request: automation("Check the build"), reply: "The build failed: the signing key expired. Renew it in Keychain." }],
      thr_lead: [{ request: system("[bb system]\n\n@thread:thr_w completed:"), reply: "The review passed; I merged it." }],
      thr_peer: [{ request: agent("Phase 1 is built."), reply: "Thanks, sending it to review." }],
    } });
    try {
      await host.push("thr_user", "Shipped as v1.2.");
      await host.push("thr_relay", "The build failed: the signing key expired.");
      await host.push("thr_lead", "The review passed; I merged it.");
      await host.push("thr_peer", "Thanks, sending it to review.");
      expect(host.requests.map((request) => request.body.threadId)).toEqual(["thr_user", "thr_relay"]);
      expect(host.requests[0]!.body).toMatchObject({ aps: { alert: { body: "Shipped as v1.2." }, category: "BB_REPLY" } });
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("goes out for a turn the user started that ended with no reply", async () => {
    const host = await relay({ threads: { thr_user: [{ request: user("Run the migration"), reply: null }] } });
    try {
      await host.push("thr_user", "Finished and waiting for you");
      expect(host.requests).toHaveLength(1);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("goes out when BB's events can't be read", async () => {
    const host = await relay({ failEvents: true });
    try {
      await host.push("thr_any", "A reply");
      expect(host.requests).toHaveLength(1);
    } finally { await host.harness.lifecycle.dispose(); }
  });
});

describe("one push per conversation per window", () => {
  it("sends the first reply at once, holds the rest, then sends the latest as one 'N new' push that replaces it", async () => {
    vi.useFakeTimers();
    const host = await relay({ threads: { thr_lead: [{ request: user("Status?"), reply: "Third." }] } });
    try {
      await host.push("thr_lead", "First.");
      await host.push("thr_lead", "Second.");
      await host.push("thr_lead", "Third.");
      expect(host.requests).toHaveLength(1);
      expect(host.requests[0]!.headers["apns-collapse-id"]).toBe("conversation:thr_lead");
      await vi.advanceTimersByTimeAsync(PUSH_WINDOW_MS);
      expect(host.requests).toHaveLength(2);
      expect(host.requests[1]!.headers["apns-collapse-id"]).toBe("conversation:thr_lead");
      expect(host.requests[1]!.body).toMatchObject({ aps: { alert: { body: "3 new · Third." } } });
      await vi.advanceTimersByTimeAsync(PUSH_WINDOW_MS);
      expect(host.requests).toHaveLength(2);
      await host.push("thr_lead", "Fourth.");
      expect(host.requests).toHaveLength(3);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("drops the held push when the conversation was read before the window ended", async () => {
    vi.useFakeTimers();
    const host = await relay({ threads: { thr_lead: [{ request: user("Status?"), reply: "Second." }] } });
    try {
      await host.push("thr_lead", "First.");
      await host.push("thr_lead", "Second.");
      host.read.set("thr_lead", { lastReadAt: Date.now() + 1, latestAttentionAt: Date.now() });
      await vi.advanceTimersByTimeAsync(PUSH_WINDOW_MS);
      expect(host.requests.filter((request) => request.headers["apns-push-type"] === "alert")).toHaveLength(1);
    } finally { await host.harness.lifecycle.dispose(); }
  });

  it("windows Studio's pushes by conversation, needs-you too, but never loops, approvals or keyed alerts", async () => {
    vi.useFakeTimers();
    const host = await relay();
    try {
      const base = { title: "Dot", projectId: "proj_personal", botId: "dot", conversationId: "thr_main" } as const;
      expect(await host.harness.behavior.callRpc("notify", { ...base, body: "Morning card", kind: "turn-finished", threadId: "thr_main" })).toEqual({ ok: true, sent: 1 });
      await host.harness.behavior.callRpc("notify", { ...base, body: "A work card needs you", kind: "needs-you", threadId: "thr_main" });
      await host.harness.behavior.callRpc("notify", { ...base, body: "Renew the key", kind: "turn-finished", threadId: "thr_main", category: "BB_LOOP", loopId: "loop_1", actions: ["done"] });
      await host.harness.behavior.callRpc("notify", { ...base, body: "Runner stopped again", kind: "turn-finished", threadId: "thr_main", coalesceKey: "thread-resume:thr_r" });
      expect(host.requests.map((request) => request.body.aps)).toMatchObject([{ alert: { body: "Morning card" } }, { alert: { body: "Renew the key" } }, { alert: { body: "Runner stopped again" } }]);
      await vi.advanceTimersByTimeAsync(PUSH_WINDOW_MS);
      expect(host.requests.at(-1)!.body).toMatchObject({ kind: "needs-you", aps: { alert: { body: "2 new · A work card needs you" } } });
    } finally { await host.harness.lifecycle.dispose(); }
  });
});

describe("rules", () => {
  it.each([
    [null, "continuation"],
    [user("Hi"), "user"],
    [keepalive, "keepalive"],
    [{ initiator: "user", input: [{ type: "text", text: "x" }], pluginSubmission: { pluginId: "studio", data: { kind: "cache-keepalive" } } }, "keepalive"],
    [system("[bb system] done"), "thread"],
    [{ initiator: "system", systemMessageKind: "child-failed", input: [{ type: "text", text: "[bb system] failed" }] }, "thread"],
    [{ initiator: "system", systemMessageKind: "environment-directory-updated", input: [{ type: "text", text: "[bb system] moved" }] }, "relayed"],
    [agent("hello"), "thread"],
    [{ initiator: "user", input: [{ type: "text", text: "[bb message from thread:thr_w] done" }] }, "thread"],
    [automation("Reminder"), "relayed"],
    [{ initiator: "user", input: [{ type: "text", text: "[bb studio] Watcher x: y" }] }, "relayed"],
    [{ initiator: "user", input: [{ type: "text", text: "note", visibility: "agent-only" }] }, "relayed"],
  ])("trigger of %j is %s", (request, trigger) => expect(triggerOf(request)).toBe(trigger));

  it("allows a push only for a user-facing reply, or a user turn with no reply", () => {
    expect(turnPushAllowed({ trigger: "keepalive", reply: "Hello" })).toBe(false);
    expect(turnPushAllowed({ trigger: "user", reply: "[PASS]" })).toBe(false);
    expect(turnPushAllowed({ trigger: "relayed", reply: '::approval{thread="thr_w" id="int_1"}' })).toBe(false);
    expect(turnPushAllowed({ trigger: "relayed", reply: null })).toBe(false);
    expect(turnPushAllowed({ trigger: "continuation", reply: null })).toBe(false);
    expect(turnPushAllowed({ trigger: "user", reply: null })).toBe(true);
    expect(turnPushAllowed({ trigger: "relayed", reply: '::loop{id="loop_1"}' })).toBe(true);
    expect(turnPushAllowed({ trigger: "continuation", reply: "CI is green." })).toBe(true);
  });

  it("never pushes a turn another thread started: a lead's answer to its worker", () => {
    expect(turnPushAllowed({ trigger: "thread", reply: "The build is done; I merged it." })).toBe(false);
    expect(turnPushAllowed({ trigger: "thread", reply: null })).toBe(false);
  });

  it("keys only plain replies, and summarises a window", () => {
    expect(windowKey({ to: "x", data: { kind: "turn-finished", threadId: "thr_a" } })).toBe("thr_a");
    expect(windowKey({ to: "x", data: { kind: "turn-finished", threadId: "thr_w", conversationId: "thr_c" } })).toBe("thr_c");
    expect(windowKey({ to: "x", data: { kind: "pending-interaction", threadId: "thr_a" } })).toBeNull();
    expect(windowKey({ to: "x", data: { kind: "thread-error", threadId: "thr_a" } })).toBeNull();
    expect(windowKey({ to: "x", collapseId: "k", data: { kind: "turn-finished", threadId: "thr_a" } })).toBeNull();
    expect(summaryBody("Hi", 1)).toBe("Hi");
    expect(summaryBody("Hi", 4)).toBe("4 new · Hi");
    expect(summaryBody("", 2)).toBe("2 new");
  });
});
