import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { z } from "zod";
import { MIGRATIONS } from "../migrations";
import { runWorkCli } from "./cli";
import { rpcContract, SHOW_FINISHED_MS, type WorkCard } from "./contract";
import { CREATE_DESCRIPTION, endsCard, findCardMessage, registerWorkCards, WORK_TOOLS, type TimelineReader, type WorkerThread } from "./register";
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
  const at = (minutes: number, patch: Partial<WorkCard>): WorkCard => ({ id: `wc_${minutes}`, threadId: "t", title: String(minutes), kind: "task", state: "running", step: null, line: null, needs: null, workerThreadId: null, messageId: null, messageSeq: null, createdAt: minutes, updatedAt: minutes, finishedAt: null, stale: false, dismissedAt: null, ...patch });
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
    sdk: { threads: { timeline: vi.fn(), update: vi.fn(async (_input: unknown) => ({})), get: vi.fn(async (_input: unknown) => ({ status: "active", archivedAt: null })) } },
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

it("gives a worker's thread its card's title, so the card, the sidebar and the chips use one name", async () => {
  const { bb, tools } = fakeBb();
  registerWorkCards(bb as never, db, { read: async () => page([]) });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const made = JSON.parse(await tools.work_card_create!.execute({ title: "Research: 3 note-taking methods", kind: "worker" }, { threadId: "thr_main" })) as { id: string };
  await flush();
  expect(bb.sdk.threads.update).not.toHaveBeenCalled();
  await tools.work_card_update!.execute({ id: made.id, workerThreadId: "thr_worker" }, {});
  await flush();
  expect(bb.sdk.threads.update).toHaveBeenLastCalledWith({ threadId: "thr_worker", title: "Research: 3 note-taking methods" });
  await tools.work_card_update!.execute({ id: made.id, step: "2/3 Comparing" }, {});
  await flush();
  expect(bb.sdk.threads.update).toHaveBeenCalledTimes(1);
  await tools.work_card_update!.execute({ id: made.id, title: "Research: note-taking" }, {});
  await flush();
  expect(bb.sdk.threads.update).toHaveBeenLastCalledWith({ threadId: "thr_worker", title: "Research: note-taking" });
  await tools.work_card_create!.execute({ title: "Worker: lint", kind: "worker", workerThreadId: "thr_lint" }, { threadId: "thr_main" });
  await tools.work_card_create!.execute({ title: "Lead: v2", kind: "lead", workerThreadId: "thr_lead" }, { threadId: "thr_main" });
  await flush();
  expect(bb.sdk.threads.update.mock.calls.map(([input]) => input)).toEqual([
    { threadId: "thr_worker", title: "Research: 3 note-taking methods" },
    { threadId: "thr_worker", title: "Research: note-taking" },
    { threadId: "thr_lint", title: "Worker: lint" },
  ]);
  bb.sdk.threads.update.mockRejectedValueOnce(new Error("gone"));
  await tools.work_card_update!.execute({ id: made.id, title: "Research" }, {});
  await flush();
  expect(bb.log.warn).toHaveBeenCalledWith(expect.stringContaining("gone"));
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

it("tells the Bot to link a worker's thread in a form the chat opens", () => {
  expect(CREATE_DESCRIPTION).toContain("bare @thread:thr_… mention or [text](/threads/thr_…), never [text](@thread:thr_…)");
});

it("clears a conversation's finished cards from In flight and keeps them readable", () => {
  const live = store.create({ title: "Live", threadId: "thr_main" });
  const done = store.create({ title: "Done", threadId: "thr_main" });
  const failed = store.create({ title: "Failed", threadId: "thr_main" });
  const other = store.create({ title: "Other done", threadId: "thr_other" });
  for (const card of [done, failed, other]) store.update(card.id, { state: card === failed ? "failed" : "done" });
  const changed = vi.fn();
  const watched = new WorkCardStore(db, changed);
  expect(watched.clearFinished("thr_main")).toBe(2);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(store.inFlight("thr_main").map((card) => card.id)).toEqual([live.id]);
  expect(store.inFlight("thr_other").map((card) => card.id)).toEqual([other.id]);
  expect(store.get(done.id)).toMatchObject({ state: "done", dismissedAt: NOW });
  expect(watched.clearFinished("thr_main")).toBe(0);
  expect(changed).toHaveBeenCalledTimes(1);
});

it("dismisses one row for good, and brings it back only when the work restarts or needs the user", () => {
  const done = store.create({ title: "Done", threadId: "thr_main", state: "done" });
  const live = store.create({ title: "Live", threadId: "thr_main" });
  store.dismiss(done.id);
  store.dismiss(live.id);
  expect(store.inFlight("thr_main")).toEqual([]);
  expect(new WorkCardStore(db).inFlight("thr_main")).toEqual([]);
  store.update(live.id, { line: "Still going" });
  store.update(done.id, { line: "Notes" });
  expect(store.inFlight("thr_main")).toEqual([]);
  expect(store.update(live.id, { state: "needs-you", needs: "Approve" }).dismissedAt).toBeNull();
  expect(store.update(done.id, { state: "running" }).dismissedAt).toBeNull();
  expect(store.inFlight("thr_main").map((card) => card.title)).toEqual(["Live", "Done"]);
});

it("still drops a finished or ended card from In flight after a day", () => {
  const done = store.create({ title: "Done", threadId: "thr_main", state: "done" });
  const ended = store.create({ title: "Ended", threadId: "thr_main", workerThreadId: "thr_w" });
  store.markStale(ended.id);
  vi.setSystemTime(NOW + SHOW_FINISHED_MS - 1);
  expect(store.inFlight("thr_main").map((card) => card.id).sort()).toEqual([done.id, ended.id].sort());
  vi.setSystemTime(NOW + SHOW_FINISHED_MS + 1);
  expect(store.inFlight("thr_main")).toEqual([]);
});

it("reads cards saved before stale and dismissals existed", () => {
  const { stale: _stale, dismissedAt: _dismissed, ...old } = store.create({ title: "Old", threadId: "thr_main" });
  db.prepare("UPDATE work_cards SET record = ? WHERE id = ?").run(JSON.stringify(old), old.id);
  expect(store.get(old.id)).toMatchObject({ stale: false, dismissedAt: null });
  expect(store.inFlight("thr_main")).toHaveLength(1);
});

it("marks a card ended as done with stale set, and the next real update takes over", () => {
  const card = store.create({ title: "Worker", kind: "worker", threadId: "thr_main", workerThreadId: "thr_w", step: "2/4" });
  vi.setSystemTime(NOW + 1_000);
  const ended = store.markStale(card.id);
  expect(ended).toMatchObject({ state: "done", stale: true, finishedAt: NOW + 1_000, step: "2/4" });
  expect(rpcContract["work.get"].output.parse(ended).state).toBe("done");
  vi.setSystemTime(NOW + 2_000);
  expect(store.update(card.id, { line: "Back at it" })).toMatchObject({ state: "running", stale: false, finishedAt: null, line: "Back at it" });
  store.markStale(card.id);
  vi.setSystemTime(NOW + 3_000);
  expect(store.update(card.id, { state: "done", line: "Shipped" })).toMatchObject({ state: "done", stale: false, finishedAt: NOW + 3_000 });
  expect(store.markStale(card.id).stale).toBe(false);
});

it("ends a card when its worker finishes or goes away, never a lead's or the conversation's own", () => {
  const card = (patch: Partial<WorkCard>): WorkCard => ({ ...store.create({ title: "W", kind: "worker", threadId: "thr_main", workerThreadId: "thr_w" }), ...patch });
  const idle: WorkerThread = { status: "idle", archivedAt: null };
  expect(endsCard(card({}), idle)).toBe(true);
  expect(endsCard(card({}), { status: "error" })).toBe(true);
  expect(endsCard(card({}), { status: "active" })).toBe(false);
  expect(endsCard(card({}), { status: "active", archivedAt: NOW })).toBe(true);
  expect(endsCard(card({}), null)).toBe(true);
  expect(endsCard(card({ state: "waiting" }), idle)).toBe(false);
  expect(endsCard(card({ state: "needs-you" }), idle)).toBe(false);
  expect(endsCard(card({ state: "needs-you" }), { status: "idle", archivedAt: NOW })).toBe(true);
  expect(endsCard(card({ kind: "lead" }), idle)).toBe(false);
  expect(endsCard(card({ workerThreadId: "thr_main" }), idle)).toBe(false);
  expect(endsCard(card({ workerThreadId: null }), null)).toBe(false);
  expect(endsCard(card({ state: "done" }), null)).toBe(false);
});

function eventBb() {
  const { bb, handlers } = fakeBb();
  const on: Record<string, (event: { thread: { id: string } }) => void> = {};
  return { bb: { ...bb, events: { on: (name: string, handler: (event: { thread: { id: string } }) => void) => { on[name] = handler; } } }, on, handlers };
}

it("ends a running worker's card when its thread goes idle, fails or is archived, and revives it when the thread runs again", async () => {
  const { bb, on } = eventBb();
  const work = registerWorkCards(bb as never, db, { read: async () => page([]), thread: async () => ({ status: "active" }) });
  await work.swept;
  const a = work.create({ title: "A", kind: "worker", threadId: "thr_main", workerThreadId: "thr_a" }).card;
  const b = work.create({ title: "B", kind: "worker", threadId: "thr_main", workerThreadId: "thr_b", state: "waiting" }).card;
  const c = work.create({ title: "C", kind: "worker", threadId: "thr_main", workerThreadId: "thr_c" }).card;
  on["thread.idle"]!({ thread: { id: "thr_a" } });
  on["thread.idle"]!({ thread: { id: "thr_b" } });
  on["thread.failed"]!({ thread: { id: "thr_c" } });
  expect(store.get(a.id)).toMatchObject({ state: "done", stale: true });
  expect(store.get(b.id)).toMatchObject({ state: "waiting", stale: false });
  expect(store.get(c.id)).toMatchObject({ state: "done", stale: true });
  on["thread.archived"]!({ thread: { id: "thr_b" } });
  expect(store.get(b.id)).toMatchObject({ state: "done", stale: true });
  on["thread.active"]!({ thread: { id: "thr_a" } });
  expect(store.get(a.id)).toMatchObject({ state: "running", stale: false, finishedAt: null });
  store.dismiss(c.id);
  on["thread.active"]!({ thread: { id: "thr_c" } });
  expect(store.get(c.id)).toMatchObject({ state: "running", dismissedAt: null });
  const finished = work.create({ title: "D", kind: "worker", threadId: "thr_main", workerThreadId: "thr_d", state: "done" }).card;
  on["thread.idle"]!({ thread: { id: "thr_d" } });
  on["thread.active"]!({ thread: { id: "thr_d" } });
  expect(store.get(finished.id)).toMatchObject({ state: "done", stale: false });
});

it("sweeps cards already stuck on Running when it loads", async () => {
  const stuck = store.create({ title: "Stuck", kind: "worker", threadId: "thr_main", workerThreadId: "thr_idle" });
  const gone = store.create({ title: "Gone", kind: "release", threadId: "thr_main", workerThreadId: "thr_archived", state: "needs-you", needs: "Sign" });
  const live = store.create({ title: "Live", kind: "worker", threadId: "thr_main", workerThreadId: "thr_live" });
  const lead = store.create({ title: "Lead", kind: "lead", threadId: "thr_main", workerThreadId: "thr_lead" });
  const unknown = store.create({ title: "Unreachable", kind: "worker", threadId: "thr_main", workerThreadId: "thr_down" });
  const threads: Record<string, WorkerThread> = { thr_idle: { status: "idle", archivedAt: null }, thr_archived: { status: "idle", archivedAt: NOW - 1 }, thr_live: { status: "active", archivedAt: null }, thr_lead: { status: "idle", archivedAt: null } };
  const { bb } = eventBb();
  const work = registerWorkCards(bb as never, db, { read: async () => page([]), thread: async (id) => { if (id === "thr_down") throw new Error("offline"); return threads[id] ?? null; } });
  await work.swept;
  expect(store.get(stuck.id)).toMatchObject({ state: "done", stale: true });
  expect(store.get(gone.id)).toMatchObject({ state: "done", stale: true, needs: null });
  expect(store.get(live.id)).toMatchObject({ state: "running", stale: false });
  expect(store.get(lead.id)).toMatchObject({ state: "running", stale: false });
  expect(store.get(unknown.id)).toMatchObject({ state: "running", stale: false });
  expect(bb.log.warn).toHaveBeenCalledWith(expect.stringContaining("offline"));
});

it("serves dismiss and clear over RPC and the CLI", async () => {
  const { bb, handlers } = fakeBb();
  const work = registerWorkCards(bb as never, db, { read: async () => page([]), thread: async () => ({ status: "active" }) });
  const a = work.create({ title: "A", threadId: "thr_main", state: "done" }).card;
  const b = work.create({ title: "B", threadId: "thr_main", state: "failed" }).card;
  const c = work.create({ title: "C", threadId: "thr_main" }).card;
  expect(rpcContract["work.dismiss"].output.parse(await handlers["work.dismiss"]!({ id: a.id } as never)).dismissedAt).toBe(NOW);
  expect(rpcContract["work.clear"].output.parse(await handlers["work.clear"]!({ threadId: "thr_main" } as never))).toEqual({ cleared: 1 });
  expect(store.inFlight("thr_main").map((card) => card.id)).toEqual([c.id]);
  work.update(b.id, { state: "running" });
  expect((await runWorkCli(["dismiss", c.id], work, {})).exitCode).toBe(0);
  work.update(b.id, { state: "done" });
  expect((await runWorkCli(["clear"], work, { threadId: "thr_main" })).stdout).toBe("Cleared 1 finished card.\n");
  expect((await runWorkCli(["clear"], work, {})).exitCode).toBe(1);
  const ended = work.create({ title: "E", kind: "worker", threadId: "thr_main", workerThreadId: "thr_e" }).card;
  store.markStale(ended.id);
  expect((await runWorkCli(["show", ended.id], work, {})).stdout).toContain("ended\tE");
});
