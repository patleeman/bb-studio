import { describe, expect, it } from "vitest";
import { BACKFILL_MESSAGES, JEV_DAILY_CAP, StrandDetector, type DetectorDeps } from "./detector";
import { StrandStore } from "./store";
import { database, FakeThread, fakeJev, fakeModel, manualTimers, TOPICS } from "./test/fixture";
import { isGoodName } from "./naming";

const DAY = "2026-11-20";
const NOW = Date.parse(`${DAY}T12:00:00Z`);

function setup(options: { jevDown?: boolean; modelDown?: boolean; badNames?: boolean; tasks?: { id: string; title: string; updatedAt: number }[] } = {}) {
  const db = database();
  const store = new StrandStore(db, () => NOW);
  const thread = new FakeThread();
  const jevCalls: { state: unknown; questions: Record<string, unknown> }[] = [];
  const modelCalls: string[] = [];
  const timers = manualTimers();
  const changed: string[] = [];
  const deps: DetectorDeps = {
    store, events: thread.events, jev: fakeJev(jevCalls, { down: options.jevDown }), model: fakeModel(modelCalls, { down: options.modelDown, badNames: options.badNames }),
    openTasks: () => options.tasks ?? [], changed: (id) => changed.push(id), log: () => {}, now: () => NOW,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  };
  const detector = new StrandDetector(deps);
  const timersRun = () => timers.runAll(() => detector.settled(thread.id));
  return { db, store, thread, detector, jevCalls, modelCalls, timers, timersRun, changed };
}

const titles = (store: StrandStore, threadId = "thr_main") => store.list(threadId).map((strand) => strand.title).sort();
const strandOfSeq = (store: StrandStore, seq: number) => {
  const item = store.item("thr_main", "user", seq) ?? store.item("thr_main", "report", seq);
  return item?.strandId ? store.get(item.strandId)?.title ?? null : null;
};

