// Phase 3: strands in every conversation, backfilled lazily (active in the
// last 14 days, newest first), the user's edits, and the needs-you push's read.
import { describe, expect, it, vi } from "vitest";
import { overviewConversation } from "./contract";
import { BACKFILL_ACTIVE_MS, StrandService } from "./service";
import { JEV_TOTAL_DAILY_CAP, MODEL_TOTAL_DAILY_CAP } from "./detector";
import { ALL_CONVERSATIONS } from "./store";
import { database, FakeThread, FIXTURE_AT, fakeJev, fakeModel } from "./test/fixture";
import type { EventRow } from "./turns";

const NOW = FIXTURE_AT + 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function setup(threads: { id: string; title: string; isMain?: boolean; lastActiveAt: number }[]) {
  const db = database();
  const fakes = new Map(threads.map((thread) => [thread.id, new FakeThread(thread.id)]));
  const backfilled: string[] = [];
  const svc = new StrandService({
    db,
    conversation: (id) => { const thread = threads.find((each) => each.id === id); return thread ? { botId: "bot", lastActiveAt: thread.lastActiveAt } : null; },
    conversationsOf: async () => threads.map((thread) => ({ threadId: thread.id, title: thread.title, isMain: !!thread.isMain, lastActiveAt: thread.lastActiveAt })),
    events: async (input) => {
      if (input.order === "desc" && input.beforeSeq === undefined) backfilled.push(input.threadId);
      return (await fakes.get(input.threadId)?.events(input)) ?? ([] as EventRow[]);
    },
    jev: fakeJev(), model: fakeModel(), changed: () => {}, log: () => {}, now: () => NOW,
    setTimer: () => null, clearTimer: () => {},
    workers: async () => [], interactions: async () => [], busy: async () => false,
  });
  return { db, svc, thread: (id: string) => fakes.get(id)!, backfilled };
}

describe("strands in every conversation", () => {
  it("sorts any Bot conversation, not only Main", async () => {
    const x = setup([{ id: "thr_main", title: "Main", isMain: true, lastActiveAt: NOW }, { id: "thr_studio", title: "BB Studio", lastActiveAt: NOW }]);
    x.thread("thr_studio").turn("Look at the router fallback", "Ok.");
    await x.svc.idle("thr_studio", true);
    x.thread("thr_studio").turn("thanks", "Sure.");
    await x.svc.idle("thr_studio", true);
    const list = await x.svc.list("thr_studio");
    expect(list.enabled).toBe(true);
    expect(list.strands.map((strand) => strand.messages)).toEqual([1]);
  });

  it("backfills only conversations active in the last 14 days, when opened, the most recently active first", async () => {
    const x = setup([
      { id: "thr_old", title: "Old", lastActiveAt: NOW - BACKFILL_ACTIVE_MS - DAY },
      { id: "thr_a", title: "A", lastActiveAt: NOW - 3 * DAY },
      { id: "thr_b", title: "B", lastActiveAt: NOW - DAY },
    ]);
    for (const id of ["thr_old", "thr_a", "thr_b"]) x.thread(id).turn("Look at the router", "Ok.");
    // Opening reads the list; the backfill runs behind it.
    await x.svc.list("thr_old");
    expect(x.svc.detector.needsBackfill("thr_old")).toBe(true);
    const a = x.svc.requestBackfill("thr_a");
    const b = x.svc.requestBackfill("thr_b");
    await Promise.all([a, b]);
    expect(new Set(x.backfilled)).toEqual(new Set(["thr_a", "thr_b"]));
    expect(x.svc.detector.needsBackfill("thr_a")).toBe(false);
    expect(x.svc.detector.needsBackfill("thr_old")).toBe(true);
    // A turn that just ended in an old conversation makes it active: it is backfilled.
    await x.svc.idle("thr_old", true);
    expect(x.svc.detector.needsBackfill("thr_old")).toBe(false);
  });

  it("picks the most recently active conversation first when several wait", async () => {
    const x = setup([
      { id: "thr_1", title: "1", lastActiveAt: NOW - 5 * DAY },
      { id: "thr_2", title: "2", lastActiveAt: NOW - 1 * DAY },
      { id: "thr_3", title: "3", lastActiveAt: NOW - 3 * DAY },
    ]);
    for (const id of ["thr_1", "thr_2", "thr_3"]) x.thread(id).turn("Look at the router", "Ok.");
    // thr_1 starts at once; thr_2 and thr_3 wait behind it and go newest first.
    await Promise.all([x.svc.requestBackfill("thr_1"), x.svc.requestBackfill("thr_3"), x.svc.requestBackfill("thr_2")]);
    expect(x.backfilled).toEqual(["thr_1", "thr_2", "thr_3"]);
  });
});

