import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { z } from "zod";
import { MIGRATIONS } from "../migrations";
import { runWorkCli } from "./cli";
import { rpcContract, SHOW_FINISHED_MS, type WorkCard } from "./contract";
import { findCardMessage, registerWorkCards, WORK_TOOLS, type TimelineReader } from "./register";
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

const page = (rows: { id: string; text?: string; messageSeq?: number; kind?: string }[], older: { anchorSeq: number; anchorId: string } | null = null) => ({ rows: rows.map((row) => ({ kind: "conversation", role: "assistant", ...row })), timelinePage: { olderCursor: older } });

it("finds the message a card sits in, by id or by its directive, across older pages", async () => {
  const id = "wc_abc";
  const reads: unknown[] = [];
  const read: TimelineReader = async (_threadId, cursor) => {
    reads.push(cursor);
    return cursor ? page([{ id: "m_card", text: `Started.\n\n::work{id="${id}"}`, messageSeq: 7 }]) : page([{ id: "m_late", text: "Other", messageSeq: 20 }], { anchorSeq: 15, anchorId: "a" });
  };
  expect(await findCardMessage(read, { id, threadId: "thr_main", messageId: null })).toEqual({ messageId: "m_card", messageSeq: 7 });
  expect(reads).toHaveLength(2);
  expect(await findCardMessage(async () => page([{ id: "m_given", text: "no directive", messageSeq: 3 }]), { id, threadId: "thr_main", messageId: "m_given" })).toEqual({ messageId: "m_given", messageSeq: 3 });
  expect(await findCardMessage(async () => page([{ id: "m_other", text: '::work{id="wc_abcdef"}', messageSeq: 3 }]), { id, threadId: "thr_main", messageId: null })).toBeNull();
});

function fakeBb() {
  const handlers: Record<string, (input: never) => unknown> = {};
  const tools: Record<string, { execute(input: unknown, ctx: { threadId?: string | null }): Promise<string> }> = {};
  const bb = {
    realtime: { publish: vi.fn() }, log: { warn: vi.fn() },
    agents: { registerTool: (tool: { name: string; execute(input: unknown, ctx: unknown): Promise<string> }) => { tools[tool.name] = tool; } },
    rpc: { register: (_contract: unknown, map: typeof handlers) => Object.assign(handlers, map) },
    sdk: { threads: { timeline: vi.fn() } },
  };
  return { bb, handlers, tools };
}

it("serves the RPC: create, update, list with the placed message, anchor", async () => {
  const { bb, handlers } = fakeBb();
  let text = "Working on it.";
  const read: TimelineReader = async () => page([{ id: "m_9", text, messageSeq: 9 }]);
  registerWorkCards(bb as never, db, { read });
  const call = async <M extends keyof typeof rpcContract>(method: M, input: unknown): Promise<z.infer<(typeof rpcContract)[M]["output"]>> => rpcContract[method].output.parse(await handlers[method]!(rpcContract[method].input.parse(input) as never)) as z.infer<(typeof rpcContract)[M]["output"]>;
  const { card, directive } = await call("work.create", { title: "Release", kind: "release", threadId: "thr_main" });
  expect(directive).toBe(`::work{id="${card.id}"}`);
  expect(bb.realtime.publish).toHaveBeenCalled();
  expect((await call("work.list", { threadId: "thr_main" })).cards[0]!.messageSeq).toBeNull();
  text = `Release started.\n\n${directive}`;
  expect((await call("work.list", { threadId: "thr_main" })).cards[0]!.messageSeq).toBeNull();
  vi.setSystemTime(NOW + 20_000);
  expect((await call("work.list", { threadId: "thr_main" })).cards[0]).toMatchObject({ messageId: "m_9", messageSeq: 9 });
  expect(await call("work.update", { id: card.id, state: "needs-you", needs: "Sign the build" })).toMatchObject({ state: "needs-you", needs: "Sign the build" });
  const other = (await call("work.create", { title: "Other", threadId: "thr_main" })).card;
  text = `x ::work{id="${other.id}"}`;
  expect(await call("work.anchor", { id: other.id, threadId: "thr_main", messageId: "m_9" })).toMatchObject({ messageSeq: 9 });
  expect(() => rpcContract["work.update"].input.parse({ id: card.id, state: "paused" })).toThrow();
});

it("gives agents tools that create in the caller's thread and update in place", async () => {
  const { bb, tools } = fakeBb();
  registerWorkCards(bb as never, db, { read: async () => page([]) });
  expect(Object.keys(tools).sort()).toEqual([...WORK_TOOLS].sort());
  const made = JSON.parse(await tools.work_card_create!.execute({ title: "Worker: fix tests", kind: "worker" }, { threadId: "thr_lead" })) as { id: string; directive: string };
  expect(made.directive).toBe(`::work{id="${made.id}"}`);
  expect(store.get(made.id)).toMatchObject({ threadId: "thr_lead", kind: "worker", state: "running" });
  expect(await tools.work_card_create!.execute({ title: "Nowhere" }, { threadId: null })).toMatch(/threadId/);
  const updated = JSON.parse(await tools.work_card_update!.execute({ id: made.id, step: "2/4", line: "Fixing the flaky one" }, { threadId: "thr_worker" })) as WorkCard;
  expect(updated).toMatchObject({ step: "2/4", line: "Fixing the flaky one", threadId: "thr_lead" });
  expect(JSON.parse(await tools.work_card_get!.execute({ id: made.id }, {}))).toMatchObject({ id: made.id });
});

it("runs bb studio work create, update, show and list", async () => {
  const { bb } = fakeBb();
  const work = registerWorkCards(bb as never, db, { read: async () => page([]) });
  const created = await runWorkCli(["create", "--title", "Nightly", "--kind", "release", "--json"], work, { threadId: "thr_main" });
  expect(created.exitCode).toBe(0);
  const { card, directive } = JSON.parse(created.stdout!) as { card: WorkCard; directive: string };
  expect(directive).toContain(card.id);
  const updated = await runWorkCli(["update", card.id, "--state", "needs-you", "--needs", "Pick a version"], work, {});
  expect(updated).toMatchObject({ exitCode: 0 });
  expect(updated.stdout).toContain("needs-you\tNightly");
  expect(updated.stdout).toContain("Pick a version");
  expect((await runWorkCli(["show", card.id], work, {})).stdout).toContain(card.id);
  expect((await runWorkCli(["list", "--thread", "thr_main"], work, {})).stdout).toContain("Nightly");
  expect((await runWorkCli(["list"], work, { threadId: "thr_empty" })).stdout).toBe("No work in flight.\n");
  expect((await runWorkCli(["update", card.id, "--state", "paused"], work, {})).exitCode).toBe(1);
  expect((await runWorkCli(["create"], work, { threadId: "thr_main" })).exitCode).toBe(1);
  expect((await runWorkCli(["create", "--title", "x"], work, {})).exitCode).toBe(1);
});

it("places a thread's new cards when its turn ends", async () => {
  const { bb } = fakeBb();
  let idle: ((event: { thread: { id: string } }) => void) | null = null;
  const events = { on: (name: string, handler: typeof idle) => { if (name === "thread.idle") idle = handler; } };
  let text = "";
  const work = registerWorkCards({ ...bb, events } as never, db, { read: async () => page([{ id: "m_3", text, messageSeq: 3 }]) });
  const { card, directive } = work.create({ title: "Job", threadId: "thr_main" });
  await work.list("thr_main");
  text = directive;
  idle!({ thread: { id: "thr_main" } });
  await vi.waitFor(() => expect(store.get(card.id).messageSeq).toBe(3));
});
