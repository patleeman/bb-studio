import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { RESUME_CAP, RESUME_MARKER, RESUME_NOTE, restartReason, ThreadResume, type ThreadOwner } from "./thread-resume";

const dispose: (() => Promise<void>)[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000_000); });
afterEach(async () => { vi.useRealTimers(); for (const fn of dispose.splice(0)) await fn(); });

type Event = { id: string; seq: number; type: string; data: Record<string, unknown> };
const RESTART = { reason: "host-daemon-restarted" };
const LOST = { reason: "host-daemon-restarted", cause: "host-connection-lost" };

async function setup(options: { enabled?: boolean; graceMs?: number } = {}) {
  const threads = new Map<string, ReturnType<typeof makeThreadResponse>>();
  const events = new Map<string, Event[]>();
  let seq = 0;
  let enabled = options.enabled ?? true;
  const owners = new Map<string, ThreadOwner>();
  /** A thread a restart cut off: in error, its newest event the interrupt. */
  const cut = (id: string, data: Record<string, unknown> = RESTART) => {
    threads.set(id, { ...(threads.get(id) ?? makeThreadResponse({ id, projectId: "proj_p", title: `Thread ${id}` })), status: "error" } as never);
    const list = events.get(id) ?? [];
    list.push({ id: `evt_${++seq}`, seq, type: "turn/completed", data: { status: "interrupted" } });
    list.push({ id: `evt_${++seq}`, seq, type: "system/thread/interrupted", data });
    events.set(id, list);
  };
  const addEvent = (id: string, type: string) => { events.get(id)!.push({ id: `evt_${++seq}`, seq, type, data: {} }); };
  const send = vi.fn(async ({ threadId }: { threadId: string }) => {
    threads.set(threadId, { ...threads.get(threadId)!, status: "active" } as never);
    addEvent(threadId, "client/turn/requested");
    return { ok: true };
  });
  const listEvents = vi.fn(async ({ threadId, types, order, limit }: { threadId: string; types?: string[]; order?: string; limit?: string }) => {
    let list = [...(events.get(threadId) ?? [])];
    if (types) list = list.filter((event) => types.includes(event.type));
    if (order === "desc") list.reverse();
    return list.slice(0, Number(limit ?? 100));
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      get: (async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw Object.assign(new Error("Not found"), { status: 404 }); return thread; }) as never,
      list: (async ({ offset = 0, limit = 200 }: { offset?: number; limit?: number }) => [...threads.values()].slice(offset, offset + limit)) as never,
      events: { list: listEvents as never, wait: (async () => null) as never },
      send: send as never,
    },
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const exhausted = vi.fn(async () => {});
  const resume = new ThreadResume({ db, sdk: bb.sdk, enabled: () => enabled, owner: (id) => owners.get(id) ?? null, exhausted, debounceMs: 30_000, staggerMs: 15_000, graceMs: options.graceMs ?? 0 });
  dispose.push(async () => resume.dispose());
  /** The thread's resumed turn ends (BB's thread.idle). */
  const finish = (id: string) => { threads.set(id, { ...threads.get(id)!, status: "idle" } as never); resume.idle(id); };
  return { resume, db, threads, events, cut, addEvent, send, exhausted, owners, finish, setEnabled: (next: boolean) => { enabled = next; } };
}

it("matches only a host restart or a lost host connection, not stalls, stops or errors", () => {
  expect(restartReason({ type: "system/thread/interrupted", data: RESTART })).toBe("host restarted");
  expect(restartReason({ type: "system/thread/interrupted", data: LOST })).toBe("host connection lost");
  expect(restartReason({ type: "system/thread/interrupted", data: { reason: "provider-turn-idle" } })).toBeNull();
  expect(restartReason({ type: "system/thread/interrupted", data: { reason: "manual-stop" } })).toBeNull();
  expect(restartReason({ type: "system/thread/interrupted", data: { reason: "host-removed" } })).toBeNull();
  expect(restartReason({ type: "system/error", data: { message: "Thread interrupted because the host daemon disconnected" } })).toBeNull();
  expect(restartReason(null)).toBeNull();
});

