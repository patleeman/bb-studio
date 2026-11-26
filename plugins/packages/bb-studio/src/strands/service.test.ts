import { describe, expect, it } from "vitest";
import { runStrandsCli } from "./cli";
import { strandList } from "./contract";
import { StrandService, type WorkerFact } from "./service";
import { DONE_SHOWN_MS, EARLIER_AFTER_MS, liveState, QUIET_AFTER_MS, type Signals } from "./states";
import type { Strand } from "./store";
import type { Interaction } from "../worker-approvals";
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
  pinned: false, mergedInto: null, origin: "jev", taskId: null, waitingOn: null, waitingAt: null, doneAt: null, openedAt: null, createdAt: NOW - HOUR, parentId: null, trunk: false, ...over,
});
const signals = (over: Partial<Signals> = {}): Signals => ({ now: NOW, runningStrandId: null, workers: [], asks: [], tasks: [], ...over });

describe("live states come only from real signals", () => {
  it("needs you: a pending question or approval, a worker that needs you", () => {
    expect(liveState(strand(), signals({ asks: [{ id: "i", kind: "question", strandId: "s1", label: "A question is waiting", threadId: "t", details: [], decisions: [] }] }))).toMatchObject({ state: "needs-you", detail: "A question is waiting" });
    expect(liveState(strand(), signals({ workers: [{ threadId: "w", title: "Router fix", status: "needs-you", strandId: "s1", endedAt: null }] }))).toMatchObject({ state: "needs-you", detail: "Router fix needs you" });
    expect(liveState(strand(), signals({ asks: [{ id: "i", kind: "question", strandId: "other", label: "x", threadId: "t", details: [], decisions: [] }] })).state).toBe("active");
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

function service(options: { workers?: WorkerFact[]; asks?: Record<string, (Interaction & { createdAt?: number })[]>; busy?: boolean; areaAsks?: { id: string; kind: "area" | "flag"; label: string; at: number }[] } = {}) {
  const db = database();
  const thread = new FakeThread();
  const svc = new StrandService({
    db, conversation: (id) => (id === thread.id ? { botId: "bot", lastActiveAt: NOW } : null),
    conversationsOf: async () => [{ threadId: thread.id, title: "Main", isMain: true, lastActiveAt: NOW }], events: thread.events, jev: fakeJev(), model: fakeModel(), changed: () => {}, log: () => {}, now: () => NOW,
    setTimer: () => null, clearTimer: () => {},
    workers: async () => options.workers ?? [], interactions: async (threadId) => options.asks?.[threadId] ?? [], busy: async () => options.busy ?? false,
    extraAsks: (threadId) => (threadId === thread.id ? options.areaAsks ?? [] : []),
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

  it("shows an area's item that needs the user as needs you on the strand of the turn that holds its report, answered in the chat", async () => {
    const areaAsks: { id: string; kind: "area" | "flag"; label: string; at: number }[] = [];
    const x = service({ areaAsks });
    await x.svc.idle(x.thread.id);
    x.thread.turn("Furnace tune-up", "Asking the House runner.", { at: NOW - 3 * HOUR });
    const report = x.thread.turn("[bb message from thread:thr_house] Pick an HVAC company", "The House runner needs a pick of HVAC company.", { at: NOW - 2 * HOUR, kind: "report" });
    x.thread.turn("Book the dentist", "Ok.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    areaAsks.push({ id: "area:area_house:pick an hvac company", kind: "area", label: "House: Pick an HVAC company", at: NOW - 2 * HOUR + 5 });
    const list = strandList.parse(await x.svc.list(x.thread.id));
    const held = list.strands.find((each) => each.state === "needs-you")!;
    expect(held).toMatchObject({ detail: "House: Pick an HVAC company", asks: [{ kind: "area", threadId: x.thread.id, label: "House: Pick an HVAC company", decisions: [] }] });
    expect(x.svc.items(x.thread.id, 10).find((item) => item.seq === report.seq)?.strandId).toBe(held.id);
    expect(list.strands.filter((each) => each.state === "needs-you")).toHaveLength(1);
  });

  it("keeps workers that no strand holds for the box (running, or failed in the last 7 days); one in a strand stays on the strand, with when it ended", async () => {
    const workers: WorkerFact[] = [];
    const x = service({ workers });
    await x.svc.idle(x.thread.id);
    // Before any strand: nothing to join.
    workers.push(
      { threadId: "thr_lost", title: "Router probe", status: "failed", createdAt: NOW - 30 * HOUR, endedAt: NOW - 20 * HOUR },
      { threadId: "thr_old", title: "Old probe", status: "failed", createdAt: NOW - 9 * 24 * HOUR, endedAt: NOW - 8 * 24 * HOUR },
      { threadId: "thr_ok", title: "Lint", status: "done", createdAt: NOW - 30 * HOUR, endedAt: NOW - 20 * HOUR },
      { threadId: "thr_run", title: "Photo import", status: "running", createdAt: NOW - 30 * HOUR, endedAt: null },
    );
    const alone = strandList.parse(await x.svc.list(x.thread.id));
    expect(alone.strands).toEqual([]);
    expect(alone.strayWorkers).toEqual([
      { threadId: "thr_run", title: "Photo import", status: "running", endedAt: null },
      { threadId: "thr_lost", title: "Router probe", status: "failed", endedAt: NOW - 20 * HOUR },
    ]);
    x.thread.turn("Look at the router", "Starting a worker.", { at: NOW - 2 * HOUR });
    await x.svc.idle(x.thread.id);
    workers.push({ threadId: "thr_fix", title: "Router fix", status: "failed", createdAt: NOW - 2 * HOUR + 2, endedAt: NOW - HOUR });
    const list = strandList.parse(await x.svc.list(x.thread.id));
    expect(list.strayWorkers.map((worker) => worker.threadId)).toEqual(["thr_run", "thr_lost"]);
    expect(list.strands[0]!.workers).toEqual([{ threadId: "thr_fix", title: "Router fix", status: "failed", endedAt: NOW - HOUR }]);
  });

  it("answers no stray workers where strands don't run", async () => {
    const x = service({ workers: [{ threadId: "thr_lost", title: "Router probe", status: "failed", createdAt: NOW - HOUR, endedAt: NOW - HOUR }] });
    expect((await x.svc.list("thr_other")).strayWorkers).toEqual([]);
  });

  it("lists what waits on the user in a strand: an approval with BB's choices, a worker's question", async () => {
    const workers: WorkerFact[] = [];
    const asks: Record<string, (Interaction & { createdAt?: number })[]> = {};
    const x = service({ workers, asks });
    await x.svc.idle(x.thread.id);
    x.thread.turn("Look at the router", "Starting a worker.", { at: NOW - 2 * HOUR });
    x.thread.turn("Book the dentist", "Ok.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    asks.thr_main = [{ id: "int_1", status: "pending", createdAt: NOW - HOUR + 5, payload: { kind: "approval", availableDecisions: ["allow_once", "deny"], subject: { kind: "command", command: "npm publish" } } }];
    workers.push({ threadId: "thr_worker", title: "Router fix", status: "needs-you", createdAt: NOW - 2 * HOUR + 2, endedAt: null });
    asks.thr_worker = [{ id: "int_2", status: "pending", payload: { kind: "user_question", questions: [{ prompt: "Which fallback model?" }] } as never }];
    const list = await x.svc.list(x.thread.id);
    expect(list.strands.map((each) => [each.title, each.state])).toEqual([["Book the dentist", "needs-you"], ["Look at the router", "needs-you"]]);
    expect(list.strands[0]!.asks).toEqual([{ id: "int_1", kind: "approval", threadId: "thr_main", label: "Approve: npm publish", details: ["Command: npm publish"], decisions: ["deny", "allow_once"], turnId: expect.any(String), seq: null }]);
    expect(list.strands[1]!.asks).toEqual([{ id: "int_2", kind: "question", threadId: "thr_worker", label: "Router fix: Which fallback model?", details: [], decisions: [], turnId: null, seq: null }]);
  });

  it("puts a worker's completion notice into the worker's strand, without asking Jev", async () => {
    const workers: WorkerFact[] = [];
    const x = service({ workers });
    await x.svc.idle(x.thread.id);
    x.thread.turn("Look at the router", "Starting a worker.", { at: NOW - 2 * HOUR });
    x.thread.turn("Book the dentist", "Ok.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    workers.push({ threadId: "thr_worker1", title: "Router fix", status: "done", createdAt: NOW - 2 * HOUR + 2, endedAt: NOW - 10 });
    const notice = x.thread.turn("[bb system] @thread:thr_worker1 completed: Fixed the fallback chain.", "The router fix is done.", { kind: "report", at: NOW - 5 });
    await x.svc.idle(x.thread.id);
    const item = x.svc.items(x.thread.id, 10).find((each) => each.seq === notice.seq)!;
    expect(item).toMatchObject({ kind: "report", by: "inherit" });
    expect((await x.svc.list(x.thread.id)).strands.find((each) => each.id === item.strandId)?.title).toBe("Look at the router");
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
    expect(tags).toMatchObject([{ turnId: a.turnId, seq: a.seq, strandId: strands[0]!.id, kind: "user", line: "Look at the router", also: [] }, { turnId: b.turnId, seq: b.seq, strandId: null, kind: "user", line: "thanks", also: [] }]);
    expect(typeof tags[0]!.at).toBe("number");
    expect(strands[0]).toEqual({ id: strands[0]!.id, title: strands[0]!.title, done: false, parentId: null, trunk: false });
    // The opening message, with its turn's reply (a filter never shows the opening message; a jump lands on the reply).
    const opening = x.svc.tags(x.thread.id).opening;
    expect(opening?.seq).toBe(a.seq);
    expect(opening?.replySeq).toBeGreaterThan(a.seq);
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

describe("strands list concurrency", () => {
  it("calls busy() once per list() and reads multiple conversations concurrently while preserving order", async () => {
    const db = database();
    const busyCalls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const threads = ["thr_1", "thr_2", "thr_3"];
    const svc = new StrandService({
      db,
      conversation: (id) => (threads.includes(id) ? { botId: "bot", lastActiveAt: NOW } : null),
      conversationsOf: async () => [
        { threadId: "thr_1", title: "One", isMain: false, lastActiveAt: NOW - 1_000 },
        { threadId: "thr_2", title: "Two", isMain: false, lastActiveAt: NOW - 2_000 },
        { threadId: "thr_3", title: "Three", isMain: false, lastActiveAt: NOW - 3_000 },
      ],
      events: async () => [],
      jev: fakeJev(),
      model: fakeModel(),
      changed: () => {},
      log: () => {},
      now: () => NOW,
      setTimer: () => null,
      clearTimer: () => {},
      workers: async () => [],
      interactions: async () => [],
      busy: async (threadId) => {
        busyCalls.push(threadId);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        return false;
      },
    });
    for (const id of threads) {
      svc.store.saveRead(id, { backfill: JSON.stringify({ at: NOW }) });
      svc.store.create({ threadId: id, title: `Strand ${id}`, origin: "user", seq: 1, at: NOW - 1_000 });
    }

    // Single list() must call busy() only once (not twice).
    await svc.list("thr_1");
    expect(busyCalls).toEqual(["thr_1"]);

    // The needs-you check must read the 3 conversations concurrently and preserve order.
    busyCalls.length = 0;
    maxInFlight = 0;
    const ov = await svc.needsYouCheck("bot", 0);
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    expect(busyCalls.sort()).toEqual(["thr_1", "thr_2", "thr_3"]);
    expect(ov.conversations.map((c) => c.threadId)).toEqual(["thr_1", "thr_2", "thr_3"]);
  });
});
