import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACTIVITY_MAX_AGE_MS,
  DONE_WINDOW_MS,
  MAX_ACTIVITIES,
  START_TIMEOUT_MS,
  TEXT_UPDATE_MS,
  activityPayload,
  askOf,
  decide,
  lastText,
  phaseOf,
  pick,
  threadTitle,
  type LiveThread,
  type ThreadActivityState,
  type ThreadRecord,
} from "./live.js";

const now = 1_800_000_000_000;
const none = new Set<string>();

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

function state(overrides: Partial<ThreadActivityState> = {}): ThreadActivityState {
  return { title: "Build", phase: "running", last: "Working on it", ask: null, updatedAt: now / 1000, ...overrides };
}

const shown: ThreadRecord = {
  activity: { id: "act", token: "tok", startedAt: now - 60_000 },
  startRequestedAt: null,
  state: state(),
  pushedAt: now - 60_000,
};

describe("phaseOf", () => {
  it("covers running, waiting, failed and just-finished top-level threads", () => {
    expect(phaseOf(thread({ id: "thr_a", status: "active" }), now)).toBe("running");
    expect(phaseOf(thread({ id: "thr_a", status: "active", hasPendingInteraction: true }), now)).toBe("needsYou");
    expect(phaseOf(thread({ id: "thr_a", status: "error", lastReadAt: now - 5000, latestAttentionAt: now }), now)).toBe("failed");
    expect(phaseOf(thread({ id: "thr_a", lastReadAt: now - 5000, latestAttentionAt: now }), now)).toBe("done");
  });

  it("leaves out read, stale, child, archived and hidden threads", () => {
    expect(phaseOf(thread({ id: "thr_a" }), now)).toBeNull();
    expect(phaseOf(thread({ id: "thr_a", status: "error" }), now)).toBeNull();
    expect(phaseOf(thread({ id: "thr_a", lastReadAt: 0, latestAttentionAt: now - DONE_WINDOW_MS }), now)).toBeNull();
    expect(phaseOf(thread({ id: "thr_a", status: "active", parentThreadId: "thr_p" }), now)).toBeNull();
    expect(phaseOf(thread({ id: "thr_a", status: "active", archivedAt: now }), now)).toBeNull();
    expect(phaseOf(thread({ id: "thr_a", status: "active", visibility: "hidden" }), now)).toBeNull();
  });
});

describe("pick", () => {
  const threads = [
    thread({ id: "thr_run1", status: "active", latestAttentionAt: now - 10 }),
    thread({ id: "thr_run2", status: "active", latestAttentionAt: now - 20 }),
    thread({ id: "thr_run3", status: "active", latestAttentionAt: now - 30 }),
    thread({ id: "thr_done", lastReadAt: 0, latestAttentionAt: now - 5 }),
    thread({ id: "thr_ask", status: "active", hasPendingInteraction: true, latestAttentionAt: now - 100 }),
  ];

  it("puts what needs you first, then running, then finished, up to the cap", () => {
    expect(pick(threads, none, none, now).map((entry) => entry.thread.id)).toEqual(["thr_ask", "thr_run1", "thr_run2"]);
    expect(MAX_ACTIVITIES).toBe(3);
  });

  it("keeps shown threads in place and skips muted ones", () => {
    const ids = pick(threads, new Set(["thr_run3"]), new Set(["thr_ask"]), now).map((entry) => entry.thread.id);
    expect(ids).toEqual(["thr_run3", "thr_run1", "thr_run2"]);
  });
});

describe("askOf", () => {
  it("describes approvals, plans and questions", () => {
    expect(askOf({ id: "i1", payload: { kind: "approval", subject: { kind: "command", command: "pnpm test" } } })).toEqual({
      id: "i1", kind: "approval", text: "Run pnpm test", choices: [],
    });
    expect(askOf({ id: "i2", payload: { kind: "approval", subject: { kind: "plan" } } }).kind).toBe("plan");
    const question = askOf({
      id: "i3",
      payload: { kind: "user_question", questions: [{ prompt: "Which?", multiSelect: false, options: ["A", "B", "C", "D"].map((label) => ({ label })) }] },
    });
    expect(question).toEqual({ id: "i3", kind: "question", text: "Which?", choices: ["A", "B", "C"] });
  });

  it("reads the ask-user-question plugin's form, and offers no buttons for several questions", () => {
    const questions = [{ prompt: "One?", options: [{ label: "Y" }] }, { prompt: "Two?" }];
    expect(askOf({ id: "i4", payload: { kind: "plugin", data: { questions } } })).toEqual({ id: "i4", kind: "question", text: "One?", choices: [] });
  });
});