it("resumes a thread a restart cut off, with the marker and an agent-only note", async () => {
  const x = await setup();
  x.cut("thr_a");
  expect(await x.resume.attempt("thr_a")).toBe("resumed");
  expect(x.send).toHaveBeenCalledWith({
    threadId: "thr_a", mode: "auto",
    input: [{ type: "text", text: RESUME_MARKER, mentions: [] }, { type: "text", text: RESUME_NOTE, mentions: [], visibility: "agent-only" }],
  });
  expect(x.resume.count("thr_a")).toBe(1);
});

it("resumes after a lost host connection too", async () => {
  const x = await setup();
  x.cut("thr_a", LOST);
  expect(await x.resume.attempt("thr_a")).toBe("resumed");
});

it("leaves stalled turns, user stops and model errors alone", async () => {
  const x = await setup();
  x.cut("thr_idle", { reason: "provider-turn-idle" });
  x.cut("thr_stop", { reason: "manual-stop" });
  x.threads.set("thr_err", { ...makeThreadResponse({ id: "thr_err", projectId: "proj_p" }), status: "error" } as never);
  x.events.set("thr_err", [{ id: "evt_x", seq: 1, type: "system/error", data: { message: "Thread interrupted because the host daemon disconnected" } }]);
  for (const id of ["thr_idle", "thr_stop", "thr_err"]) expect(await x.resume.attempt(id)).toBe("skipped");
  expect(x.send).not.toHaveBeenCalled();
});

it("skips a stale interrupt: a newer event, or the thread isn't in error any more", async () => {
  const x = await setup();
  x.cut("thr_a");
  x.addEvent("thr_a", "client/turn/requested");
  expect(await x.resume.attempt("thr_a")).toBe("skipped");
  x.cut("thr_b");
  x.threads.set("thr_b", { ...x.threads.get("thr_b")!, status: "idle" } as never);
  expect(await x.resume.attempt("thr_b")).toBe("skipped");
  expect(x.send).not.toHaveBeenCalled();
});

it("never resumes the same interrupt twice", async () => {
  const x = await setup();
  x.cut("thr_a");
  expect(await x.resume.attempt("thr_a")).toBe("resumed");
  // The send didn't take (still in error, the interrupt still newest): no second resume.
  x.threads.set("thr_a", { ...x.threads.get("thr_a")!, status: "error" } as never);
  x.events.get("thr_a")!.pop();
  expect(await x.resume.attempt("thr_a")).toBe("skipped");
  expect(x.send).toHaveBeenCalledTimes(1);
});

it("caps resumes at two per thread an hour, alerts once, and counts again after the hour", async () => {
  const x = await setup();
  x.owners.set("thr_a", { botId: "bot_main", name: "Jev", threadId: "thr_bot", active: true });
  for (let i = 1; i <= RESUME_CAP; i++) {
    x.cut("thr_a");
    expect(await x.resume.attempt("thr_a")).toBe("resumed");
    vi.advanceTimersByTime(60_000);
  }
  x.cut("thr_a");
  expect(await x.resume.attempt("thr_a")).toBe("exhausted");
  expect(x.exhausted).toHaveBeenCalledTimes(1);
  expect(x.exhausted).toHaveBeenCalledWith(expect.objectContaining({ id: "thr_a", title: "Thread thr_a" }), expect.objectContaining({ botId: "bot_main" }), expect.stringContaining("after 2 auto-resumes this hour"));
  expect(x.resume.alerts("bot_main")).toEqual([expect.objectContaining({ threadId: "thr_a", name: "Thread thr_a" })]);
  // Same interrupt: no second alert.
  expect(await x.resume.attempt("thr_a")).toBe("skipped");
  expect(x.exhausted).toHaveBeenCalledTimes(1);
  expect(x.send).toHaveBeenCalledTimes(RESUME_CAP);
  // The user picks it up: Needs you clears.
  x.finish("thr_a");
  expect(x.resume.alerts("bot_main")).toEqual([]);
  // An hour on, it resumes again.
  vi.advanceTimersByTime(60 * 60_000);
  x.cut("thr_a");
  expect(await x.resume.attempt("thr_a")).toBe("resumed");
});