describe("sorting each finished turn", () => {
  it("puts a turn into an open strand, a new one or none, and the small model names new strands", async () => {
    const x = setup();
    await x.detector.backfill(x.thread.id);
    const a = x.thread.turn("Can you look at the model router fallback again?", "Looking at the router now.");
    await x.detector.idle(x.thread.id);
    // A new strand right away, titled with the message's first line.
    expect(titles(x.store)).toEqual(["Can you look at the model router fallback again?"]);
    await x.timersRun();
    expect(titles(x.store)).toEqual(["Model router"]);

    const b = x.thread.turn("The router failed on Sonnet again", "Fixed the chain.");
    const thanks = x.thread.turn("thanks!", "Any time.");
    const c = x.thread.turn("Book the furnace service for next week", "Asked for dates.");
    await x.detector.idle(x.thread.id);
    await x.timersRun();
    expect(strandOfSeq(x.store, a.seq)).toBe("Model router");
    expect(strandOfSeq(x.store, b.seq)).toBe("Model router");
    expect(x.store.item(x.thread.id, "user", thanks.seq)).toMatchObject({ strandId: null, by: "jev" });
    expect(strandOfSeq(x.store, c.seq)).toBe("Furnace tune-up");
    expect(titles(x.store)).toEqual(["Furnace tune-up", "Model router"]);
    // Every name keeps the naming rule.
    for (const title of titles(x.store)) expect(isGoodName(title)).toBe(true);
    // The reply inherits its turn's strand, for the message tags.
    const reply = x.store.items(x.thread.id, 50, ["reply"]).find((item) => item.turnId === a.turnId);
    expect(reply).toMatchObject({ by: "inherit", strandId: x.store.item(x.thread.id, "user", a.seq)!.strandId });
    expect(x.store.byTurn(x.thread.id, c.turnId)?.strandId).toBe(x.store.item(x.thread.id, "user", c.seq)!.strandId);
  });

  it("puts an unsure answer (below 0.5) into the previous turn's strand, marked unsure", async () => {
    const x = setup();
    await x.detector.backfill(x.thread.id);
    x.thread.turn("Book the dentist for March", "Booked.");
    x.thread.turn("Look at the router fallback", "On it.");
    const hmm = x.thread.turn("hmm, and what about the other one", "Which one?");
    await x.detector.idle(x.thread.id);
    const item = x.store.item(x.thread.id, "user", hmm.seq)!;
    expect(item.unsure).toBe(true);
    expect(item.confidence).toBeLessThan(0.5);
    expect(x.store.get(item.strandId!)?.title).toContain("router");
  });

  it("sends Jev the message, the reply's start, the previous strand and at most 12 open strands", async () => {
    const x = setup();
    await x.detector.backfill(x.thread.id);
    for (const word of Object.keys(TOPICS)) x.thread.turn(`Start on the ${word} please`, `Starting the ${word}.`);
    x.thread.turn(`Another thing about the roof ${"x".repeat(5_000)}`, `Reply ${"y".repeat(3_000)}`);
    await x.detector.idle(x.thread.id);
    const last = x.jevCalls.at(-1)!;
    const state = last.state as { message: string; replyStart: string; previousStrand: string; strands: unknown[] };
    expect(state.message.length).toBeLessThanOrEqual(2_000);
    expect(state.replyStart.length).toBeLessThanOrEqual(800);
    expect(state.strands.length).toBeLessThanOrEqual(12);
    expect(Object.keys((last.questions.strand as { criteria: object }).criteria)).toEqual(expect.arrayContaining(["s1", "new", "none"]));
    // Each open strand also carries its newest lines (at most 3 of 160 characters), and the state the turn before it.
    expect((state.strands as { newest?: string[] }[]).every((strand) => (strand.newest ?? []).length <= 3 && (strand.newest ?? []).every((line) => line.length <= 160))).toBe(true);
    expect(JSON.stringify(last).length).toBeLessThan(16_000);
  });

  it("doesn't sort pings; files a report the reply passes over quietly with the previous turn's strand, without Jev (richer sorting asks Jev)", async () => {
    const x = setup();
    await x.detector.backfill(x.thread.id);
    const ping = x.thread.turn("", "[PASS]", { kind: "ping" });
    const quiet = x.thread.turn("Security check: all clear", "[PASS]", { kind: "report" });
    const report = x.thread.turn("Backup check: 2 snapshots failed", "The backup failed twice; I'll look.", { kind: "report" });
    await x.detector.idle(x.thread.id);
    expect(x.store.item(x.thread.id, "report", ping.seq)).toBeNull();
    expect(x.store.item(x.thread.id, "report", quiet.seq)).toMatchObject({ by: "fallback" });
    expect(x.store.item(x.thread.id, "report", report.seq)).toMatchObject({ by: "jev" });
  });

  it("stops at 300 Jev calls a day per conversation, then uses the previous turn's strand", async () => {
    const x = setup();
    await x.detector.backfill(x.thread.id);
    const garden = x.thread.turn("Start the garden beds", "Ok.");
    await x.detector.idle(x.thread.id);
    x.store.saveRead(x.thread.id, { day: DAY, jevCalls: JEV_DAILY_CAP });
    const before = x.jevCalls.length;
    const next = x.thread.turn("Now the passport renewal", "Ok.");
    await x.detector.idle(x.thread.id);
    expect(x.jevCalls.length).toBe(before);
    expect(x.store.item(x.thread.id, "user", next.seq)).toMatchObject({ by: "fallback" });
    expect(strandOfSeq(x.store, next.seq)).toBe(strandOfSeq(x.store, garden.seq));
    expect(strandOfSeq(x.store, next.seq)).not.toBeNull();
  });

  it("without Jev, the small model sorts in a batch; without either, the previous turn's strand", async () => {
    const x = setup({ jevDown: true });
    await x.detector.backfill(x.thread.id);
    const a = x.thread.turn("Check the laptop battery", "Ok.");
    const b = x.thread.turn("And the podcast edit", "Ok.");
    await x.detector.idle(x.thread.id);
    expect(x.store.item(x.thread.id, "user", a.seq)).toMatchObject({ by: "pending" });
    await x.timersRun();
    expect(x.store.item(x.thread.id, "user", a.seq)).toMatchObject({ by: "model" });
    expect(strandOfSeq(x.store, a.seq)).toBe("Laptop battery");
    expect(strandOfSeq(x.store, b.seq)).toBe("Podcast edit");

    const y = setup({ jevDown: true, modelDown: true });
    await y.detector.backfill(y.thread.id);
    y.thread.turn("Check the laptop battery", "Ok.");
    await y.detector.idle(y.thread.id);
    await y.timersRun();
    expect(y.store.items(y.thread.id, 10).every((item) => item.by === "fallback")).toBe(true);
  });

  it("folds a new strand into an open one when the small model says it is the same work", async () => {
    const x = setup();
    await x.detector.backfill(x.thread.id);
    x.thread.turn("Look at the router", "Ok.");
    await x.detector.idle(x.thread.id);
    await x.timersRun();
    // Jev calls this one new (its own wording), the model says it is the router again.
    const strand = x.store.create({ threadId: x.thread.id, title: "router chain broke", origin: "jev", seq: 99, at: NOW });
    x.store.put({ threadId: x.thread.id, seq: 99, kind: "user", turnId: "t99", at: NOW, line: "the router chain broke", strandId: strand.id, confidence: 0.8, by: "jev" });
    await x.detector.nameNow(x.thread.id);
    expect(x.store.get(strand.id)?.mergedInto).toBeTruthy();
    expect(titles(x.store)).toEqual(["Model router"]);
    expect(strandOfSeq(x.store, 99)).toBe("Model router");
  });

  it("never takes a name that breaks the rule; it tries again, then keeps the first line", async () => {
    const x = setup({ badNames: true });
    await x.detector.backfill(x.thread.id);
    x.thread.turn("Look at the router", "Ok.");
    await x.detector.idle(x.thread.id);
    for (let round = 0; round < 4; round++) await x.detector.nameNow(x.thread.id);
    const [strand] = x.store.list(x.thread.id);
    expect(strand).toMatchObject({ title: "Look at the router", named: false, nameTries: 3 });
  });

  it("keeps a name once given: new messages don't rename it", async () => {
    const x = setup();
    await x.detector.backfill(x.thread.id);
    x.thread.turn("Look at the router", "Ok.");
    await x.detector.idle(x.thread.id);
    await x.timersRun();
    for (let round = 0; round < 5; round++) x.thread.turn(`router round ${round}: the fallback chain and the retry budget`, "Ok.");
    await x.detector.idle(x.thread.id);
    await x.timersRun();
    expect(titles(x.store)).toEqual(["Model router"]);
  });
});

