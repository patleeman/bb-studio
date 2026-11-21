import { describe, expect, it } from "vitest";
import { strandList, rpcContract } from "./contract";
import { JEV_DAILY_CAP, JEV_TOTAL_DAILY_CAP } from "./detector";
import { onlyReplies, StrandPushes } from "./push";
import { askLineOf, readReplyAnswer, REPLY_OPEN_MS, ruleTag, signalTag } from "./reply";
import { StrandService } from "./service";
import { database, FakeThread, fakeJev, fakeModel } from "./test/fixture";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("the structured signals (no model)", () => {
  it("tags a quiet reply status and an approval card needs-you", () => {
    expect(signalTag("[PASS]")).toEqual({ tag: "status", ask: null, by: "signal" });
    expect(signalTag("I need to push the tag.\n\n::approval{id=\"apr_1\"}")).toMatchObject({ tag: "needs-you", by: "signal" });
  });

  it("reads a ::next row: answers of its own ask, the stock ones and the user's usual ones don't", () => {
    const own = "Two ways to fix it: required labels or filled ones.\n\n::next{reply=\"✅ Required|🪄 Fill from the match\"}";
    expect(signalTag(own)).toEqual({ tag: "needs-you", ask: "Choose: Required / Fill from the match", by: "signal" });
    expect(signalTag("Shipped as v1.2.\n\n::next{reply=\"👍 Looks good|🔁 Try another way|❓ Explain more\"}")).toBeNull();
    expect(signalTag("Shipped as v1.2.\n\n::next{reply=\"🚀 Ship it\"}", ["🚀 Ship it"])).toBeNull();
    expect(signalTag("Shipped as v1.2.\n\n::next{btw=\"🐛 I noticed the retry has no delay.\" do=\"📄 Write it up\"}")).toBeNull();
  });

  it("finds an explicit ask in the last paragraph, and its sentence is the ask line", () => {
    expect(signalTag("Found it: the save handler drops empty labels.\n\nWant me to make the label required?")).toEqual({ tag: "needs-you", ask: "Want me to make the label required?", by: "signal" });
    expect(signalTag("Ace has Saturday 9 AM. Please sign in to the Ace portal so I can book it. Then I'll confirm.")).toMatchObject({ tag: "needs-you", ask: "Please sign in to the Ace portal so I can book it." });
    // A question asked earlier, then answered, isn't the last paragraph's.
    expect(signalTag("Should I use the new endpoint? Yes: the old one is gone.\n\nMoved it to the new endpoint; tests pass.")).toBeNull();
    // A question inside code is not an ask.
    expect(signalTag("Ran it:\n\n```\nShould I continue? [y/N]\n```\n\nAll 412 tests pass.")).toBeNull();
  });

  it("leaves the rest to Jev", () => {
    expect(signalTag("The cleanup freed 18 GB. Looking at what else is big.")).toBeNull();
  });
});

