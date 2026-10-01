import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACTIVITY_MAX_AGE_MS,
  EMPTY_RECORD,
  START_TIMEOUT_MS,
  decide,
  livePayload,
  summarize,
  threadActivityPayload,
  threadActivityState,
  type LiveRecord,
  type LiveState,
  type LiveThread,
} from "./live.js";

const now = 1_800_000_000_000;

function thread(overrides: Partial<LiveThread> & { id: string }): LiveThread {
  return {
    title: overrides.id,
    titleFallback: null,
    status: "idle",
    lastReadAt: now,
    latestAttentionAt: now - 1000,
    parentThreadId: null,
    ...overrides,
  };
}

function state(overrides: Partial<LiveState> = {}): LiveState {
  return {
    needsYou: 0,
    running: 1,
    headline: "a",
    headlineThreadId: "thr_a",
    latest: null,
    updatedAt: now / 1000,
    ...overrides,
  };
}

const withActivity: LiveRecord = {
  ...EMPTY_RECORD,
  pushToStartToken: "ptst",
  activity: { id: "act", token: "tok", startedAt: now - 60_000 },
  state: state(),
};

describe("summarize", () => {
  it("counts running and waiting top-level threads and headlines the one that needs you", () => {
    const result = summarize(
      [
        thread({ id: "thr_run", status: "active", latestAttentionAt: now }),
        thread({ id: "thr_ask", status: "active", hasPendingInteraction: true, title: "Deploy" }),
        thread({ id: "thr_child", status: "active", parentThreadId: "thr_run" }),
        thread({ id: "thr_done", status: "idle" }),
      ],
      "✓ x finished",
      now,
    );
    expect(result).toEqual({
      needsYou: 1,
      running: 1,
      headline: "Deploy",
      headlineThreadId: "thr_ask",
      latest: "✓ x finished",
      updatedAt: now / 1000,
    });
  });

  it("treats unread failures as needing you, and read ones as settled", () => {
    const unread = thread({ id: "thr_new", status: "error", lastReadAt: now - 5000, latestAttentionAt: now });
    const read = thread({ id: "thr_old", status: "error", lastReadAt: now, latestAttentionAt: now - 5000 });
    expect(summarize([unread, read], null, now).needsYou).toBe(1);
  });

  it("falls back to the title fallback and then the id", () => {
    const result = summarize([thread({ id: "thr_abcdefgh123", title: null, status: "active" })], null, now);
    expect(result.headline).toBe("Thread abcdefgh");
  });
});

describe("thread Live Activity", () => {
  it("sends the Swift content keys and ends a completed thread", () => {
    const swift = readFileSync(new URL("../../apps/ios/LiveActivity/BBThreadAttributes.swift", import.meta.url), "utf8");
    const fields = swift.match(/struct BBThreadAttributes[\s\S]*?struct ContentState: Codable, Hashable \{([^}]+)/)?.[1] ?? "";
    const swiftKeys = [...fields.matchAll(/var (\w+):/g)].map((match) => match[1]);
    const running = threadActivityState(thread({ id: "thr_a", title: "Build", status: "active" }), now);
    expect(Object.keys(running)).toEqual(swiftKeys);
    expect(JSON.parse(threadActivityPayload(running, false, now)).aps).toMatchObject({
      event: "update", "content-state": running,
    });
    const finished = threadActivityState(thread({ id: "thr_a", status: "idle" }), now);
    expect(JSON.parse(threadActivityPayload(finished, true, now)).aps.event).toBe("end");
  });
});

describe("decide", () => {
  it("push-starts when something is running and there is no activity", () => {
    const next = state();
    expect(decide({ ...EMPTY_RECORD, pushToStartToken: "ptst" }, next, now)).toEqual({
      kind: "start",
      state: next,
      alert: "a is running",
    });
  });

  it("cannot start without a push-to-start token, and waits for a pending start", () => {
    expect(decide(EMPTY_RECORD, state(), now).kind).toBe("none");
    const pending = { ...EMPTY_RECORD, pushToStartToken: "ptst", startRequestedAt: now - 1000 };
    expect(decide(pending, state(), now).kind).toBe("none");
    expect(decide(pending, state(), now + START_TIMEOUT_MS).kind).toBe("start");
  });

  it("stays quiet when nothing is going on", () => {
    expect(decide({ ...EMPTY_RECORD, pushToStartToken: "ptst" }, state({ running: 0 }), now).kind).toBe("none");
  });

  it("updates silently for count changes and alerts when something newly needs you", () => {
    expect(decide(withActivity, state({ running: 2 }), now)).toMatchObject({ kind: "update", alert: null });
    expect(decide(withActivity, state({ needsYou: 1, headline: "Deploy" }), now)).toMatchObject({
      kind: "update",
      alert: "Deploy needs you",
    });
  });

  it("skips pushes that would change nothing but the timestamp", () => {
    expect(decide(withActivity, state({ updatedAt: now / 1000 + 50 }), now).kind).toBe("none");
  });

  it("ends the activity when everything is done", () => {
    expect(decide(withActivity, state({ running: 0 }), now).kind).toBe("end");
  });

  it("replaces an activity before iOS's eight-hour limit", () => {
    const old = { ...withActivity, activity: { ...withActivity.activity!, startedAt: now - ACTIVITY_MAX_AGE_MS } };
    expect(decide(old, state(), now).kind).toBe("restart");
  });
});

describe("livePayload", () => {
  it("builds a push-to-start that asks for the activity's update token", () => {
    const { payload, priority } = livePayload({ kind: "start", state: state(), alert: "a is running" }, now);
    expect(priority).toBe(10);
    expect(JSON.parse(payload).aps).toEqual({
      timestamp: now / 1000,
      event: "start",
      "content-state": state(),
      "attributes-type": "BBStatusAttributes",
      attributes: {},
      alert: { title: "BB", body: "a is running" },
      "input-push-token": 1,
    });
  });

  it("sends silent updates at low priority", () => {
    const { payload, priority } = livePayload({ kind: "update", state: state(), alert: null }, now);
    expect(priority).toBe(5);
    expect(JSON.parse(payload).aps.alert).toBeUndefined();
  });

  it("dismisses an ended activity a minute later", () => {
    const aps = JSON.parse(livePayload({ kind: "end", state: state({ running: 0 }) }, now).payload).aps;
    expect(aps.event).toBe("end");
    expect(aps["dismissal-date"]).toBe(now / 1000 + 60);
  });
});