it("skips archived and deleted threads, and threads of a paused or stopped Bot", async () => {
  const x = await setup();
  x.cut("thr_arch");
  x.threads.set("thr_arch", { ...x.threads.get("thr_arch")!, archivedAt: 5 } as never);
  x.cut("thr_del");
  x.threads.set("thr_del", { ...x.threads.get("thr_del")!, deletedAt: 5 } as never);
  x.cut("thr_bot");
  x.owners.set("thr_bot", { botId: "bot_main", name: "Jev", threadId: "thr_main", active: false });
  for (const id of ["thr_arch", "thr_del", "thr_bot", "thr_missing"]) expect(await x.resume.attempt(id)).toBe("skipped");
  expect(x.send).not.toHaveBeenCalled();
});

it("does nothing with the setting off", async () => {
  const x = await setup({ enabled: false });
  x.cut("thr_a");
  expect(await x.resume.attempt("thr_a")).toBe("skipped");
  expect(await x.resume.sweep()).toBe(0);
  x.resume.failed("thr_a");
  await vi.advanceTimersByTimeAsync(120_000);
  expect(x.send).not.toHaveBeenCalled();
});

it("resumes 30s after a thread fails, not before", async () => {
  const x = await setup();
  x.cut("thr_a");
  x.resume.failed("thr_a");
  await vi.advanceTimersByTimeAsync(29_000);
  expect(x.send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(x.send).toHaveBeenCalledTimes(1);
});

it("staggers resumes about 15s apart, with at most three running", async () => {
  const x = await setup();
  for (const id of ["thr_1", "thr_2", "thr_3", "thr_4", "thr_5"]) x.cut(id);
  expect(await x.resume.sweep()).toBe(5);
  await vi.advanceTimersByTimeAsync(1);
  expect(x.send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(14_000);
  expect(x.send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1_500);
  expect(x.send).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(x.send).toHaveBeenCalledTimes(3);
  // Three running: the fourth waits however long it takes.
  await vi.advanceTimersByTimeAsync(45_000);
  expect(x.send).toHaveBeenCalledTimes(3);
  x.finish("thr_1");
  await vi.advanceTimersByTimeAsync(1);
  expect(x.send).toHaveBeenCalledTimes(4);
  expect(x.send.mock.calls.map(([call]) => call.threadId)).toEqual(["thr_1", "thr_2", "thr_3", "thr_4"]);
});

it("doesn't sweep in the first minute after startup", async () => {
  const x = await setup({ graceMs: 60_000 });
  x.cut("thr_a");
  expect(await x.resume.sweep()).toBe(0);
  x.resume.startup();
  await vi.advanceTimersByTimeAsync(59_000);
  expect(x.send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(x.send).toHaveBeenCalledTimes(1);
});

it("sweeps soon after a host connects", async () => {
  const x = await setup();
  x.cut("thr_a");
  x.resume.hostConnected();
  await vi.advanceTimersByTimeAsync(6_000);
  expect(x.send).toHaveBeenCalledTimes(1);
});

it("retries failed exhaustion delivery without losing the pending alert", async () => {
  const x = await setup();
  for (let i = 0; i < RESUME_CAP; i++) { x.cut("thr_a"); await x.resume.attempt("thr_a"); vi.advanceTimersByTime(60000); }
  x.cut("thr_a");
  x.exhausted.mockRejectedValueOnce(new Error("offline"));
  await expect(x.resume.attempt("thr_a")).rejects.toThrow("offline");
  vi.advanceTimersByTime(2 * 60 * 60000);
  expect(await x.resume.attempt("thr_a")).toBe("exhausted");
  expect(x.exhausted).toHaveBeenCalledTimes(2);
  expect(await x.resume.attempt("thr_a")).toBe("skipped");
  expect(x.exhausted).toHaveBeenCalledTimes(2);
});
