import { describe, expect, it } from "vitest";
import { runStrandsCli } from "./cli";
import { strandList } from "./contract";
import { StrandService, type WorkerFact } from "./service";
import { DONE_SHOWN_MS, EARLIER_AFTER_MS, liveState, QUIET_AFTER_MS, type Signals } from "./states";
import type { Strand } from "./store";
import { database, FakeThread, fakeJev, fakeModel } from "./test/fixture";
import { turnsOf } from "./turns";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("reading turns from events", () => {
  it("joins a steer to its turn, drops pings, and says where unfinished work starts", () => {
    const thread = new FakeThread();
    thread.turn("First", "One.");
    thread.turn("", "[PASS]", { kind: "ping" });
    const running = thread.turn("Second", "", { done: false });
    thread.rows.push({ seq: thread.rows.length + 1, type: "client/turn/requested", createdAt: 5, scope: { kind: "thread" }, data: { initiator: "user", input: [{ type: "text", text: "and also this" }], target: { kind: "steer" } } });
    const { turns, restFrom } = turnsOf(thread.rows);
    expect(turns.map((turn) => [turn.kind, turn.text, turn.done])).toEqual([["user", "First", true], ["report", "", true], ["user", "Second\n\nand also this", false]]);
    expect(restFrom).toBe(running.seq);
  });

  it("waits for BB to start a requested turn", () => {
    const thread = new FakeThread();
    thread.turn("First", "One.");
    thread.rows.push({ seq: thread.rows.length + 1, type: "client/turn/requested", createdAt: 5, scope: { kind: "thread" }, data: { initiator: "user", input: [{ type: "text", text: "queued" }], target: { kind: "new-turn" } } });
    const { turns, restFrom } = turnsOf(thread.rows);
    expect(turns).toHaveLength(1);
    expect(restFrom).toBe(thread.rows.length);
  });
});

const strand = (over: Partial<Strand> = {}): Strand => ({
  id: "s1", threadId: "t", title: "Model router", summary: null, named: true, nameTries: 0, summaryAt: null, firstSeq: 1, lastSeq: 1, lastAt: NOW - HOUR,
  pinned: false, mergedInto: null, origin: "jev", taskId: null, waitingOn: null, waitingAt: null, openedAt: null, createdAt: NOW - HOUR, ...over,
});
const signals = (over: Partial<Signals> = {}): Signals => ({ now: NOW, runningStrandId: null, workers: [], asks: [], tasks: [], ...over });

describe("live states come only from real signals", () => {
  it("needs you: a pending question or approval, a worker that needs you", () => {
    expect(liveState(strand(), signals({ asks: [{ id: "i", kind: "question", strandId: "s1", label: "A question is waiting" }] }))).toMatchObject({ state: "needs-you", detail: "A question is waiting" });
    expect(liveState(strand(), signals({ workers: [{ threadId: "w", title: "Router fix", status: "needs-you", strandId: "s1", endedAt: null }] }))).toMatchObject({ state: "needs-you", detail: "Router fix needs you" });
    expect(liveState(strand(), signals({ asks: [{ id: "i", kind: "question", strandId: "other", label: "x" }] })).state).toBe("active");
  });

  it("running: its turn or one of its workers", () => {
    expect(liveState(strand(), signals({ runningStrandId: "s1" })).state).toBe("running");
    expect(liveState(strand(), signals({ workers: [{ threadId: "w", title: "Router fix", status: "running", strandId: "s1", endedAt: null }] }))).toMatchObject({ state: "running", detail: "Router fix" });
  });

  it("done, not seen: a worker ended since the strand was opened, for 24 hours", () => {
    const ended = (endedAt: number) => signals({ workers: [{ threadId: "w", title: "Router fix", status: "done", strandId: "s1", endedAt }] });
    expect(liveState(strand(), ended(NOW - HOUR))).toMatchObject({ state: "done-unseen", detail: "Router fix finished" });
    expect(liveState(strand({ openedAt: NOW - HOUR / 2 }), ended(NOW - HOUR)).state).toBe("active");
    expect(liveState(strand({ lastAt: NOW - 2 * DONE_SHOWN_MS }), ended(NOW - DONE_SHOWN_MS - HOUR)).state).toBe("quiet");
  });

  it("waiting: only when an agent said so (cleared by later activity) or a linked task waits on CI or someone outside", () => {
    expect(liveState(strand({ waitingOn: "Dana's review", waitingAt: NOW - HOUR }), signals())).toMatchObject({ state: "waiting", detail: "Dana's review" });
    expect(liveState(strand({ waitingOn: "Dana's review", waitingAt: NOW - 2 * HOUR }), signals()).state).toBe("active");
    expect(liveState(strand(), signals({ tasks: [{ id: "task", strandId: "s1", waitingOn: { kind: "ci", ref: "run 42", text: null } }] }))).toMatchObject({ state: "waiting", detail: "run 42" });
    expect(liveState(strand(), signals({ tasks: [{ id: "task", strandId: "s1", waitingOn: { kind: "user", ref: null, text: null } }] })).state).toBe("active");
  });

  it("quiet after 24 hours with nothing live; Earlier after 3 more days unless pinned", () => {
    expect(liveState(strand({ lastAt: NOW - QUIET_AFTER_MS - 1 }), signals())).toMatchObject({ state: "quiet", earlier: false });
    expect(liveState(strand({ lastAt: NOW - QUIET_AFTER_MS - EARLIER_AFTER_MS - 1 }), signals())).toMatchObject({ state: "quiet", earlier: true });
    expect(liveState(strand({ lastAt: NOW - QUIET_AFTER_MS - EARLIER_AFTER_MS - 1, pinned: true }), signals())).toMatchObject({ state: "quiet", earlier: false });
  });
});

