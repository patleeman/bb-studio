import { describe, expect, it } from "vitest";
import { rpcContract, strandList, strandsPublicContract } from "./contract";
import { JEV_TOTAL_DAILY_CAP } from "./detector";
import { onlyReplies, pushFor, StrandPushes } from "./push";
import * as reply from "./reply";
import { askCandidates, clearQuestions, readClears, readReplyAnswers, REPLY_OPEN_MS, replyQuestions } from "./reply";
import { StrandService } from "./service";
import { liveState } from "./states";
import { database, FakeThread, fakeJev, fakeModel } from "./test/fixture";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const choice = (picked: string, confidence = 0.9) => ({ type: "choice", choice: picked, confidence, probabilities: {} });

describe("Jev decides; no keywords", () => {
  it("has no rule layer left", () => {
    for (const name of ["signalTag", "ruleTag", "askLineOf"]) expect(name in reply).toBe(false);
  });

  it("asks about the reply's end and its sentences; a ::next row goes along as context only", () => {
    const text = "Ran it:\n\n```\nShould I continue? [y/N]\n```\n\nRelease notes are drafted. CI is green.\n\n::next{reply=\"🚀 Publish now|⏳ Wait for Monday\"}";
    const asked = replyQuestions(text);
    expect(asked.candidates).toEqual(["Ran it:", "Release notes are drafted.", "CI is green."]);
    expect(asked.state).toMatchObject({ quickReplies: ["Publish now", "Wait for Monday"], sentences: { p1: "Ran it:", p2: "Release notes are drafted.", p3: "CI is green." } });
    expect(Object.keys(asked.questions)).toEqual(["reply", "askSentence"]);
    expect(Object.keys(asked.questions.askSentence!.criteria)).toEqual(["p1", "p2", "p3", "none"]);
  });

  it("ends a sentence only at . ! ? before a space or the end: file names, versions and e.g. stay whole", () => {
    expect(reply.sentencesOf("Should I update main-push.ts and push to v1.2 now? Tests pass, e.g. the push suite. Done!")).toEqual([
      "Should I update main-push.ts and push to v1.2 now?", "Tests pass, e.g. the push suite.", "Done!",
    ]);
    expect(askCandidates("See https://x.test/a.b?c=1 first. OK to ship 2.3.1?")).toEqual(["See https://x.test/a.b?c=1 first.", "OK to ship 2.3.1?"]);
  });

  it("reads the reply as shown: emphasis, escapes, autolinks and entities off", () => {
    expect(reply.proseOf("Should I *really* drop \\_tmp\\_ and snake_case_name? See <https://x.test/a> &amp; **bold** `code`.")).toEqual([
      "Should I really drop _tmp_ and snake_case_name? See https://x.test/a & bold code.",
    ]);
  });

  it("reads Jev's tag and its sentence word for word; unsure or malformed answers leave the reply untagged", () => {
    const candidates = askCandidates("Ace has Saturday 9 AM. Please sign in to the Ace portal so I can book it. Then I'll confirm.");
    expect(readReplyAnswers({ reply: choice("needs-you"), askSentence: choice("p2") }, candidates)).toEqual({ tag: "needs-you", ask: "Please sign in to the Ace portal so I can book it." });
    expect(readReplyAnswers({ reply: choice("needs-you"), askSentence: choice("none") }, candidates)).toEqual({ tag: "needs-you", ask: null });
    expect(readReplyAnswers({ reply: choice("status"), askSentence: choice("p2") }, candidates)).toEqual({ tag: "status", ask: null });
    expect(readReplyAnswers({ reply: choice("needs-you", 0.4) }, candidates)).toBeUndefined();
    expect(readReplyAnswers({ reply: choice("maybe") }, candidates)).toBeUndefined();
    expect(readReplyAnswers(undefined, candidates)).toBeUndefined();
  });

  it("asks about each open ask on its own and clears only those Jev says the message answers", () => {
    const asked = clearQuestions([{ seq: 7, ask: "Want me to deploy?", strand: "Router" }, { seq: 12, ask: "Should I book Ace?", strand: "Furnace" }]);
    expect(asked.state.openAsks).toEqual([{ id: "a1", ask: "Want me to deploy?", strand: "Router" }, { id: "a2", ask: "Should I book Ace?", strand: "Furnace" }]);
    expect(readClears({ clear_a1: choice("other"), clear_a2: choice("answers") }, asked.keys)).toEqual([12]);
    expect(readClears({ clear_a1: choice("answers", 0.3) }, asked.keys)).toEqual([]);
  });
});

