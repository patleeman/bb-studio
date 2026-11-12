import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../migrations";
import { nextDailyAt, TriggerEngine } from "./engine";

const TRIGGERS_MIGRATION = MIGRATIONS.find((statement) => statement.includes("CREATE TABLE triggers")) ?? "";

function setup(start = Date.parse("2026-11-10T12:00:00Z")) {
  const db = new Database(":memory:");
  db.exec(TRIGGERS_MIGRATION);
  const clock = { now: start };
  const warnings: string[] = [];
  const engine = new TriggerEngine(db, { now: () => clock.now, warn: (message) => warnings.push(message) });
  return { db, clock, engine, warnings };
}

describe("trigger engine", () => {
  it("runs an interval when it is due, then waits a full interval again", async () => {
    const { engine, clock } = setup();
    let runs = 0;
    engine.every("sweep", 5 * 60_000, () => { runs++; });
    expect(await engine.tick()).toBe(0);
    clock.now += 5 * 60_000;
    expect(await engine.tick()).toBe(1);
    clock.now += 60_000;
    expect(await engine.tick()).toBe(0);
    expect(runs).toBe(1);
  });

  it("keeps an interval's due time when the same trigger is registered again after a restart", async () => {
    const { db, engine, clock } = setup();
    engine.every("sweep", 5 * 60_000, () => {});
    clock.now += 4 * 60_000;
    let runs = 0;
    const restarted = new TriggerEngine(db, { now: () => clock.now });
    restarted.every("sweep", 5 * 60_000, () => { runs++; });
    clock.now += 60_000;
    await restarted.tick();
    expect(runs).toBe(1);
  });

  it("fires a one-time trigger once and marks it done", async () => {
    const { engine, clock } = setup();
    const seen: string[] = [];
    engine.handle("reminder", (trigger) => { seen.push(trigger.ownerId); });
    engine.upsert({ owner: "reminder", ownerId: "r1", spec: { kind: "at", at: clock.now + 1000 } });
    clock.now += 2000;
    await engine.tick();
    await engine.tick();
    expect(seen).toEqual(["r1"]);
    expect(engine.list("reminder")[0]?.state).toBe("done");
  });

  it("runs event triggers only for their event, and passes the payload", async () => {
    const { engine } = setup();
    const seen: unknown[] = [];
    engine.handle("todo", (_trigger, run) => { seen.push([run.event, run.payload]); });
    engine.upsert({ owner: "todo", ownerId: "a", spec: { kind: "event", event: "place:home:arrive" } });
    expect(await engine.fire("place:work:arrive")).toBe(0);
    expect(await engine.fire("place:home:arrive", { by: "phone" })).toBe(1);
    expect(seen).toEqual([["place:home:arrive", { by: "phone" }]]);
  });

  it("does not start a handler again while it is still running, and skips a trigger that is off", async () => {
    const { engine, clock } = setup();
    let started = 0;
    let finish = () => {};
    engine.handle("slow", () => { started++; return new Promise<void>((resolve) => { finish = resolve; }); });
    engine.upsert({ owner: "slow", ownerId: "tick", spec: { kind: "interval", everyMs: 1000 } });
    engine.upsert({ owner: "slow", ownerId: "off", spec: { kind: "interval", everyMs: 1000 }, state: "off" });
    clock.now += 2000;
    const first = engine.tick();
    clock.now += 2000;
    expect(await engine.tick()).toBe(0);
    finish();
    await first;
    expect(started).toBe(1);
  });

  it("keeps going when one handler throws, and tries that trigger again at its next due time", async () => {
    const { engine, clock, warnings } = setup();
    let good = 0;
    let bad = 0;
    engine.every("good", 1000, () => { good++; });
    engine.every("bad", 1000, () => { bad++; throw new Error("boom"); });
    clock.now += 2000;
    await engine.tick();
    clock.now += 2000;
    await engine.tick();
    expect([good, bad]).toEqual([2, 2]);
    expect(warnings[0]).toBe("Trigger bad:tick failed: boom");
  });

  it("runs a schedule at each of its times and finishes when it has none left", async () => {
    const { engine, clock } = setup();
    const seen: number[] = [];
    engine.handle("checkin", (_trigger, run) => { seen.push(run.now); });
    // Twice a day, ending today (10 November 2026, UTC).
    const made = engine.upsert({ owner: "checkin", ownerId: "c1", spec: { kind: "schedule", schedule: { type: "times", days: [0, 1, 2, 3, 4, 5, 6], times: ["13:00", "18:30"], until: "2026-11-10" }, timeZone: "UTC" } });
    expect(new Date(made.nextAt!).toISOString()).toBe("2026-11-10T13:00:00.000Z");
    clock.now = Date.parse("2026-11-10T13:00:30Z");
    expect(await engine.tick()).toBe(1);
    expect(engine.get("checkin", "c1")).toMatchObject({ state: "on", nextAt: Date.parse("2026-11-10T18:30:00Z") });
    // Studio was off through the second time: one late run, and nothing after the end date.
    clock.now = Date.parse("2026-11-12T09:00:00Z");
    expect(await engine.tick()).toBe(1);
    expect(engine.get("checkin", "c1")).toMatchObject({ state: "done", nextAt: null });
    expect(await engine.tick()).toBe(0);
    expect(seen).toHaveLength(2);
    // A schedule that is already over is saved as done.
    expect(engine.upsert({ owner: "checkin", ownerId: "c2", spec: { kind: "schedule", schedule: { type: "once", at: clock.now - 1 }, timeZone: "UTC" } }).state).toBe("done");
  });

  it("does not replay missed runs: one overdue run, then the next time from now", async () => {
    const { engine, clock } = setup();
    let runs = 0;
    engine.handle("checkin", () => { runs++; });
    engine.upsert({ owner: "checkin", ownerId: "c1", spec: { kind: "schedule", schedule: { type: "cron", cron: "*/15 * * * *" }, timeZone: "UTC" } });
    clock.now = Date.parse("2026-11-10T15:07:00Z");
    await engine.tick();
    await engine.tick();
    expect(runs).toBe(1);
    expect(new Date(engine.get("checkin", "c1")!.nextAt!).toISOString()).toBe("2026-11-10T15:15:00.000Z");
  });

  it("runs a trigger now without using up a one-time trigger or moving its due time", async () => {
    const { engine, clock } = setup();
    const seen: string[] = [];
    engine.handle("reminder", (trigger, run) => { seen.push(`${trigger.ownerId}:${run.reason}`); });
    const once = clock.now + 60_000;
    engine.upsert({ owner: "reminder", ownerId: "at", spec: { kind: "at", at: once } });
    engine.upsert({ owner: "reminder", ownerId: "once", spec: { kind: "schedule", schedule: { type: "once", at: once }, timeZone: "UTC" } });
    engine.upsert({ owner: "reminder", ownerId: "off", spec: { kind: "interval", everyMs: 60_000 }, state: "off" });
    for (const id of ["at", "once", "off"]) expect(await engine.runNow("reminder", id)).toBe(true);
    expect(await engine.runNow("reminder", "missing")).toBe(false);
    expect(seen).toEqual(["at:manual", "once:manual", "off:manual"]);
    expect(engine.list("reminder").map((each) => [each.ownerId, each.state, each.nextAt])).toEqual([["at", "on", once], ["off", "off", once], ["once", "on", once]]);
    clock.now = once + 1;
    await engine.tick();
    expect(seen.slice(3).sort()).toEqual(["at:time", "once:time"]);
    expect(engine.list("reminder").map((each) => each.state)).toEqual(["done", "off", "done"]);
  });

  it("keeps a trigger due when its handler says later, and runs it at the next tick", async () => {
    const { engine, clock } = setup();
    let ready = false;
    let ran = 0;
    engine.handle("wake", () => { if (!ready) return "later"; ran++; });
    const made = engine.upsert({ owner: "wake", ownerId: "w", spec: { kind: "interval", everyMs: 60_000 } });
    clock.now += 61_000;
    await engine.tick();
    expect(engine.get("wake", "w")).toMatchObject({ nextAt: made.nextAt, lastAt: null, state: "on" });
    ready = true;
    clock.now += 60_000;
    await engine.tick();
    expect(ran).toBe(1);
    expect(engine.get("wake", "w")).toMatchObject({ nextAt: clock.now + 60_000, lastAt: clock.now });
  });

  it("turns a trigger off and on: on again it waits for its next time from now, and a one-time trigger keeps its time", async () => {
    const { engine, clock } = setup();
    let runs = 0;
    engine.handle("job", () => { runs++; });
    engine.upsert({ owner: "job", ownerId: "every", spec: { kind: "schedule", schedule: { type: "cron", cron: "0 * * * *" }, timeZone: "UTC" } });
    const at = clock.now + 30 * 60_000;
    engine.upsert({ owner: "job", ownerId: "once", spec: { kind: "schedule", schedule: { type: "once", at }, timeZone: "UTC" } });
    engine.setState("job", "every", "off");
    engine.setState("job", "once", "off");
    clock.now += 5 * 3_600_000 + 60_000;
    expect(await engine.tick()).toBe(0);
    engine.setState("job", "every", "on");
    engine.setState("job", "once", "on");
    // The hourly one missed five runs and replays none; the one-time one is late and runs once.
    expect(new Date(engine.get("job", "every")!.nextAt!).toISOString()).toBe("2026-11-10T18:00:00.000Z");
    expect(engine.get("job", "once")!.nextAt).toBe(at);
    expect(await engine.tick()).toBe(1);
    expect(engine.get("job", "once")!.state).toBe("done");
    // Done stays done, and saving the same schedule again does not bring it back.
    engine.setState("job", "once", "on");
    expect(engine.upsert({ owner: "job", ownerId: "once", spec: { kind: "schedule", schedule: { type: "once", at }, timeZone: "UTC" } }).state).toBe("done");
    expect(runs).toBe(1);
  });

  it("finds the next wall-clock time in a zone, across a daylight-saving change", () => {
    const beforeFallBack = Date.parse("2026-10-31T12:00:00Z");
    const next = nextDailyAt(beforeFallBack, 4, 0, "America/New_York");
    expect(new Date(next).toISOString()).toBe("2026-11-01T09:00:00.000Z");
    expect(new Date(nextDailyAt(Date.parse("2026-11-10T08:00:00Z"), 4, 0, "America/New_York")).toISOString()).toBe("2026-11-10T09:00:00.000Z");
  });
});