describe("a running turn", () => {
  it("is sorted early when it asks the user something, and not sorted again when it ends", async () => {
    const x = setup();
    await x.detector.backfill(x.thread.id);
    const turn = x.thread.turn("Release the plugins PR", "", { done: false });
    await x.detector.asked(x.thread.id);
    expect(x.detector.runningStrand(x.thread.id)).toBe(x.store.item(x.thread.id, "user", turn.seq)!.strandId);
    const calls = x.jevCalls.length;
    x.thread.finish(turn.turnId, "Released.");
    await x.detector.idle(x.thread.id);
    // Not sorted again: the one call at its end only tags its reply (src/strands/reply.ts).
    expect(x.jevCalls.length).toBe(calls + 1);
    expect(Object.keys(x.jevCalls.at(-1)!.questions)).toEqual(["reply", "askSentence"]);
    expect(x.detector.hasRunningTurn(x.thread.id)).toBe(false);
    expect(x.store.items(x.thread.id, 10, ["reply"])).toHaveLength(1);
  });

  it("isn't sorted while it runs unless it runs long; the read starts again at it", async () => {
    const x = setup();
    await x.detector.backfill(x.thread.id);
    x.thread.turn("Look at the router", "Ok.");
    const running = x.thread.turn("Now the roof leak", "", { done: false });
    await x.detector.idle(x.thread.id);
    expect(x.store.item(x.thread.id, "user", running.seq)).toBeNull();
    expect(x.store.read(x.thread.id)!.seenSeq).toBe(running.seq - 1);
    expect(x.detector.hasRunningTurn(x.thread.id)).toBe(true);
    expect(x.detector.runningStrand(x.thread.id)).toBeNull();
    // Running long: the early-sort timer sorts it.
    x.detector.active(x.thread.id);
    await x.timersRun();
    expect(x.store.item(x.thread.id, "user", running.seq)).not.toBeNull();
  });
});

