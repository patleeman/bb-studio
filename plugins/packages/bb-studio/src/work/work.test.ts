import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { SHOW_FINISHED_MS, type WorkCard } from "./contract";
import { inFlightOrder, WorkCardStore } from "./store";

const NOW = new Date("2026-11-13T15:00:00Z").getTime();
let db: Database.Database;
let store: WorkCardStore;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db = new Database(":memory:");
  db.exec(MIGRATIONS.find((sql) => sql.includes("CREATE TABLE work_cards"))!);
  store = new WorkCardStore(db);
});
afterEach(() => { db.close(); vi.useRealTimers(); });

it("creates a card with defaults and reads it back", () => {
  const card = store.create({ title: "Release 1.0.2", threadId: "thr_main" });
  expect(card).toMatchObject({ title: "Release 1.0.2", kind: "task", state: "running", step: null, line: null, needs: null, threadId: "thr_main", messageId: null, messageSeq: null, createdAt: NOW, finishedAt: null });
  expect(card.id).toMatch(/^wc_/);
  expect(store.get(card.id)).toEqual(card);
  expect(() => store.get("wc_missing")).toThrow(/not found/);
});

it("updates in place: step, line, needs; clearing a field with an empty string", () => {
  const card = store.create({ title: "Build", threadId: "thr_main", step: "1/3" });
  vi.setSystemTime(NOW + 1_000);
  const next = store.update(card.id, { step: "2/3 Tests", line: "412 passed", state: "needs-you", needs: "Approve the push" });
  expect(next).toMatchObject({ id: card.id, step: "2/3 Tests", line: "412 passed", state: "needs-you", needs: "Approve the push", updatedAt: NOW + 1_000 });
  expect(store.update(card.id, { line: "" }).line).toBeNull();
  expect(store.update(card.id, { state: "running" }).needs).toBeNull();
  expect(db.prepare("SELECT count(*) AS n FROM work_cards").get()).toEqual({ n: 1 });
});

it("stamps finishedAt once and clears it when work restarts", () => {
  const card = store.create({ title: "Deploy", threadId: "thr_main" });
  vi.setSystemTime(NOW + 5_000);
  expect(store.update(card.id, { state: "done" }).finishedAt).toBe(NOW + 5_000);
  vi.setSystemTime(NOW + 9_000);
  expect(store.update(card.id, { state: "failed", line: "Rolled back" }).finishedAt).toBe(NOW + 5_000);
  expect(store.update(card.id, { state: "running" }).finishedAt).toBeNull();
});

it("lists one conversation's cards in flight, drops finished ones after a day", () => {
  const open = store.create({ title: "Open", threadId: "thr_main" });
  const done = store.create({ title: "Done today", threadId: "thr_main" });
  const old = store.create({ title: "Done yesterday", threadId: "thr_main" });
  store.create({ title: "Elsewhere", threadId: "thr_other" });
  vi.setSystemTime(NOW - SHOW_FINISHED_MS - 60_000);
  store.update(old.id, { state: "done" });
  vi.setSystemTime(NOW);
  store.update(done.id, { state: "done" });
  expect(store.inFlight("thr_main").map((card) => card.title)).toEqual(["Open", "Done today"]);
  vi.setSystemTime(NOW + SHOW_FINISHED_MS + 1);
  expect(store.inFlight("thr_main").map((card) => card.id)).toEqual([open.id]);
});

it("orders needs-you first, then running and waiting by age, then finished, newest first", () => {
  const at = (minutes: number, patch: Partial<WorkCard>): WorkCard => ({ id: `wc_${minutes}`, threadId: "t", title: String(minutes), kind: "task", state: "running", step: null, line: null, needs: null, workerThreadId: null, messageId: null, messageSeq: null, createdAt: minutes, updatedAt: minutes, finishedAt: null, ...patch });
  const order = inFlightOrder([at(1, { state: "done", finishedAt: 10 }), at(2, {}), at(3, { state: "needs-you" }), at(4, { state: "waiting" }), at(5, { state: "failed", finishedAt: 20 })]);
  expect(order.map((card) => card.title)).toEqual(["3", "2", "4", "5", "1"]);
});

it("keeps the first message a card was posted in", () => {
  const card = store.create({ title: "Job", threadId: "thr_main" });
  expect(store.anchor(card.id, "thr_other", "msg_x").messageId).toBeNull();
  expect(store.anchor(card.id, "thr_main", "msg_1").messageId).toBe("msg_1");
  expect(store.anchor(card.id, "thr_main", "msg_2").messageId).toBe("msg_1");
  expect(store.placed(card.id, "msg_1", 42)).toMatchObject({ messageId: "msg_1", messageSeq: 42 });
});

it("tells listeners after every saved change", () => {
  const changed = vi.fn();
  const live = new WorkCardStore(db, changed);
  const card = live.create({ title: "Job", threadId: "thr_main" });
  live.update(card.id, { line: "Halfway" });
  expect(changed).toHaveBeenCalledTimes(2);
});
