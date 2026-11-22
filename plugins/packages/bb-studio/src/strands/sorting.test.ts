// What the strand-sorting eval asked for, one behaviour at a time: links the
// conversation states outright (a worker's report, the turn that started a
// worker, text the user quotes), and the extra answers on Jev's one call
// (whole conversation, also about, branched from).
import { describe, expect, it } from "vitest";
import { StrandDetector, type DetectorDeps } from "./detector";
import { StrandService, type WorkerFact } from "./service";
import { askInQuote, isQuickReply, quotesOf, replyLine, sameText, workerMentions } from "./signals";
import { readNaming } from "./sort";
import { StrandStore } from "./store";
import { database, FakeThread, fakeJev, fakeModel, FIXTURE_AT } from "./test/fixture";

const NOW = FIXTURE_AT + 60 * 60 * 1000;

describe("structural signals", () => {
  it("reads quoted passages, and whether a passage is an earlier reply's or holds an ask", () => {
    const message = "> **The iOS rebuild:** the audit said rebuild the shell. Should I start step 1 now?\n> More of the same quote\nWhat was the verdict?\n> - router phase 2.\nDo both";
    expect(quotesOf(message)).toEqual(["The iOS rebuild: the audit said rebuild the shell. Should I start step 1 now?", "More of the same quote", "- router phase 2."]);
    expect(sameText("Status:\n\n**The iOS rebuild:** the audit said rebuild the shell. Should I start step 1 now?", quotesOf(message)[0]!)).toBe(true);
    expect(sameText("Something else entirely, about the router", quotesOf(message)[0]!)).toBe(false);
    expect(askInQuote("Should I start step 1 now?", quotesOf(message)[0]!)).toBe(true);
    expect(askInQuote("Want me to ship 1.0.13?", quotesOf(message)[0]!)).toBe(false);
    // Too short to be a quote of anything.
    expect(quotesOf("> ok\nfine")).toEqual([]);
  });

  it("names the threads a report is from, and keeps a reply's end as a line", () => {
    expect(workerMentions("[bb message from thread:thr_abc123xyz] Plan: … [bb system] @thread:thr_def456uvw completed: done")).toEqual(["thr_abc123xyz", "thr_def456uvw"]);
    expect(replyLine("[PASS]")).toBeNull();
    expect(replyLine(`Done. ${"x".repeat(400)} Want me to ship it?`)!.endsWith("Want me to ship it?")).toBe(true);
  });
});

function detector(jev: DetectorDeps["jev"], workers: Record<string, string | null> = {}, rich = false) {
  const db = database();
  const store = new StrandStore(db, () => NOW);
  const thread = new FakeThread();
  const calls: { state: unknown; questions: Record<string, unknown> }[] = [];
  const det = new StrandDetector({
    store, events: thread.events, jev: async (input) => { calls.push(input); return jev(input); }, model: fakeModel(), openTasks: () => [], changed: () => {}, log: () => {}, now: () => NOW,
    setTimer: () => null, clearTimer: () => {},
    workerStrand: async (_threadId, workerId) => (workerId in workers ? workers[workerId]! : undefined),
    richSorting: () => rich,
  });
  store.saveRead(thread.id, { seenSeq: 0, backfill: "{}" });
  return { db, store, thread, det, calls };
}

const titleOf = (store: StrandStore, threadId: string, seq: number, kind: "user" | "report" = "user") => {
  const item = store.item(threadId, kind, seq);
  return item?.strandId ? store.get(item.strandId)?.title ?? null : null;
};