function service(options: { jevDown?: boolean; secrets?: string[] } = {}) {
  const db = database();
  const thread = new FakeThread();
  const jevCalls: { state: unknown; questions: Record<string, unknown> }[] = [];
  let now = NOW;
  const svc = new StrandService({
    db, conversation: (id) => (id === thread.id ? { botId: "bot", lastActiveAt: now } : null),
    conversationsOf: async () => [{ threadId: thread.id, title: "Main", isMain: true, lastActiveAt: now }], events: thread.events,
    jev: fakeJev(jevCalls, { down: options.jevDown }), model: fakeModel(), changed: () => {}, log: () => {}, now: () => now,
    setTimer: () => null, clearTimer: () => {}, secrets: () => options.secrets ?? [],
    workers: async () => [], interactions: async () => [], busy: async () => false,
  });
  return { db, thread, svc, jevCalls, setNow: (at: number) => { now = at; } };
}

const tagsOf = (svc: StrandService, threadId = "thr_main") => svc.tags(threadId).replies.map((row) => [row.tag, row.ask, row.resolved]);
const byOf = (db: ReturnType<typeof database>) => (db.prepare("SELECT reply_by FROM strand_items WHERE kind = 'reply' ORDER BY seq").all() as { reply_by: string | null }[]).map((row) => row.reply_by);
const outOfCalls = (db: ReturnType<typeof database>) => db.prepare("INSERT INTO strand_reads (thread_id, seen_seq, day, jev_calls, model_calls, read_at) VALUES ('strands:all-conversations', 0, ?, ?, 0, 0) ON CONFLICT(thread_id) DO UPDATE SET jev_calls = excluded.jev_calls, day = excluded.day")
  .run(new Date(NOW).toISOString().slice(0, 10), JEV_TOTAL_DAILY_CAP);