function service(options: { workers?: WorkerFact[]; asks?: { id: string; createdAt: number; label: string }[]; busy?: boolean } = {}) {
  const db = database();
  const thread = new FakeThread();
  const svc = new StrandService({
    db, conversations: () => [thread.id], events: thread.events, jev: fakeJev(), model: fakeModel(), changed: () => {}, log: () => {}, now: () => NOW,
    setTimer: () => null, clearTimer: () => {},
    workers: async () => options.workers ?? [], interactions: async () => options.asks ?? [], busy: async () => options.busy ?? false,
  });
  return { db, thread, svc };
}

describe("strands.list", () => {
  it("answers each strand with its state and latest message, valid against the contract", async () => {
    const x = service();
    await x.svc.idle(x.thread.id);
    const router = x.thread.turn("Look at the router", "Ok.", { at: NOW - 2 * HOUR });
    x.thread.turn("Book the dentist", "Ok.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    const list = strandList.parse(await x.svc.list(x.thread.id));
    expect(list.enabled).toBe(true);
    expect(list.backfill.done).toBe(true);
    expect(list.strands.map((each) => each.title)).toEqual(["Book the dentist", "Look at the router"]);
    expect(list.strands.find((each) => each.title === "Look at the router")).toMatchObject({ state: "active", latestSeq: router.seq, latestTurnId: router.turnId, messages: 1 });
    expect((await x.svc.list("thr_other")).enabled).toBe(false);
  });

  it("joins a worker to the strand of the turn it started in, and a question to the running turn's strand", async () => {
    const workers: WorkerFact[] = [];
    const x = service({ workers });
    await x.svc.idle(x.thread.id);
    x.thread.turn("Look at the router", "Starting a worker.", { at: NOW - 2 * HOUR });
    x.thread.turn("Book the dentist", "Ok.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    workers.push({ threadId: "thr_worker", title: "Router fix", status: "running", createdAt: NOW - 2 * HOUR + 2, endedAt: null });
    const list = await x.svc.list(x.thread.id);
    expect(list.strands[0]).toMatchObject({ title: "Look at the router", state: "running", workers: [{ threadId: "thr_worker", title: "Router fix", status: "running" }] });
    expect(x.svc.items(x.thread.id, 10).find((item) => item.kind === "worker")).toMatchObject({ ref: "thr_worker", by: "inherit" });
  });

  it("marks a strand opened, so what finished before isn't 'done, not seen'", async () => {
    const workers: WorkerFact[] = [{ threadId: "thr_worker", title: "Router fix", status: "done", createdAt: NOW - 2 * HOUR + 2, endedAt: NOW - HOUR }];
    const x = service({ workers });
    await x.svc.idle(x.thread.id);
    x.thread.turn("Look at the router", "Ok.", { at: NOW - 2 * HOUR });
    await x.svc.idle(x.thread.id);
    const [before] = (await x.svc.list(x.thread.id)).strands;
    expect(before!.state).toBe("done-unseen");
    expect(x.svc.opened(before!.id)).toBe(true);
    expect((await x.svc.list(x.thread.id)).strands[0]!.state).toBe("active");
  });

  it("gives each sorted turn's strand for the message tags", async () => {
    const x = service();
    await x.svc.idle(x.thread.id);
    const a = x.thread.turn("Look at the router", "Ok.");
    const b = x.thread.turn("thanks", "Sure.");
    await x.svc.idle(x.thread.id);
    const { tags, strands } = x.svc.tags(x.thread.id);
    expect(tags).toEqual(expect.arrayContaining([{ turnId: a.turnId, strandId: strands[0]!.id }, { turnId: b.turnId, strandId: null }]));
  });
});

describe("bb studio strands", () => {
  it("prints the strands and how the newest messages were sorted", async () => {
    const x = service();
    await x.svc.idle(x.thread.id);
    x.thread.turn("Look at the router", "Ok.", { at: NOW - HOUR });
    x.thread.turn("thanks", "Sure.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    const deps = { resolve: async (ref: string | null) => (ref === null || ref === "main" ? x.thread.id : ref), list: (id: string) => x.svc.list(id), items: (id: string, n: number) => x.svc.items(id, n), sort: (id: string) => x.svc.idle(id), now: () => NOW };
    const out = await runStrandsCli([], deps);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("strands on");
    expect(out.stdout).toMatch(/active\s+Look at the router/);
    expect(out.stdout).toMatch(/user\s+\(none\)\s+jev\s+0\.90\s+thanks/);
    const json = JSON.parse((await runStrandsCli(["main", "--json", "--items", "5"], deps)).stdout!);
    expect(json.strands).toHaveLength(1);
    expect(json.items).toHaveLength(2);
    expect((await runStrandsCli(["--items", "lots"], deps)).exitCode).toBe(1);
    expect((await runStrandsCli(["--bogus"], deps)).exitCode).toBe(1);
  });
});