describe("a worker's report", () => {
  it("goes to its worker's strand without asking Jev, even when the reply passes over it quietly", async () => {
    // The worker's strand is known (the turn that started it was sorted into "Fix the router fallback").
    let known: string | null = null;
    const w = detector(fakeJev());
    (w.det as unknown as { deps: DetectorDeps }).deps.workerStrand = async (_threadId, id) => (id === "thr_worker01" ? known : undefined);
    const turn = w.thread.turn("Fix the router fallback", "On it.");
    await w.det.idle(w.thread.id);
    known = w.store.item(w.thread.id, "user", turn.seq)!.strandId!;
    const quiet = w.thread.turn("[bb system] @thread:thr_worker01 completed: still running the suite.", "[PASS]", { kind: "report" });
    const loud = w.thread.turn("[bb message from thread:thr_worker01] The fix is in, tests pass.", "The router fix is done.", { kind: "report" });
    const callsBefore = w.calls.length;
    await w.det.idle(w.thread.id);
    expect(w.store.item(w.thread.id, "report", quiet.seq)).toMatchObject({ strandId: known, by: "inherit" });
    expect(w.store.item(w.thread.id, "report", loud.seq)).toMatchObject({ strandId: known, by: "inherit" });
    expect(w.calls.length).toBe(callsBefore + 1); // only the reply's tag, for the loud report's reply
    expect(w.calls.at(-1)!.questions).not.toHaveProperty("strand");
  });

  it("from a thread that isn't a worker of the conversation goes to Jev as before", async () => {
    const x = detector(fakeJev(), {});
    const report = x.thread.turn("[bb message from thread:thr_someone99] Book the furnace service, please.", "Asked for dates.", { kind: "report" });
    await x.det.idle(x.thread.id);
    expect(x.store.item(x.thread.id, "report", report.seq)).toMatchObject({ by: "jev" });
  });
});

/** A Jev that answers the sort's questions from a script, and tags replies with a question mark as needs-you. */
function scripted(answers: Record<string, unknown>[]): DetectorDeps["jev"] {
  const base = fakeJev();
  let turn = 0;
  return async (input) => {
    const result = await base(input);
    if (!result.ok || !("strand" in input.questions)) return result;
    const next = answers[turn++] ?? {};
    const own: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(next)) own[key] = { type: "choice", probabilities: {}, confidence: 0.9, ...(typeof value === "string" ? { choice: value } : value as object) };
    return { ok: true, answers: { ...result.answers, ...own } };
  };
}

describe("Jev's extra answers (richer sorting, the Studio setting strands_richSorting)", () => {
  it("files a roundup under the whole conversation, a two-strand message under both, and records what a new strand grew out of", async () => {
    const x = detector(scripted([
      { strand: "new" },
      { strand: "new", branch: "s1" },
      { strand: "whole" },
      { strand: "s1", also: "s2" },
    ]), {}, true);
    const cuts = x.thread.turn("Cut the context the tools use", "Planning the cuts.");
    const release = x.thread.turn("Ship 1.0.13 with the cuts", "Building 1.0.13.");
    const roundup = x.thread.turn("Where do we stand with everything?", "Here's where each thing is.");
    const both = x.thread.turn("Both pieces are built", "Both are in.");
    await x.det.idle(x.thread.id);
    const strandOf = (seq: number) => x.store.item(x.thread.id, "user", seq)!;
    const a = strandOf(cuts.seq).strandId!;
    const b = strandOf(release.seq).strandId!;
    expect(x.store.get(b)!.parentId).toBe(a);
    expect(x.store.get(strandOf(roundup.seq).strandId!)).toMatchObject({ trunk: true, title: "Whole conversation" });
    // s1 is the newest open strand (the release), s2 the cuts; the trunk isn't among them.
    expect(strandOf(both.seq)).toMatchObject({ strandId: b, also: [a] });
    expect(x.store.get(a)!.lastSeq).toBe(both.seq);
    // The trunk is offered as its own option, never as sN.
    const last = x.calls.filter((call) => "strand" in call.questions).at(-1)!;
    expect((last.state as { strands: { title: string }[] }).strands.map((strand) => strand.title)).not.toContain("Whole conversation");
    expect(Object.keys((last.questions.strand as { criteria: object }).criteria)).toContain("whole");
  });

  it("shows Jev the turn before, so a bare ack can follow what it answers", async () => {
    const x = detector(scripted([{ strand: "new" }, { strand: "new" }, { strand: "s2" }]), {}, true);
    x.thread.turn("Fix the router fallback", "Fixed. Want me to reload Studio?");
    x.thread.turn("Book the furnace service", "Asked for dates.");
    x.thread.turn("Ok", "Reloading.");
    await x.det.idle(x.thread.id);
    const last = x.calls.filter((call) => "strand" in call.questions).at(-1)!.state as { previousTurn: { message: string; replyEnd: string; strand: string }; strands: { newest?: string[] }[] };
    expect(last.previousTurn).toMatchObject({ message: "Book the furnace service", replyEnd: "Asked for dates.", strand: "s1" });
    expect(last.strands[1]!.newest).toEqual(["user: Fix the router fallback", "assistant: Fixed."]);
  });
});