describe("tagging each finished turn's reply", () => {
  it("rides on the call that sorts the turn: the tag and the ask sentence come from Jev", async () => {
    const x = service();
    await x.svc.idle(x.thread.id);
    x.thread.turn("Look at the router labels", "Found it. You decide: required labels, or filled from the first match.", { at: NOW - 3 * HOUR });
    x.thread.turn("Disk space on the laptop?", "Freed 18 GB. Let me know if anything breaks.", { at: NOW - 2 * HOUR });
    x.thread.turn("And the furnace?", "Ace has Saturday 9 AM. Want me to book it?\n\n::next{reply=\"✅ Book it|⏳ Not yet\"}", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    // One call per turn; the later ones also ask whether the message answers the ask still open.
    expect(x.jevCalls.map((call) => Object.keys(call.questions))).toEqual([["strand", "reply", "askSentence"], ["strand", "reply", "askSentence", "clear_a1"], ["strand", "reply", "askSentence", "clear_a1"]]);
    expect((x.jevCalls[2]!.state as { quickReplies?: string[] }).quickReplies).toEqual(["Book it", "Not yet"]);
    expect(tagsOf(x.svc)).toEqual([
      ["needs-you", "You decide: required labels, or filled from the first match.", false],
      ["status", null, false],
      ["needs-you", "Want me to book it?", false],
    ]);
    expect(byOf(x.db)).toEqual(["jev", "jev", "jev"]);
  });

  it("sends Jev the reply scrubbed of secrets", async () => {
    const x = service({ secrets: ["hunter2-very-secret"] });
    await x.svc.idle(x.thread.id);
    x.thread.turn("Set up the backup", "Saved the key hunter2-very-secret in the config. Backups run nightly.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    const state = JSON.stringify(x.jevCalls.at(-1)!.state);
    expect(state).toContain("replyEnd");
    expect(state).not.toContain("hunter2-very-secret");
  });

  it("doesn't guess without Jev: down, or out of calls, the reply stays untagged and its push is unknown", async () => {
    const down = service({ jevDown: true });
    await down.svc.idle(down.thread.id);
    down.thread.turn("Look at the router", "Patched it. Want me to deploy?", { at: NOW - HOUR });
    await down.svc.idle(down.thread.id);
    expect(down.svc.tags(down.thread.id).replies).toEqual([]);
    expect(byOf(down.db)).toEqual(["none"]);
    expect(await down.svc.replyPush(down.thread.id, 0)).toEqual({ decision: "unknown", ask: null });
    expect((await down.svc.list(down.thread.id)).strands.some((strand) => strand.state === "needs-you")).toBe(false);

    const x = service();
    await x.svc.idle(x.thread.id);
    outOfCalls(x.db);
    const before = x.jevCalls.length;
    x.thread.turn("Look at the router", "Patched it. Want me to deploy?", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    expect(x.jevCalls.length).toBe(before);
    expect(byOf(x.db)).toEqual(["none"]);
  });

  it("tags an early-sorted turn with one reply-only call at its end, and never tags [PASS] or the backfill", async () => {
    const x = service();
    x.thread.turn("Look at the router", "Want me to restart it?", { at: NOW - 3 * HOUR });
    await x.svc.idle(x.thread.id);
    expect(x.svc.tags(x.thread.id).replies).toEqual([]);
    x.thread.turn("Anything new on the garden?", "[PASS]", { at: NOW - 2 * HOUR });
    await x.svc.idle(x.thread.id);
    expect(byOf(x.db).filter(Boolean)).toEqual([]);
    const running = x.thread.turn("Release the plugins PR", "", { done: false, at: NOW - HOUR });
    await x.svc.asked(x.thread.id);
    const calls = x.jevCalls.length;
    x.thread.finish(running.turnId, "Released. Should I post the notes?");
    await x.svc.idle(x.thread.id, true);
    expect(x.jevCalls.length).toBe(calls + 1);
    expect(Object.keys(x.jevCalls.at(-1)!.questions)).toEqual(["reply", "askSentence"]);
    expect(tagsOf(x.svc)).toEqual([["needs-you", "Should I post the notes?", false]]);
  });
});

describe("clearing: Jev says which open asks a message answers", () => {
  async function open() {
    const x = service();
    await x.svc.idle(x.thread.id);
    x.thread.turn("Book the furnace tune-up", "Ace has Saturday 9 AM. Want me to book Ace for Saturday?", { at: NOW - 4 * HOUR });
    x.thread.turn("Look at the router", "Patched it. Should I deploy the router now?", { at: NOW - 3 * HOUR });
    await x.svc.idle(x.thread.id);
    expect(tagsOf(x.svc).map((row) => row[2])).toEqual([false, false]);
    return x;
  }

  it("an answer clears its ask; a go-ahead answers the newest", async () => {
    const x = await open();
    x.thread.turn("furnace: yes, Saturday works", "Booked Ace for Saturday 9 AM.", { at: NOW - 2 * HOUR });
    await x.svc.idle(x.thread.id);
    expect(tagsOf(x.svc).map((row) => row[2])).toEqual([true, false, false]);
    x.thread.turn("ok, do it", "Deploying.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    expect(tagsOf(x.svc).map((row) => row[2])).toEqual([true, true, false, false]);
  });

  it("an acknowledgement or an unrelated message clears nothing", async () => {
    const x = await open();
    x.thread.turn("thanks!", "Any time.", { at: NOW - 2 * HOUR });
    x.thread.turn("what about the passport renewal?", "It expires in March; the form is ready.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    expect(tagsOf(x.svc).map((row) => row[2])).toEqual([false, false, false, false]);
    expect((await x.svc.list(x.thread.id)).strands.filter((strand) => strand.state === "needs-you")).toHaveLength(2);
  });

  it("one message can answer several asks, across strands; each is asked about on its own", async () => {
    const x = await open();
    x.thread.turn("yes to both, go ahead", "On it.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    expect((x.jevCalls.at(-1)!.state as { openAsks: unknown }).openAsks).toEqual([
      { id: "a1", ask: "Want me to book Ace for Saturday?", strand: "Book the furnace tune-up" },
      { id: "a2", ask: "Should I deploy the router now?", strand: "Look at the router" },
    ]);
    expect(tagsOf(x.svc).map((row) => row[2])).toEqual([true, true, false]);
  });

  it("a strand marked done settles the asks open then, once: an ask its turn makes after still counts, and reopening brings none back", async () => {
    const x = await open();
    // An agent marks the router done mid-turn, then ends the turn asking.
    x.svc.note(x.thread.id, { strand: "Look at the router", done: true });
    x.thread.turn("router: and the branch?", "Merged and deployed. Want me to delete the router branch?", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    expect(tagsOf(x.svc).map((row) => row[2])).toEqual([false, true, false]);
    x.svc.note(x.thread.id, { strand: "Look at the router", done: false });
    expect(tagsOf(x.svc).map((row) => row[2])).toEqual([false, true, false]);
  });

  it("without Jev an ask stays open; Done, the strand marked done and a week still clear it", async () => {
    const x = await open();
    outOfCalls(x.db);
    x.thread.turn("router: yes, deploy it", "Deploying.", { at: NOW - 2 * HOUR });
    await x.svc.idle(x.thread.id);
    expect(tagsOf(x.svc).map((row) => row[2])).toEqual([false, false]);
    const [furnace] = x.svc.tags(x.thread.id).replies;
    expect(x.svc.resolveReply(x.thread.id, furnace!.seq)).toBe(true);
    expect(x.svc.resolveReply(x.thread.id, furnace!.seq - 2)).toBe(false);
    x.svc.note(x.thread.id, { strand: "Look at the router", done: true });
    expect(tagsOf(x.svc).map((row) => row[2])).toEqual([true, true]);
    const y = await open();
    y.setNow(NOW + REPLY_OPEN_MS);
    expect(tagsOf(y.svc).map((row) => row[2])).toEqual([true, true]);
  });
});

describe("the push check matches the reply to its own turn", () => {
  it("finds the turn's request by type in a long turn, never takes the previous turn's tag, and honours a given request", async () => {
    const x = service();
    await x.svc.idle(x.thread.id);
    const first = x.thread.turn("Book the furnace", "Want me to book Saturday?", { at: NOW - 2 * HOUR });
    await x.svc.idle(x.thread.id);
    expect(await x.svc.replyPush(x.thread.id, 0)).toEqual({ decision: "push", ask: "Want me to book Saturday?" });
    // A new turn with 120 tool events, not sorted yet: its request is older than the newest 50 events.
    const second = x.thread.turn("Disk space on the laptop?", "Freed 18 GB.", { at: NOW - HOUR, tools: 120 });
    expect(await x.svc.newestRequest(x.thread.id)).toBe(second.seq);
    expect(await x.svc.replyPush(x.thread.id, 0)).toEqual({ decision: "unknown", ask: null });
    const pending = x.svc.replyPush(x.thread.id, 5_000);
    void x.svc.idle(x.thread.id);
    expect(await pending).toEqual({ decision: "quiet", ask: null });
    // An earlier turn's push asks about its own reply.
    expect(await x.svc.replyPush(x.thread.id, 0, first.seq)).toEqual({ decision: "push", ask: "Want me to book Saturday?" });
    expect(rpcContract["strands.replyPush"].output.parse(await pending)).toEqual({ decision: "quiet", ask: null });
  });

  it("finds a turn that a keepalive started, without waiting", async () => {
    const x = service();
    await x.svc.idle(x.thread.id);
    const turn = x.thread.turn("Book the furnace", "Want me to book Saturday?", { at: NOW - HOUR, pingFirst: true });
    await x.svc.idle(x.thread.id);
    expect(turn.seq).not.toBe(turn.requestSeq);
    expect(await x.svc.newestRequest(x.thread.id)).toBe(turn.requestSeq);
    expect(await x.svc.replyPush(x.thread.id, 0)).toEqual({ decision: "push", ask: "Want me to book Saturday?" });
  });

  it("Done is the app window's only: the phone's contract doesn't carry it", () => {
    expect("strands.resolveReply" in strandsPublicContract).toBe(false);
    expect(rpcContract["strands.resolveReply"].experimental_description).toContain("app window only");
  });
});

describe("the strand push leaves reply asks to the reply's own push", () => {
  const view = (asks: { kind: "reply" | "question"; label?: string }[], workers: { status: "needs-you" | "running"; title?: string }[] = [], detail: string | null = null) => ({
    id: "str_1", title: "Furnace", summary: null, named: true, state: "needs-you" as const, detail,
    asks: asks.map((ask, index) => ({ id: `a${index}`, kind: ask.kind, threadId: "thr_main", label: ask.label ?? "x", details: [], decisions: [], turnId: null, seq: null })),
    workers: workers.map((worker, index) => ({ threadId: `w${index}`, title: worker.title ?? "w", status: worker.status, endedAt: null })),
    lastAt: NOW, firstAt: NOW, firstSeq: 1, latestSeq: 1, latestTurnId: "t", messages: 1, unsure: 0, pinned: false, origin: "jev" as const, taskId: null, parentId: null, trunk: false,
  });

  it("knows a strand that needs you only for replies, and never uses a reply's ask as a strand push's body", async () => {
    expect(onlyReplies(view([{ kind: "reply" }]))).toBe(true);
    expect(onlyReplies(view([{ kind: "reply" }, { kind: "question" }]))).toBe(false);
    expect(onlyReplies(view([{ kind: "reply" }], [{ status: "needs-you" }]))).toBe(false);
    const deps = { bbPushesAsks: async () => false, startedByAnotherThread: async () => false };
    const withWorker = view([{ kind: "reply", label: "Want me to book Ace?" }], [{ status: "needs-you", title: "Booking worker" }], "Booking worker needs you");
    expect((await pushFor(withWorker, { threadId: "thr_main", title: "Main" }, deps))?.body).toBe("Booking worker needs you");
  });

  it("names a worker waiting on the user before a reply's ask in the strand's line", () => {
    const strand = { id: "s1", threadId: "t", title: "Furnace", summary: null, named: true, nameTries: 0, summaryAt: null, firstSeq: 1, lastSeq: 1, lastAt: NOW, pinned: false, mergedInto: null, origin: "jev" as const, taskId: null, waitingOn: null, waitingAt: null, doneAt: null, openedAt: null, createdAt: NOW, parentId: null, trunk: false };
    const live = liveState(strand, { now: NOW, runningStrandId: null, tasks: [], workers: [{ threadId: "w", title: "Booking worker", status: "needs-you", strandId: "s1", endedAt: null }], asks: [{ id: "reply:9", kind: "reply", strandId: "s1", label: "Want me to book Ace?", threadId: "t", details: [], decisions: [], seq: 9 }] });
    expect(live).toMatchObject({ state: "needs-you", detail: "Booking worker needs you" });
  });

  it("doesn't push a reply-only strand, and a real ask on the same strand later still pushes", async () => {
    const pushed: string[] = [];
    let saved: string[] | null = [];
    let strand = view([{ kind: "reply" }]);
    const pushes = new StrandPushes({
      bots: () => [{ id: "bot", name: "Chief of Staff" }],
      overview: async () => ({ conversations: [{ threadId: "thr_main", title: "Main", isMain: true, lastActiveAt: NOW, strands: [strand] }], checked: ["thr_main"] }),
      bbPushesAsks: async () => false, startedByAnotherThread: async () => false, projectOf: async () => null,
      notify: async (input) => { pushed.push(input.body); }, load: async () => saved, save: async (ids) => { saved = ids; }, defaultProjectId: "proj",
    });
    await pushes.check();
    expect(pushed).toEqual([]);
    strand = view([{ kind: "reply", label: "Want me to book Ace?" }, { kind: "question", label: "Which branch?" }]);
    await pushes.check();
    expect(pushed).toEqual(["Which branch?"]);
  });
});

describe("what a folded run reads from the tags", () => {
  it("gives each turn's kind and each tagged reply's first sentence", async () => {
    const x = service();
    await x.svc.idle(x.thread.id);
    x.thread.turn("Disk space on the laptop?", "Freed 18 GB. Looking at what else is big.", { at: NOW - 2 * HOUR });
    x.thread.turn("Runner report: backup done", "Noted: the backup finished.", { at: NOW - HOUR, kind: "report" });
    await x.svc.idle(x.thread.id);
    const tags = x.svc.tags(x.thread.id);
    expect(tags.tags.map((tag) => tag.kind)).toEqual(["user", "report"]);
    expect(tags.replies.map((row) => [row.tag, row.line])).toEqual([["status", "Freed 18 GB."], ["status", "Noted: the backup finished."]]);
  });
});

describe("strands.list", () => {
  it("lists an open reply ask on its strand, valid against the contract", async () => {
    const x = service();
    await x.svc.idle(x.thread.id);
    const furnace = x.thread.turn("Book the furnace tune-up", "Ace has Saturday 9 AM. Please sign in to the Ace portal so I can book it.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    const list = strandList.parse(await x.svc.list(x.thread.id));
    expect(list.strands[0]!.asks).toEqual([{ id: `reply:${furnace.seq + 2}`, kind: "reply", threadId: "thr_main", label: "Please sign in to the Ace portal so I can book it.", details: [], decisions: [], turnId: furnace.turnId, seq: furnace.seq + 2 }]);
    expect((await x.svc.overview("bot")).needs).toBe(1);
  });
});

describe("Done from anywhere but Studio's app window", () => {
  it("is refused; the app window's goes through", async () => {
    const { registerStrands } = await import("./register");
    const handlers: Record<string, (input: unknown, context?: unknown) => unknown> = {};
    const bb = {
      events: { on: () => {} }, onDispose: () => {}, rpc: { register: (_contract: unknown, map: typeof handlers) => Object.assign(handlers, map) },
      agents: { registerTool: () => {} }, realtime: { publish: async () => {} },
      sdk: { threads: { get: async () => null, events: { list: async () => [] }, interactions: { list: async () => [] } } },
    };
    const registered = registerStrands(bb as never, database(), {
      decisions: { systemOne: async () => ({ ok: false, unavailable: true, error: "off" }), model: async () => ({ ok: false, unavailable: true, error: "off" }) },
      conversation: () => ({ botId: "bot", lastActiveAt: NOW }), conversationsOf: async () => [], workers: async () => [],
      scope: { botOf: () => "bot", mainOf: () => "thr_main", defaultMain: () => "thr_main" }, secrets: async () => [], log: () => {},
    });
    const done = handlers["strands.resolveReply"]!;
    for (const context of [undefined, { experimental_caller: { kind: "client" } }, { experimental_caller: { kind: "plugin", pluginId: "x", studioAppWindow: true } }]) {
      expect(() => done({ threadId: "thr_main", seq: 3 }, context)).toThrow("BB Studio app");
    }
    expect(done({ threadId: "thr_main", seq: 3 }, { experimental_caller: { kind: "client", studioAppWindow: true } })).toEqual({ ok: false });
    registered.service?.dispose();
  });
});