describe("the user's edits", () => {
  async function day() {
    const x = setup([{ id: "thr_main", title: "Main", isMain: true, lastActiveAt: NOW }]);
    const t = x.thread("thr_main");
    const turns = [
      t.turn("Look at the router fallback", "Ok."),
      t.turn("router: also the retry budget", "Ok."),
      t.turn("router: and the default chain", "Ok."),
      t.turn("Book the dentist", "Ok."),
    ];
    await x.svc.idle("thr_main", true);
    const byTitle = async () => new Map((await x.svc.list("thr_main")).strands.map((strand) => [strand.title, strand]));
    return { x, turns, byTitle };
  }

  it("moves a message's turn (its reply too) to another strand, and it stays there", async () => {
    const { x, turns, byTitle } = await day();
    const strands = await byTitle();
    const dentist = [...strands.values()].find((strand) => strand.title.toLowerCase().includes("dentist"))!;
    expect(x.svc.move("thr_main", turns[1]!.seq, dentist.id)).toBe(true);
    const items = x.svc.items("thr_main", 10);
    expect(items.find((item) => item.seq === turns[1]!.seq)).toMatchObject({ strandId: dentist.id, by: "user" });
    expect(x.svc.tags("thr_main").tags.find((tag) => tag.turnId === turns[1]!.turnId)?.strandId).toBe(dentist.id);
    // Another sort doesn't move it back.
    x.thread("thr_main").turn("router: one more", "Ok.");
    await x.svc.idle("thr_main", true);
    expect(x.svc.items("thr_main", 10).find((item) => item.seq === turns[1]!.seq)?.strandId).toBe(dentist.id);
    expect(x.svc.move("thr_main", turns[1]!.seq, "str_nope")).toBe(false);
  });

  it("new strand from here takes this turn and the later ones of its strand", async () => {
    const { x, turns } = await day();
    const routerId = x.svc.items("thr_main", 10).find((item) => item.seq === turns[0]!.seq)!.strandId;
    const made = x.svc.split("thr_main", turns[1]!.seq)!;
    const items = x.svc.items("thr_main", 10);
    expect(items.find((item) => item.seq === turns[0]!.seq)?.strandId).toBe(routerId);
    expect(items.find((item) => item.seq === turns[1]!.seq)?.strandId).toBe(made);
    expect(items.find((item) => item.seq === turns[2]!.seq)?.strandId).toBe(made);
    expect(items.find((item) => item.seq === turns[3]!.seq)?.strandId).not.toBe(made);
    const list = await x.svc.list("thr_main");
    expect(list.strands.find((strand) => strand.id === made)).toMatchObject({ origin: "user", messages: 2 });
    expect(list.strands.find((strand) => strand.id === routerId)).toMatchObject({ messages: 1, latestSeq: turns[0]!.seq });
  });

  it("renames, pins and merges; the model never folds a strand the user made", async () => {
    const { x, turns } = await day();
    const list = await x.svc.list("thr_main");
    const [first, second] = list.strands;
    expect(x.svc.rename(first!.id, "  Retry   budget ")).toBe(true);
    expect(x.svc.pin(second!.id, true)).toBe(true);
    let after = new Map((await x.svc.list("thr_main")).strands.map((strand) => [strand.id, strand]));
    expect(after.get(first!.id)).toMatchObject({ title: "Retry budget", named: true });
    expect(after.get(second!.id)?.pinned).toBe(true);
    expect(x.svc.merge(first!.id, second!.id)).toBe(true);
    after = new Map((await x.svc.list("thr_main")).strands.map((strand) => [strand.id, strand]));
    expect(after.has(first!.id)).toBe(false);
    expect(after.get(second!.id)!.messages).toBe(list.strands.reduce((sum, strand) => sum + strand.messages, 0));
    // A strand the user split off: the model's merge refuses it, the user's doesn't.
    const made = x.svc.split("thr_main", turns[3]!.seq)!;
    expect(x.svc.store.merge(made, second!.id)).toBe(false);
    expect(x.svc.merge(made, second!.id)).toBe(true);
    expect(x.svc.rename("str_nope", "x")).toBe(false);
  });
});