describe("with richer sorting off (the default)", () => {
  it("asks Jev today's question, plus the whole-conversation option: no extra context or questions", async () => {
    const x = detector(fakeJev());
    x.thread.turn("Fix the router fallback", "Fixed. Want me to reload Studio?");
    x.thread.turn("Book the furnace service", "Asked for dates.");
    await x.det.idle(x.thread.id);
    const call = x.calls.filter((each) => "strand" in each.questions).at(-1)!;
    expect(Object.keys(call.questions).filter((key) => ["strand", "also", "branch"].includes(key))).toEqual(["strand"]);
    for (const key of ["previousTurn", "quoted", "reportsFrom"]) expect(call.state).not.toHaveProperty(key);
    expect(Object.keys((call.state as { strands: object[] }).strands[0]!).sort()).toEqual(["id", "lastUserLine", "summary", "title"]);
    expect(Object.keys((call.questions.strand as { criteria: object }).criteria)).toEqual(["s1", "new", "whole", "none"]);
  });
});

describe("the turn before", () => {
  it("is the last one whose reply the user read: a quiet report filed in between doesn't count", async () => {
    let known: string | null = null;
    const x = detector(scripted([{ strand: "new" }, { strand: "new" }, { strand: "s1" }]));
    (x.det as unknown as { deps: DetectorDeps }).deps.workerStrand = async (_threadId, id) => (id === "thr_worker01" ? known : undefined);
    x.thread.turn("Fix the router fallback", "On it; a worker is starting.");
    await x.det.idle(x.thread.id);
    known = x.store.item(x.thread.id, "user", 1)!.strandId!;
    const furnace = x.thread.turn("Book the furnace service", "Asked for dates.");
    await x.det.idle(x.thread.id);
    x.thread.turn("[bb system] @thread:thr_worker01 completed: still running the suite.", "[PASS]", { kind: "report" });
    const news = x.thread.turn("Any news?", "Not yet.");
    await x.det.idle(x.thread.id);
    const last = x.calls.filter((call) => "strand" in call.questions).at(-1)!;
    const furnaceRef = `s${(last.state as { strands: { title: string }[] }).strands.findIndex((strand) => strand.title === "Book the furnace service") + 1}`;
    expect((last.state as { previousStrand: string }).previousStrand).toBe(furnaceRef);
    expect(x.store.previous(x.thread.id, news.seq)).toBe(x.store.item(x.thread.id, "user", furnace.seq)!.strandId);
  });
});

describe("naming records what a new strand grew out of", () => {
  it("reads \"from\" beside a new name", () => {
    const { answers } = readNaming('{"n1": {"title": "Release 1.0.13", "summary": "Shipping the cuts.", "from": "s2"}, "n2": {"title": "Garden beds", "summary": "Planning."}}', ["n1", "n2"], []);
    expect(answers.get("n1")).toEqual({ kind: "name", title: "Release 1.0.13", summary: "Shipping the cuts.", from: "s2" });
    expect(answers.get("n2")).toEqual({ kind: "name", title: "Garden beds", summary: "Planning." });
  });
});

