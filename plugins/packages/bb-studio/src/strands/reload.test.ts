// A reload disposes the old Studio and closes its database while the old
// strands work may still be pending: a sort waiting on Jev, a backfill
// waiting on BB's events, a queued job, a timer. None of it may touch the
// closed database afterwards or reject unhandled ("The database connection
// is not open", reported as an uncaught error on the plugin).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EventRow } from "./turns";
import { StrandDetector } from "./detector";
import { StrandService } from "./service";
import { StrandStore } from "./store";
import { database, FakeThread, fakeJev, fakeModel } from "./test/fixture";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const HOUR = 60 * 60 * 1000;

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
beforeEach(() => { unhandled = []; process.on("unhandledRejection", onUnhandled); });
afterEach(() => { process.off("unhandledRejection", onUnhandled); });

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve)); };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function service(options: { jev?: ReturnType<typeof fakeJev>; events?: (input: Parameters<FakeThread["events"]>[0]) => Promise<EventRow[]> } = {}) {
  const db = database();
  const thread = new FakeThread();
  const logs: string[] = [];
  const timers: { run(): void; cleared: boolean }[] = [];
  const svc = new StrandService({
    db, conversation: (id) => (id === thread.id ? { botId: "bot", lastActiveAt: NOW } : null),
    conversationsOf: async () => [{ threadId: thread.id, title: "Main", isMain: true, lastActiveAt: NOW }],
    events: options.events ?? thread.events, jev: options.jev ?? fakeJev(), model: fakeModel(), changed: () => {}, log: (line) => logs.push(line), now: () => NOW,
    setTimer: (run) => { const timer = { run, cleared: false }; timers.push(timer); return timer; },
    clearTimer: (handle) => { (handle as { cleared: boolean }).cleared = true; },
    workers: async () => [], interactions: async () => [], busy: async () => false,
  });
  return { db, thread, svc, logs, timers };
}

it("drops a sort waiting on Jev when Studio reloads: no write to the closed database, nothing unhandled", async () => {
  const gate = deferred<void>();
  const jev = fakeJev();
  const x = service({ jev: async (input) => { await gate.promise; return jev(input); } });
  await x.svc.idle(x.thread.id);
  x.thread.turn("Look at the router", "Ok.", { at: NOW - HOUR });
  const sorting = x.svc.idle(x.thread.id, true);
  await flush();
  x.svc.dispose();
  x.db.close();
  gate.resolve();
  await expect(sorting).resolves.toBeUndefined();
  await flush();
  expect(unhandled).toEqual([]);
  expect(x.logs.filter((line) => /not open/.test(line))).toEqual([]);
});

it("stops a backfill waiting on BB's events when Studio reloads, from a strands.list that started it in the background", async () => {
  const gate = deferred<void>();
  const thread = new FakeThread();
  thread.turn("Look at the router", "Ok.", { at: NOW - HOUR });
  const x = service({ events: async (input) => { await gate.promise; return thread.events(input); } });
  // Opening the conversation starts its backfill in the background.
  await x.svc.list(x.thread.id).catch(() => undefined);
  await flush();
  x.svc.dispose();
  x.db.close();
  gate.resolve();
  await flush();
  expect(unhandled).toEqual([]);
  // Nothing new starts on the old instance.
  await expect(x.svc.idle(x.thread.id, true)).resolves.toBeUndefined();
  x.svc.active(x.thread.id);
  await expect(x.svc.asked(x.thread.id)).resolves.toBeUndefined();
  expect(x.timers).toEqual([]);
});

it("clears its timers on reload, and a timer that fires anyway does nothing", async () => {
  const x = service();
  await x.svc.idle(x.thread.id);
  x.thread.turn("Look at the router", "Ok.", { at: NOW - HOUR, done: false });
  x.svc.active(x.thread.id);
  expect(x.timers.length).toBeGreaterThan(0);
  x.svc.dispose();
  expect(x.timers.every((timer) => timer.cleared)).toBe(true);
  x.db.close();
  for (const timer of x.timers) timer.run();
  await flush();
  expect(unhandled).toEqual([]);
});

it("times out a hung small-model call in batchNow(), falls back to previous strand, and unblocks the queue", async () => {
  const db = database();
  const store = new StrandStore(db);
  const thread = new FakeThread();
  const logs: string[] = [];
  const detector = new StrandDetector({
    store,
    events: thread.events,
    jev: async () => ({ ok: false, unavailable: true, error: "off" }),
    model: () => new Promise(() => {}), // hangs forever
    openTasks: () => [],
    changed: () => {},
    log: (line) => logs.push(line),
    now: () => NOW,
    modelTimeoutMs: 30,
  });
  const s1 = store.create({ threadId: thread.id, title: "Router work", origin: "user", seq: 1, at: NOW - HOUR });
  store.put({ threadId: thread.id, seq: 1, kind: "user", turnId: "t1", at: NOW - HOUR, line: "First", strandId: s1.id, confidence: null, by: "user" });
  store.put({ threadId: thread.id, seq: 2, kind: "user", turnId: "t2", at: NOW, line: "Pending turn", strandId: s1.id, confidence: null, by: "pending" });

  await detector.batchNow(thread.id);
  expect(store.item(thread.id, "user", 2)?.by).toBe("fallback");
  expect(store.item(thread.id, "user", 2)?.strandId).toBe(s1.id);
  expect(logs.some((line) => /batch sort failed.*no answer/.test(line))).toBe(true);
});

it("stops backfillNow() mid-page-loop when disposed without fetching further pages", async () => {
  const db = database();
  const store = new StrandStore(db);
  const gate = deferred<void>();
  const events = vi.fn(async () => {
    await gate.promise;
    // Return a full page (100 rows) so an unguarded loop would immediately fetch page 2.
    return Array.from({ length: 100 }, (_, i) => ({ seq: 200 - i, type: "item/completed", createdAt: NOW - i }));
  });
  const detector = new StrandDetector({
    store,
    events,
    jev: fakeJev(),
    model: fakeModel(),
    openTasks: () => [],
    changed: () => {},
    log: () => {},
    now: () => NOW,
  });

  const running = detector.backfill("thr_1");
  await flush();
  expect(events).toHaveBeenCalledTimes(1);
  detector.dispose();
  gate.resolve();
  expect(await running).toBeNull();
  expect(events).toHaveBeenCalledTimes(1);
});