describe("lastText", () => {
  it("flattens whitespace and keeps the tail", () => {
    expect(lastText("Hello\n\n  world")).toBe("Hello world");
    expect(lastText(`${"x".repeat(500)}END`)).toHaveLength(400);
    expect(lastText(`${"x".repeat(500)}END`)?.endsWith("END")).toBe(true);
    expect(lastText("  ")).toBeNull();
  });

  it("titles untitled threads by id", () => {
    expect(threadTitle({ id: "thr_abcdefgh123", title: null, titleFallback: null })).toBe("Thread abcdefgh");
  });
});

describe("decide", () => {
  it("push-starts a picked thread, waits for a pending start, and needs a start token", () => {
    expect(decide(undefined, state(), now, true)).toEqual({ kind: "start", alert: "Running" });
    expect(decide(undefined, state(), now, false).kind).toBe("none");
    const pending: ThreadRecord = { activity: null, startRequestedAt: now - 1000, state: state(), pushedAt: now - 1000 };
    expect(decide(pending, state(), now, true).kind).toBe("none");
    expect(decide(pending, state(), now + START_TIMEOUT_MS, true).kind).toBe("start");
  });

  it("ends an activity whose thread is no longer picked", () => {
    expect(decide(shown, null, now, true).kind).toBe("end");
    expect(decide(undefined, null, now, true).kind).toBe("none");
  });

  it("alerts on a new phase and throttles text-only updates", () => {
    const ask = { id: "i1", kind: "approval" as const, text: "Run ls", choices: [] };
    expect(decide(shown, state({ phase: "needsYou", ask }), now, true)).toEqual({ kind: "update", alert: "Needs you: Run ls" });
    expect(decide(shown, state({ phase: "done" }), now, true)).toEqual({ kind: "update", alert: "Finished" });
    expect(decide(shown, state({ last: "More" }), now, true)).toEqual({ kind: "update", alert: null });
    const recent = { ...shown, pushedAt: now - 5000 };
    expect(decide(recent, state({ last: "More" }), now, true)).toEqual({ kind: "later", ms: TEXT_UPDATE_MS - 5000 });
    expect(decide(recent, state({ phase: "done" }), now, true).kind).toBe("update");
  });

  it("skips pushes that would change nothing but the timestamp", () => {
    expect(decide(shown, state({ updatedAt: now / 1000 + 50 }), now, true).kind).toBe("none");
  });

  it("stays dismissed until the phase changes", () => {
    const dismissed: ThreadRecord = { ...shown, activity: null, dismissed: "running" };
    expect(decide(dismissed, state(), now, true).kind).toBe("none");
    expect(decide(dismissed, state({ phase: "done" }), now, true).kind).toBe("start");
  });

  it("replaces an activity before iOS's eight-hour limit", () => {
    const old = { ...shown, activity: { ...shown.activity!, startedAt: now - ACTIVITY_MAX_AGE_MS } };
    expect(decide(old, state(), now, true).kind).toBe("restart");
  });
});

describe("activityPayload", () => {
  it("sends the Swift content keys", () => {
    const swift = readFileSync(new URL("../../apps/ios/LiveActivity/BBThreadAttributes.swift", import.meta.url), "utf8");
    const keys = (name: string) =>
      [...(swift.match(new RegExp(`struct ${name}: Codable, Hashable \\{([^}]+)`))?.[1] ?? "").matchAll(/var (\w+):/g)].map((match) => match[1]);
    const ask = { id: "i1", kind: "question" as const, text: "Which?", choices: ["A"] };
    expect(Object.keys(state({ ask }))).toEqual(keys("ContentState"));
    expect(Object.keys(ask)).toEqual(keys("Ask"));
  });

  it("builds a push-to-start for the thread that asks for its update token", () => {
    const { payload, priority } = activityPayload({ kind: "start", alert: "Running" }, "thr_a", state(), now);
    expect(priority).toBe(10);
    expect(JSON.parse(payload).aps).toEqual({
      timestamp: now / 1000,
      event: "start",
      "content-state": state(),
      "attributes-type": "BBThreadAttributes",
      attributes: { threadId: "thr_a" },
      alert: { title: "Build", body: "Running" },
      "input-push-token": 1,
    });
  });

  it("sends running text quietly and removes ended activities at once", () => {
    const update = activityPayload({ kind: "update", alert: null }, "thr_a", state(), now);
    expect(update.priority).toBe(5);
    expect(JSON.parse(update.payload).aps.alert).toBeUndefined();
    const end = JSON.parse(activityPayload({ kind: "end" }, "thr_a", null, now).payload).aps;
    expect(end).toEqual({ timestamp: now / 1000, event: "end", "dismissal-date": now / 1000 });
  });
});