describe("a quick reply the user pressed", () => {
  it("is matched exactly (leading emoji and case aside), never by a word in it", () => {
    expect(isQuickReply("👍 Ship 1.0.13 and reload", ["Ship 1.0.13 and reload", "Reload Studio only for now"])).toBe(true);
    expect(isQuickReply("ship 1.0.13 and reload", ["Ship 1.0.13 and reload"])).toBe(true);
    expect(isQuickReply("Ship it", ["Ship 1.0.13 and reload"])).toBe(false);
    expect(isQuickReply("👍 Ship 1.0.13 and reload, and also look at the router", ["Ship 1.0.13 and reload"])).toBe(false);
  });

  it("goes to the strand of the reply that offered it and answers its ask, without a Jev call", async () => {
    const x = detector(fakeJev());
    x.thread.turn("Book the furnace service", "Asked for dates.");
    const release = x.thread.turn("Cut the context the tools use", "The cuts are built. Ship 1.0.13?\n\n::next{reply=\"👍 Ship 1.0.13 and reload\" do=\"Reload Studio only for now\"}");
    await x.det.idle(x.thread.id);
    expect(x.store.openReplies(x.thread.id, 0)).toHaveLength(1);
    const calls = x.calls.length;
    const pressed = x.thread.turn("👍 Ship 1.0.13 and reload", "Building 1.0.13.");
    await x.det.idle(x.thread.id);
    expect(x.store.item(x.thread.id, "user", pressed.seq)).toMatchObject({ strandId: x.store.item(x.thread.id, "user", release.seq)!.strandId, by: "inherit" });
    expect(x.store.openReplies(x.thread.id, 0)).toEqual([]);
    // Only the new reply's tag was asked.
    expect(x.calls.slice(calls).every((call) => !("strand" in call.questions))).toBe(true);
  });

  it("only from the newest reply: an older reply's button, with another reply after it, goes to Jev and clears nothing by itself", async () => {
    const x = detector(fakeJev());
    x.thread.turn("Cut the context the tools use", "The cuts are built. Ship 1.0.13?\n\n::next{reply=\"👍 Ship 1.0.13 and reload\"}");
    x.thread.turn("Book the furnace service", "Asked for dates. Which day suits you?");
    await x.det.idle(x.thread.id);
    const typed = x.thread.turn("👍 Ship 1.0.13 and reload", "Building 1.0.13.");
    await x.det.idle(x.thread.id);
    expect(x.store.item(x.thread.id, "user", typed.seq)).toMatchObject({ by: "jev" });
  });
});

describe("old rows and merges", () => {
  it("counts a turn sorted before the quiet marker (its reply item with no line) as read", () => {
    const db = database();
    const store = new StrandStore(db, () => NOW);
    const strand = store.create({ threadId: "t", title: "Router", origin: "jev", seq: 1, at: NOW });
    // Written the old way: a user item and its reply item with line null.
    store.put({ threadId: "t", seq: 1, kind: "user", turnId: "turn_1", at: NOW, line: "Fix the router", strandId: strand.id, confidence: 0.9, by: "jev" });
    store.put({ threadId: "t", seq: 3, kind: "reply", turnId: "turn_1", at: NOW, line: null, strandId: strand.id, confidence: null, by: "inherit" });
    expect(store.previous("t", 10)).toBe(strand.id);
    expect(store.before("t", 10)?.seq).toBe(1);
    // A quiet report after it is filed but skipped.
    store.put({ threadId: "t", seq: 5, kind: "report", turnId: "turn_2", at: NOW, line: "still running", strandId: strand.id, confidence: null, by: "fallback", quiet: true });
    store.put({ threadId: "t", seq: 6, kind: "reply", turnId: "turn_2", at: NOW, line: null, strandId: strand.id, confidence: null, by: "inherit" });
    expect(store.item("t", "report", 5)!.quiet).toBe(true);
    expect(store.previous("t", 10)).toBe(strand.id);
    expect(store.before("t", 10)?.seq).toBe(1);
  });

  it("keeps a message's also list clean when its strands merge: never its own strand, never twice", () => {
    const db = database();
    const store = new StrandStore(db, () => NOW);
    const a = store.create({ threadId: "t", title: "A", origin: "jev", seq: 1, at: NOW });
    const b = store.create({ threadId: "t", title: "B", origin: "jev", seq: 2, at: NOW });
    const c = store.create({ threadId: "t", title: "C", origin: "jev", seq: 3, at: NOW });
    store.put({ threadId: "t", seq: 4, kind: "user", turnId: "x", at: NOW, line: "both", strandId: b.id, confidence: 1, by: "jev", also: [a.id] });
    store.put({ threadId: "t", seq: 5, kind: "user", turnId: "y", at: NOW, line: "three", strandId: c.id, confidence: 1, by: "jev", also: [a.id, b.id] });
    expect(store.merge(a.id, b.id)).toBe(true);
    expect(store.item("t", "user", 4)!.also).toEqual([]);
    expect(store.item("t", "user", 5)!.also).toEqual([b.id]);
  });
});

