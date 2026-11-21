// A reload disposes the old Studio and closes its database while the old
// strands work may still be pending: a sort waiting on Jev, a backfill
// waiting on BB's events, a queued job, a timer. None of it may touch the
// closed database afterwards or reject unhandled ("The database connection
// is not open", reported as an uncaught error on the plugin).
import { afterEach, beforeEach, expect, it } from "vitest";
import type { EventRow } from "./turns";
import { StrandService } from "./service";
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