describe("Jev's answer and the rule", () => {
  const text = "The fix is ready. The release needs a test on the phone before it ships.";
  it("reads Jev's choice; unsure or malformed answers go to the rule", () => {
    expect(readReplyAnswer({ type: "choice", choice: "status", confidence: 0.9, probabilities: {} }, text)).toEqual({ tag: "status", ask: null, by: "jev" });
    expect(readReplyAnswer({ type: "choice", choice: "needs-you", confidence: 0.8, probabilities: {} }, text)).toEqual({ tag: "needs-you", ask: "The release needs a test on the phone before it ships.", by: "jev" });
    expect(readReplyAnswer({ type: "choice", choice: "needs-you", confidence: 0.4, probabilities: {} }, text)).toBeUndefined();
    expect(readReplyAnswer({ type: "choice", choice: "maybe", confidence: 0.9 }, text)).toBeUndefined();
    expect(readReplyAnswer(undefined, text)).toBeUndefined();
  });

  it("the rule: needs-you when the last paragraph asks a question", () => {
    expect(ruleTag("Tests pass.\n\nOK to merge?")).toEqual({ tag: "needs-you", ask: "OK to merge?", by: "rule" });
    expect(ruleTag("Tests pass. Merging now.")).toEqual({ tag: "status", ask: null, by: "rule" });
    expect(ruleTag("What did I find? The cache was stale. Cleared it.")).toEqual({ tag: "status", ask: null, by: "rule" });
  });

  it("the ask line skips markdown, lists and directives", () => {
    expect(askLineOf("**Done.**\n\n- Option A: keep it\n- Option B: drop it\n\nWhich one do you want?\n\n::next{reply=\"🅰️ A|🅱️ B\"}")).toBe("Which one do you want?");
    expect(askLineOf("All green.")).toBeNull();
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

const tagsOf = (svc: StrandService, threadId = "thr_main") => svc.tags(threadId).replies.map((reply) => [reply.tag, reply.ask, reply.resolved]);

describe("tagging each finished turn's reply", () => {
  it("asks Jev in the same call that sorts the turn, and not at all when a signal decides", async () => {
    const x = service();
    await x.svc.idle(x.thread.id);
    x.thread.turn("Look at the router labels", "Found it. You decide: required labels, or filled from the first match.", { at: NOW - 3 * HOUR });
    x.thread.turn("And the furnace?", "Ace has Saturday 9 AM. Want me to book it?", { at: NOW - 2 * HOUR });
    x.thread.turn("Disk space?", "Freed 18 GB. Looking at what else is big.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    // One call per turn: the first and third carry the reply question; the second's explicit ask needs none.
    expect(x.jevCalls.map((call) => Object.keys(call.questions))).toEqual([["strand", "reply"], ["strand"], ["strand", "reply"]]);
    expect(tagsOf(x.svc)).toEqual([
      ["needs-you", "You decide: required labels, or filled from the first match.", false],
      ["needs-you", "Want me to book it?", false],
      ["status", null, false],
    ]);
    expect(x.db.prepare("SELECT reply_by FROM strand_items WHERE kind = 'reply' ORDER BY seq").all()).toEqual([{ reply_by: "jev" }, { reply_by: "signal" }, { reply_by: "jev" }]);
  });

  it("sends Jev the reply's end scrubbed of secrets", async () => {
    const x = service({ secrets: ["hunter2-very-secret"] });
    await x.svc.idle(x.thread.id);
    x.thread.turn("Set up the backup", "Saved the key hunter2-very-secret in the config. Backups run nightly.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    const state = JSON.stringify(x.jevCalls.at(-1)!.state);
    expect(state).toContain("replyEnd");
    expect(state).not.toContain("hunter2-very-secret");
  });

  it("falls back to the rule with no Jev, and when the day's calls are used up", async () => {
    const down = service({ jevDown: true });
    await down.svc.idle(down.thread.id);
    down.thread.turn("Look at the router", "Patched it. OK to deploy?", { at: NOW - 2 * HOUR });
    down.thread.turn("Disk?", "Freed 18 GB.", { at: NOW - HOUR });
    await down.svc.idle(down.thread.id);
    // With no Jev both turns stay in one strand, so the second message already answers the first reply.
    expect(tagsOf(down.svc).map(([tag, ask]) => [tag, ask])).toEqual([["needs-you", "OK to deploy?"], ["status", null]]);
    expect(down.db.prepare("SELECT DISTINCT reply_by FROM strand_items WHERE kind = 'reply'").all()).toEqual([{ reply_by: "rule" }]);

    const x = service();
    await x.svc.idle(x.thread.id);
    const day = new Date(NOW).toISOString().slice(0, 10);
    x.db.prepare("INSERT INTO strand_reads (thread_id, seen_seq, day, jev_calls, model_calls, read_at) VALUES ('strands:all-conversations', 0, ?, ?, 0, 0)").run(day, JEV_TOTAL_DAILY_CAP);
    const before = x.jevCalls.length;
    x.thread.turn("Look at the router", "Patched it. You decide when it ships.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    expect(x.jevCalls.length).toBe(before);
    // "You decide" isn't a question: without Jev, the rule calls it status.
    expect(tagsOf(x.svc)).toEqual([["status", null, false]]);
    expect(JEV_DAILY_CAP).toBe(300);
  });

  it("doesn't tag the backfill's history", async () => {
    const x = service();
    x.thread.turn("Look at the router", "Want me to restart it?", { at: NOW - 3 * HOUR });
    await x.svc.idle(x.thread.id);
    expect(x.svc.tags(x.thread.id).replies).toEqual([]);
  });
});

describe("a reply that needs you, in the strands", () => {
  it("makes its strand need you, with its ask line and message, and counts in the box", async () => {
    const x = service();
    await x.svc.idle(x.thread.id);
    const furnace = x.thread.turn("Book the furnace tune-up", "Ace has Saturday 9 AM. Please sign in to the Ace portal so I can book it.", { at: NOW - 2 * HOUR });
    x.thread.turn("Disk space on the laptop?", "Freed 18 GB.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    const list = strandList.parse(await x.svc.list(x.thread.id));
    const strand = list.strands.find((each) => each.state === "needs-you")!;
    expect(strand.title).toBe("Book the furnace tune-up");
    expect(strand.asks).toEqual([{ id: `reply:${furnace.seq + 2}`, kind: "reply", threadId: "thr_main", label: "Please sign in to the Ace portal so I can book it.", details: [], decisions: [], turnId: furnace.turnId, seq: furnace.seq + 2 }]);
    expect(list.strands.filter((each) => each.state === "needs-you")).toHaveLength(1);
    expect((await x.svc.overview("bot")).needs).toBe(1);
  });

  it("is resolved by the user's later message in its strand, not by one in another strand", async () => {
    const x = service();
    await x.svc.idle(x.thread.id);
    x.thread.turn("Book the furnace tune-up", "Want me to book Ace for Saturday?", { at: NOW - 3 * HOUR });
    x.thread.turn("Disk space?", "Freed 18 GB.", { at: NOW - 2 * HOUR });
    await x.svc.idle(x.thread.id);
    expect(tagsOf(x.svc)[0]).toEqual(["needs-you", "Want me to book Ace for Saturday?", false]);
    x.thread.turn("furnace: yes, Saturday works", "Booked Ace for Saturday 9 AM.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    expect(tagsOf(x.svc)).toEqual([["needs-you", "Want me to book Ace for Saturday?", true], ["status", null, false], ["status", null, false]]);
    expect((await x.svc.list(x.thread.id)).strands.some((strand) => strand.state === "needs-you")).toBe(false);
  });

  it("is resolved by a short answer with no strand of its own right after it", async () => {
    const x = service();
    await x.svc.idle(x.thread.id);
    x.thread.turn("Look at the router", "Patched it. Want me to deploy?", { at: NOW - 2 * HOUR });
    x.thread.turn("ok", "Deploying.", { at: NOW - HOUR });
    await x.svc.idle(x.thread.id);
    expect(tagsOf(x.svc)[0]).toEqual(["needs-you", "Want me to deploy?", true]);
  });

  it("is resolved by Done, by its strand marked done, or a week on", async () => {
    const x = service();
    await x.svc.idle(x.thread.id);
    const a = x.thread.turn("Look at the router", "Want me to deploy the router?", { at: NOW - 3 * HOUR });
    x.thread.turn("Book the dentist", "Should I take Tuesday 9 AM?", { at: NOW - 2 * HOUR });
    await x.svc.idle(x.thread.id);
    expect(x.svc.resolveReply(x.thread.id, a.seq + 2)).toBe(true);
    expect(x.svc.resolveReply(x.thread.id, a.seq)).toBe(false);
    expect(tagsOf(x.svc).map((row) => row[2])).toEqual([true, false]);
    x.svc.note(x.thread.id, { strand: "Book the dentist", done: true });
    expect(tagsOf(x.svc).map((row) => row[2])).toEqual([true, true]);

    const y = service();
    await y.svc.idle(y.thread.id);
    y.thread.turn("Look at the router", "Want me to deploy?", { at: NOW - HOUR });
    await y.svc.idle(y.thread.id);
    y.setNow(NOW + REPLY_OPEN_MS);
    expect(tagsOf(y.svc)).toEqual([["needs-you", "Want me to deploy?", true]]);
    expect((await y.svc.list(y.thread.id)).strands.some((strand) => strand.state === "needs-you")).toBe(false);
  });

  it("answers the push check: needs-you pushes with its ask, status stays quiet, untagged is unknown", async () => {
    const x = service();
    expect(await x.svc.replyPush("thr_other", 0)).toEqual({ decision: "unknown", ask: null });
    await x.svc.idle(x.thread.id);
    x.thread.turn("Book the furnace", "Want me to book Saturday?", { at: NOW - 2 * HOUR });
    await x.svc.idle(x.thread.id);
    expect(await x.svc.replyPush(x.thread.id, 0)).toEqual({ decision: "push", ask: "Want me to book Saturday?" });
    x.thread.turn("Disk?", "Freed 18 GB.", { at: NOW - HOUR });
    // Not sorted yet: unknown within the wait, then quiet once the sort lands.
    expect(await x.svc.replyPush(x.thread.id, 0)).toEqual({ decision: "unknown", ask: null });
    const pending = x.svc.replyPush(x.thread.id, 5_000);
    void x.svc.idle(x.thread.id);
    expect(await pending).toEqual({ decision: "quiet", ask: null });
    expect(rpcContract["strands.replyPush"].output.parse(await pending)).toEqual({ decision: "quiet", ask: null });
  });
});

describe("the strand push leaves reply asks to the reply's own push", () => {
  const view = (asks: { kind: "reply" | "question" }[], workers: { status: "needs-you" | "running" }[] = []) => ({
    id: "str_1", title: "Furnace", summary: null, named: true, state: "needs-you" as const, detail: null,
    asks: asks.map((ask, index) => ({ id: `a${index}`, kind: ask.kind, threadId: "thr_main", label: "x", details: [], decisions: [], turnId: null, seq: null })),
    workers: workers.map((worker, index) => ({ threadId: `w${index}`, title: "w", status: worker.status, endedAt: null })),
    lastAt: NOW, firstAt: NOW, firstSeq: 1, latestSeq: 1, latestTurnId: "t", messages: 1, unsure: 0, pinned: false, origin: "jev" as const, taskId: null,
  });

  it("knows a strand that needs you only for replies", () => {
    expect(onlyReplies(view([{ kind: "reply" }]))).toBe(true);
    expect(onlyReplies(view([{ kind: "reply" }, { kind: "question" }]))).toBe(false);
    expect(onlyReplies(view([{ kind: "reply" }], [{ status: "needs-you" }]))).toBe(false);
    expect(onlyReplies(view([]))).toBe(false);
  });

  it("doesn't push it, and a real ask on the same strand later still pushes", async () => {
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
    expect(saved).toEqual([]);
    strand = { ...view([{ kind: "question" }, { kind: "reply" }]), asks: [{ ...view([{ kind: "question" }]).asks[0]!, label: "Which branch?" }, view([{ kind: "reply" }]).asks[0]!] };
    await pushes.check();
    expect(pushed).toEqual(["Which branch?"]);
  });
});