describe("unmerge", () => {
  it("puts back the also lists and parents the merge changed, and re-parents without loops", () => {
    const db = database();
    const store = new StrandStore(db, () => NOW);
    const a = store.create({ threadId: "t", title: "A", origin: "jev", seq: 1, at: NOW });
    const b = store.create({ threadId: "t", title: "B", origin: "jev", seq: 2, at: NOW });
    const c = store.create({ threadId: "t", title: "C", origin: "jev", seq: 3, at: NOW, parentId: a.id });
    const root = store.create({ threadId: "t", title: "Root", origin: "jev", seq: 4, at: NOW });
    store.setParent(a.id, root.id);
    store.put({ threadId: "t", seq: 5, kind: "user", turnId: "x", at: NOW, line: "both", strandId: c.id, confidence: 1, by: "jev", also: [a.id] });
    store.put({ threadId: "t", seq: 6, kind: "user", turnId: "y", at: NOW, line: "b and a", strandId: b.id, confidence: 1, by: "jev", also: [a.id] });
    expect(store.merge(a.id, b.id)).toBe(true);
    expect(store.get(c.id)!.parentId).toBe(b.id);
    expect(store.get(b.id)!.parentId).toBe(root.id);
    expect(store.item("t", "user", 5)!.also).toEqual([b.id]);
    expect(store.item("t", "user", 6)!.also).toEqual([]);
    expect(store.unmerge(a.id)).toBe(true);
    expect(store.get(c.id)!.parentId).toBe(a.id);
    expect(store.get(b.id)!.parentId).toBeNull();
    expect(store.item("t", "user", 5)!.also).toEqual([a.id]);
    expect(store.item("t", "user", 6)!.also).toEqual([a.id]);
  });

  it("never makes a parent loop when merging a strand into its own branch", () => {
    const db = database();
    const store = new StrandStore(db, () => NOW);
    const a = store.create({ threadId: "t", title: "A", origin: "jev", seq: 1, at: NOW });
    const b = store.create({ threadId: "t", title: "B", origin: "jev", seq: 2, at: NOW, parentId: a.id });
    const c = store.create({ threadId: "t", title: "C", origin: "jev", seq: 3, at: NOW, parentId: b.id });
    // B's child C would grow from... B itself merged into C: C can't be its own parent.
    expect(store.merge(b.id, c.id)).toBe(true);
    expect(store.get(c.id)!.parentId).toBe(a.id);
  });
});

describe("a worker's spawn turn", () => {
  it("isn't cached when the events can't be read, and Jev's choice for a two-strand turn doesn't hold up the read", async () => {
    const db = database();
    const thread = new FakeThread();
    let failing = false;
    let release: (() => void) | null = null;
    const choices: string[] = [];
    const sorting = scripted([{ strand: "new" }, { strand: "new", also: "s1" }]);
    const svc = new StrandService({
      db, conversation: (id) => (id === thread.id ? { botId: "bot", lastActiveAt: NOW } : null),
      conversationsOf: async () => [], changed: () => {}, log: () => {}, now: () => NOW, setTimer: () => null, clearTimer: () => {},
      events: async (input) => { if (failing && input.types?.includes("item/completed") && !input.beforeSeq) throw new Error("host offline"); return thread.events(input); },
      jev: async (input) => {
        if ("worker" in (input.state as object)) { choices.push("asked"); await new Promise<void>((resolve) => { release = resolve; }); return { ok: true, answers: { strand: { type: "choice", choice: "s2", confidence: 0.9, probabilities: {} } } }; }
        return sorting(input);
      },
      model: fakeModel(), richSorting: () => true,
      workers: async () => [{ threadId: "thr_worker07", title: "Call the furnace company", status: "running", createdAt: NOW - 1_000, endedAt: null }],
      interactions: async () => [], busy: async () => false,
    });
    await svc.idle(thread.id);
    thread.turn("Fix the router fallback", "On it.", { at: NOW - 20_000 });
    const both = thread.turn("Book the furnace and check the router", "", { at: NOW - 5_000, done: false });
    thread.tool(both.turnId, "Spawned thr_worker07", NOW - 1_000);
    thread.finish(both.turnId, "Started a worker.", NOW - 500);
    failing = true;
    await svc.list(thread.id);
    failing = false;
    await svc.idle(thread.id, true);
    // The read failed once: looked up again now, and the choice runs in the background.
    const list = await svc.list(thread.id);
    expect(list.strands.some((strand) => strand.workers.some((worker) => worker.threadId === "thr_worker07"))).toBe(true);
    await svc.list(thread.id);
    expect(choices).toEqual(["asked"]);
    release!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(db.prepare("SELECT COUNT(*) AS n FROM strand_items WHERE kind = 'worker' AND ref = 'thr_worker07'").get()).toEqual({ n: 1 });
  });
});