describe("the backfill against a 5,000-message conversation", () => {
  const TOTAL = 5_000;
  const words = Object.keys(TOPICS);
  const build = () => {
    const x = setup({ tasks: [{ id: "task_release", title: "Worker: Router release (phase 2)", updatedAt: NOW - 1_000 }, { id: "task_vague", title: "Follow up on the thing", updatedAt: NOW - 2_000 }] });
    for (let index = 0; index < TOTAL; index++) {
      const word = words[Math.floor(index / 7) % words.length]!;
      x.thread.turn(index % 25 === 24 ? "thanks" : `Message ${index} about the ${word}: ${"detail ".repeat(index % 40)}`, `Reply ${index} on the ${word}.`, { at: NOW - (TOTAL - index) * 60_000, tools: 2 });
    }
    return x;
  };

  it("sorts only the newest 300 messages from the user, 32 per Jev call, and turns open tasks into strands", async () => {
    const x = build();
    const started = performance.now();
    const report = await x.detector.backfill(x.thread.id);
    const ms = performance.now() - started;
    expect(report).toMatchObject({ messages: BACKFILL_MESSAGES, jevCalls: Math.ceil(BACKFILL_MESSAGES / 32), tasks: 2 });
    expect(report!.sorted).toBe(BACKFILL_MESSAGES);
    // One proposal call; no batch sorting by the model with Jev up.
    expect(x.modelCalls.filter((prompt) => prompt.includes("Propose at most"))).toHaveLength(1);
    // Each Jev call fits Decisions' 64,000-character state.
    for (const call of x.jevCalls) expect(JSON.stringify(call.state).length).toBeLessThanOrEqual(64_000);
    const items = x.store.items(x.thread.id, 10_000);
    expect(items).toHaveLength(BACKFILL_MESSAGES);
    // The oldest sorted message is among the newest 300 turns (4 events each, 2 tools: 6 per turn).
    expect(Math.min(...items.map((item) => item.seq))).toBeGreaterThan((TOTAL - BACKFILL_MESSAGES - 1) * 6);
    const strands = x.store.list(x.thread.id);
    expect(strands.filter((strand) => strand.origin === "task").map((strand) => [strand.taskId, strand.named])).toEqual(expect.arrayContaining([["task_release", true], ["task_vague", false]]));
    expect(strands.find((strand) => strand.taskId === "task_release")?.title).toBe("Router release");
    // Proposed strands no message went to were dropped; the rest have names that keep the rule.
    for (const strand of strands.filter((each) => each.origin === "backfill")) {
      expect(x.store.counts(x.thread.id).get(strand.id)?.messages ?? 0).toBeGreaterThan(0);
      expect(isGoodName(strand.title)).toBe(true);
    }
    expect(x.store.read(x.thread.id)!.seenSeq).toBe(x.thread.rows.length);
    expect(ms).toBeLessThan(5_000);
  });

  it("then sorts a new turn with a prompt the same size as in a short conversation, reading only what is new", async () => {
    const x = build();
    await x.detector.backfill(x.thread.id);
    const pages = x.thread.pages;
    const calls = x.jevCalls.length;
    const turn = x.thread.turn("One more on the furnace", "Ok.");
    const started = performance.now();
    await x.detector.idle(x.thread.id);
    expect(performance.now() - started).toBeLessThan(500);
    expect(x.thread.pages - pages).toBe(1);
    expect(x.jevCalls.length).toBe(calls + 1);
    const state = x.jevCalls.at(-1)!.state as { strands: unknown[] };
    expect(state.strands.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(x.jevCalls.at(-1)).length).toBeLessThan(9_000);
    expect(strandOfSeq(x.store, turn.seq)).toBe("Furnace tune-up");
  });

  it("looks rows up by index, never by scanning the conversation's items", async () => {
    const x = build();
    await x.detector.backfill(x.thread.id);
    const plan = (sql: string, ...params: unknown[]) => (x.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((row) => row.detail).join(" | ");
    const lookups = [
      plan("SELECT strand_id, seq FROM strand_items WHERE thread_id = ? AND at <= ? AND kind IN ('user', 'report') ORDER BY at DESC, seq DESC LIMIT 1", "thr_main", NOW),
      plan("SELECT strand_id FROM strand_items WHERE thread_id = ? AND seq < ? AND kind IN ('user', 'report') AND strand_id IS NOT NULL ORDER BY seq DESC LIMIT 1", "thr_main", 10),
      plan("SELECT * FROM strand_items WHERE thread_id = ? AND strand_id = ? AND kind IN ('user', 'report') ORDER BY seq DESC LIMIT 1", "thr_main", "s"),
      plan("SELECT * FROM strand_items WHERE thread_id = ? AND turn_id = ? AND kind IN ('user', 'report') ORDER BY seq LIMIT 1", "thr_main", "t"),
      plan("SELECT * FROM strands WHERE thread_id = ? AND merged_into IS NULL ORDER BY last_at DESC, id LIMIT ?", "thr_main", 12),
    ];
    for (const detail of lookups) {
      expect(detail).toMatch(/USING (?:COVERING )?INDEX|USING PRIMARY KEY/);
      expect(detail).not.toMatch(/SCAN strand_items(?! USING)/);
    }
  });
});