describe("the needs-you push's read", () => {
  it("reads live only conversations active in the last day that have a strand not marked done, and names what it read", async () => {
    const x = setup([
      { id: "thr_main", title: "Main", isMain: true, lastActiveAt: NOW },
      { id: "thr_done", title: "All done", lastActiveAt: NOW },
      { id: "thr_week", title: "Last week", lastActiveAt: NOW - 2 * DAY },
      { id: "thr_empty", title: "Empty", lastActiveAt: NOW },
    ]);
    for (const id of ["thr_main", "thr_done", "thr_week"]) { x.thread(id).turn("Look at the router", "Ok."); await x.svc.idle(id, true); }
    for (const strand of x.svc.store.list("thr_done")) x.svc.store.note(strand.id, { done: true }, NOW);
    const reads = vi.spyOn(x.svc, "list");
    const check = await x.svc.needsYouCheck("bot", NOW - DAY);
    expect(check.checked).toEqual(["thr_main"]);
    expect(check.conversations.map((row) => row.threadId)).toEqual(["thr_main"]);
    expect(reads.mock.calls.map(([threadId]) => threadId)).toEqual(["thr_main"]);
    for (const row of check.conversations) expect(() => overviewConversation.parse(row)).not.toThrow();
  });
});

describe("review fixes: undo, backfill back-off, caps for every conversation, asks' turns", () => {
  it("undoes a move and a merge from each item's previous strand", async () => {
    const x = setup([{ id: "thr_main", title: "Main", isMain: true, lastActiveAt: NOW }]);
    const t = x.thread("thr_main");
    const router = t.turn("Look at the router fallback", "Ok.");
    const dentist = t.turn("Book the dentist", "Ok.");
    await x.svc.idle("thr_main", true);
    const strandOf = (seq: number) => x.svc.items("thr_main", 20).find((item) => item.seq === seq)!.strandId;
    const routerStrand = strandOf(router.seq)!;
    const dentistStrand = strandOf(dentist.seq)!;
    expect(x.svc.move("thr_main", router.seq, dentistStrand)).toBe(true);
    expect(strandOf(router.seq)).toBe(dentistStrand);
    expect(x.svc.unmove("thr_main", router.seq)).toBe(true);
    expect(strandOf(router.seq)).toBe(routerStrand);
    expect(x.svc.tags("thr_main").tags.find((tag) => tag.turnId === router.turnId)?.strandId).toBe(routerStrand);
    // Nothing left to undo.
    expect(x.svc.unmove("thr_main", router.seq)).toBe(false);
    expect(x.svc.merge(routerStrand, dentistStrand)).toBe(true);
    expect((await x.svc.list("thr_main")).strands.map((strand) => strand.id)).toEqual([dentistStrand]);
    expect(x.svc.unmerge(routerStrand)).toBe(true);
    const back = await x.svc.list("thr_main");
    expect(back.strands.map((strand) => strand.id).sort()).toEqual([routerStrand, dentistStrand].sort());
    expect(back.strands.find((strand) => strand.id === routerStrand)).toMatchObject({ messages: 1, latestSeq: router.seq });
    expect(strandOf(router.seq)).toBe(routerStrand);
    expect(x.svc.unmerge(routerStrand)).toBe(false);
  });

  it("backs off a failed backfill (5 minutes, doubling) instead of retrying on every open, and logs once", async () => {
    let now = NOW;
    let reads = 0;
    let fail = true;
    const logs: string[] = [];
    const fake = new FakeThread("thr_main");
    fake.turn("Look at the router", "Ok.");
    const svc = new StrandService({
      db: database(),
      conversation: (id) => (id === "thr_main" ? { botId: "bot", lastActiveAt: NOW } : null), conversationsOf: async () => [],
      events: async (input) => { reads++; if (fail) throw new Error("Host not found"); return fake.events(input); },
      jev: fakeJev(), model: fakeModel(), changed: () => {}, log: (line) => logs.push(line), now: () => now,
      setTimer: () => null, clearTimer: () => {}, workers: async () => [], interactions: async () => [], busy: async () => false,
    });
    await svc.requestBackfill("thr_main");
    for (let open = 0; open < 5; open++) { await svc.list("thr_main"); await svc.requestBackfill("thr_main"); }
    expect(reads).toBe(1);
    expect(logs.filter((line) => line.includes("backfill"))).toHaveLength(1);
    now += 5 * 60 * 1000 + 1;
    await svc.requestBackfill("thr_main");
    expect(reads).toBe(2);
    // Twice as long the second time.
    now += 5 * 60 * 1000 + 1;
    await svc.requestBackfill("thr_main");
    expect(reads).toBe(2);
    now += 5 * 60 * 1000;
    fail = false;
    await svc.requestBackfill("thr_main");
    expect(svc.detector.needsBackfill("thr_main")).toBe(false);
    expect(logs.filter((line) => line.includes("backfill"))).toHaveLength(1);
  });

  it("caps Jev and the small model across every conversation too", () => {
    const x = setup([{ id: "thr_a", title: "A", lastActiveAt: NOW }, { id: "thr_b", title: "B", lastActiveAt: NOW }]);
    const store = x.svc.store;
    const day = new Date(NOW).toISOString().slice(0, 10);
    expect(store.takeCall("thr_a", "jev", day, 10, 3)).toBe(true);
    expect(store.takeCall("thr_b", "jev", day, 10, 3)).toBe(true);
    expect(store.takeCall("thr_a", "jev", day, 10, 3)).toBe(true);
    // The total is spent though each conversation has calls left.
    expect(store.takeCall("thr_b", "jev", day, 10, 3)).toBe(false);
    expect(store.callsLeft("thr_b", "jev", day, 10, 3)).toBe(0);
    expect(store.takeCall("thr_b", "model", day, 10, 3)).toBe(true);
    expect(store.read("thr_a")!.jevCalls).toBe(2);
  });

  it("stops asking Jev once today's total across every conversation is used, and the model at its total", async () => {
    const x = setup([{ id: "thr_main", title: "Main", isMain: true, lastActiveAt: NOW }]);
    const day = new Date(NOW).toISOString().slice(0, 10);
    x.svc.store.saveRead(ALL_CONVERSATIONS, { day, jevCalls: JEV_TOTAL_DAILY_CAP, modelCalls: MODEL_TOTAL_DAILY_CAP });
    x.thread("thr_main").turn("Look at the router", "Ok.");
    await x.svc.idle("thr_main", true);
    const items = x.svc.items("thr_main", 10);
    expect(items.every((item) => item.by !== "jev")).toBe(true);
    expect(x.svc.store.read("thr_main")!.modelCalls).toBe(0);
  });

  it("gives each ask in the conversation the turn it waits in", async () => {
    const asks: Record<string, unknown[]> = {};
    const db = database();
    const fake = new FakeThread("thr_main");
    const svc = new StrandService({
      db, conversation: (id) => (id === "thr_main" ? { botId: "bot", lastActiveAt: NOW } : null), conversationsOf: async () => [],
      events: fake.events, jev: fakeJev(), model: fakeModel(), changed: () => {}, log: () => {}, now: () => NOW,
      setTimer: () => null, clearTimer: () => {}, workers: async () => [], interactions: async (threadId) => (asks[threadId] ?? []) as never, busy: async () => false,
    });
    const turn = fake.turn("Publish the plugins release", "Asking for approval.");
    await svc.idle("thr_main", true);
    asks.thr_main = [{ id: "int_1", status: "pending", createdAt: FIXTURE_AT + 10_000, payload: { kind: "approval", availableDecisions: ["allow_once", "deny"], subject: { kind: "command", command: "npm publish" } } }];
    const list = await svc.list("thr_main");
    expect(list.strands[0]!.asks[0]).toMatchObject({ id: "int_1", turnId: turn.turnId });
  });
});