describe("a report's sender", () => {
  it("is the thread in its header; a thread its text merely mentions doesn't count when there is one", () => {
    expect(workerMentions("[bb message from thread:thr_lead00001] The iOS worker (thr_other0001) will confirm.")).toEqual(["thr_lead00001"]);
    expect(workerMentions("Note: thr_other0001 finished.")).toEqual(["thr_other0001"]);
  });
});

describe("text the user quotes", () => {
  it("clears the ask it quotes without Jev, and (with richer sorting) tells Jev the strand the quote came from", async () => {
    // Jev never says a message answers an ask: only the quote clears it.
    const never = fakeJev();
    const jev: DetectorDeps["jev"] = async (input) => {
      const result = await never(input);
      if (!result.ok) return result;
      for (const key of Object.keys(result.answers)) if (key.startsWith("clear_")) result.answers[key] = { type: "choice", probabilities: {}, choice: "other", confidence: 0.9 };
      return result;
    };
    const x = detector(jev, {}, true);
    x.thread.turn("Look at the router fallback", "The audit is done. Should I start step 1 of the router rebuild now?");
    x.thread.turn("Book the dentist", "Asked for dates.");
    const answer = x.thread.turn("> Should I start step 1 of the router rebuild now?\n✅ Do it", "Starting.");
    await x.det.idle(x.thread.id);
    expect(x.store.openReplies(x.thread.id, 0)).toEqual([]);
    const call = x.calls.filter((each) => "strand" in each.questions).at(-1)!;
    expect((call.state as { quoted: { text: string; foundIn: string }[] }).quoted).toEqual([{ text: "Should I start step 1 of the router rebuild now?", foundIn: "s2" }]);
    expect(Object.keys(call.questions).filter((key) => key.startsWith("clear_"))).toEqual([]);
    expect(titleOf(x.store, x.thread.id, answer.seq)).toBe("Look at the router fallback");
  });
});

describe("the turn that started a worker", () => {
  it("links the worker by the spawn in its turn, not by the newest message when the strands were read", async () => {
    const db = database();
    const thread = new FakeThread();
    let now = NOW;
    let busy = false;
    const workers: WorkerFact[] = [];
    const svc = new StrandService({
      db, conversation: (id) => (id === thread.id ? { botId: "bot", lastActiveAt: now } : null),
      conversationsOf: async () => [], events: thread.events, jev: fakeJev(), model: fakeModel(), changed: () => {}, log: () => {}, now: () => now,
      setTimer: () => null, clearTimer: () => {},
      workers: async () => workers, interactions: async () => [], busy: async () => busy,
    });
    await svc.idle(thread.id);
    thread.turn("Fix the router fallback", "On it.", { at: NOW - 10_000 });
    await svc.idle(thread.id);
    // A new message starts a turn that spawns a worker; the strands are read before that turn is sorted.
    const furnace = thread.turn("Book the furnace service", "", { at: NOW - 5_000, done: false });
    thread.tool(furnace.turnId, "Spawned thr_furnace001", NOW - 4_000);
    workers.push({ threadId: "thr_furnace001", title: "Call the furnace company", status: "running", createdAt: NOW - 4_000, endedAt: null });
    busy = true;
    await svc.list(thread.id);
    busy = false;
    await svc.list(thread.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM strand_items WHERE kind = 'worker'").get()).toEqual({ n: 0 });
    thread.finish(furnace.turnId, "Started a worker to call them.");
    now += 1_000;
    await svc.idle(thread.id, true);
    const list = await svc.list(thread.id);
    const strand = list.strands.find((each) => each.workers.some((worker) => worker.threadId === "thr_furnace001"));
    expect(strand?.title).toBe("Book the furnace service");
  });
});
