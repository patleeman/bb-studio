import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../migrations";
import { voiceLiveContract } from "./contract";
import { ANSWER_CHUNK_CHARS, replyChunk, STALE_MS, VOICE_LIVE_SETTINGS, VoiceLive, VoiceRefused, type LoopBefore, type VoiceAutomation, type VoiceLiveDeps, type VoiceLoop, type VoiceTarget } from "./live";
import { CLIENT_SECRETS_URL, LIVE_SESSIONS_URL, VOICE_TOOL_DEFINITIONS } from "./session";
import { LIVE_VOICES, REALTIME_CALLS_URL, STILL_WAITING_MS, VOICE_TOOLS, waitingNote } from "./shared";
import { DRAFT_MS, UNDO_MS } from "./rules";

const KEY = "sk-test-secret-key";
const NOW = new Date(2026, 10, 1, 9, 0, 0).getTime();
const COS = { name: "Dot", threadId: "thr_cos" };
const LARKSPUR: VoiceTarget = { threadId: "thr_larkspur", title: "the Larkspur lead" };

/** The retired Call's tables, which hands-free voice reuses: the same migration statement. */
const TABLES = MIGRATIONS.find((statement) => statement.includes("CREATE TABLE voice_calls"))!;

function setup(options: { key?: string; cap?: number; model?: string; status?: number; answer?: object; mock?: string } = {}, overrides: Partial<VoiceLiveDeps> = {}) {
  const db = new Database(":memory:");
  db.exec(TABLES);
  let now = NOW;
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const body = options.answer ?? (url === LIVE_SESSIONS_URL ? { session: { id: "sess_1" }, transport: { type: "webrtc", sdp: "v=0 answer" } } : { value: "ek_client_secret", expires_at: NOW / 1000 + 120 });
    return new Response(JSON.stringify(body), { status: options.status ?? (url === LIVE_SESSIONS_URL ? 201 : 200) });
  });
  const send = vi.fn(async (_input: { threadId: string; senderThreadId?: string | null; text: string; note: string; mode: string }) => {});
  const push = vi.fn(async (_input: { title: string; body: string; threadId: string; coalesceKey: string }) => {});
  const publish = vi.fn();
  const openThread = vi.fn(async (_input: { title: string; text: string; note: string }) => "thr_voice");
  const claim = vi.fn(async (_threadId: string) => true);
  const loops: Record<string, VoiceLoop> = {
    loop_1: { id: "loop_1", title: "Reply to Dana", kind: "do", status: "surfaced", priority: "urgent", due: null, trigger: { type: "none" }, owner: "patrick" },
    loop_2: { id: "loop_2", title: "Renew the domain", kind: "do", status: "queued", priority: "normal", due: null, trigger: { type: "none" }, owner: "patrick" },
    loop_ts: { id: "loop_ts", title: "Remove the stale Tailscale node", kind: "do", status: "surfaced", priority: "normal", due: null, trigger: { type: "none" }, owner: "patrick" },
  };
  const act = vi.fn(async (id: string, action: "done" | "snooze" | "hand_off" | "drop", options?: { snooze?: string; owner?: string }) => {
    const status = action === "done" ? "done" : action === "snooze" ? "snoozed" : action === "drop" ? "dropped" : "in_progress";
    loops[id] = { ...loops[id]!, status, trigger: action === "snooze" ? { type: "time", at: NOW + 3600_000, preset: options?.snooze } : loops[id]!.trigger, owner: options?.owner ?? loops[id]!.owner };
    return loops[id]!;
  });
  const add = vi.fn(async (text: string) => (loops.loop_new = { id: "loop_new", title: text, kind: "do", status: "in_progress", priority: "normal", due: null, trigger: { type: "none" }, owner: "cos" }));
  const restore = vi.fn((id: string, before: LoopBefore) => (loops[id] = { ...loops[id]!, ...before }));
  const threads = { stop: vi.fn(async (_threadId: string) => {}), archive: vi.fn(async (_threadId: string) => {}) };
  const automationList: VoiceAutomation[] = [{ id: "auto_1", name: "Morning brief", state: "active" }, { id: "auto_2", name: "Larkspur heartbeat", state: "active" }];
  const automations = { list: vi.fn(async () => automationList), pause: vi.fn(async (_id: string) => {}), remove: vi.fn(async (_id: string) => {}) };
  const resolve = vi.fn(async (name: string): Promise<VoiceTarget[]> => {
    if (/larkspur/i.test(name)) return [LARKSPUR];
    if (/launch/i.test(name)) return [{ threadId: "thr_a", title: "Launch review" }, { threadId: "thr_b", title: "Launch checklist" }];
    return [];
  });
  const live = new VoiceLive({
    db, fetch: fetch as never,
    key: () => options.key ?? KEY,
    settings: () => ({ voiceLiveMonthlyCapUsd: options.cap ?? 20, voiceLiveModel: options.model ?? "gpt-live-1" }),
    cos: () => COS,
    resolve,
    latestReply: async (threadId) => (threadId === LARKSPUR.threadId ? { title: "the Larkspur lead", text: "**Paused** the eBay fetcher until Monday." } : null),
    loops: { groups: () => ({ needsYouNow: [loops.loop_1!], comingUp: [loops.loop_2!] }), get: (id) => { if (!loops[id]) throw new Error("No such todo."); return loops[id]!; }, act, add, restore },
    threads, automations, claim,
    openThread, send, push, publish,
    mockUrl: () => options.mock ?? null,
    now: () => now,
    ...overrides,
  });
  return { db, live, fetch, send, push, publish, openThread, claim, act, add, restore, threads, automations, loops, resolve, advance: (ms: number) => { now += ms; } };
}

const said = (text: string) => ({ type: "transcript" as const, role: "user" as const, text });
/** A user line the way today's clients report it: when its speech started, and the question it came after (answers). */
const heard = (text: string, answers?: string, startedAt = 1) => ({ ...said(text), started_at: startedAt, ...(answers ? { answers } : {}) });
const actionId = (output: string) => output.match(/\(action ([ad]_[a-f0-9]+)\)/)![1]!;
const prompt = (output: string) => output.match(/Ask exactly this and wait: "([^"]+)"/)?.[1];
const eventCount = (db: Database.Database) => (db.prepare("SELECT COUNT(*) AS n FROM voice_call_events").get() as { n: number }).n;

describe("voiceLive.start", () => {
  it("gpt-live-1: Studio creates the session with the phone's SDP; no credential reaches the phone", async () => {
    const { live, fetch, openThread, claim } = setup();
    const started = await live.start({ sdp: "v=0 offer" });
    expect(voiceLiveContract["voiceLive.start"].output.parse(started)).toEqual(started);
    expect(started).toMatchObject({ model: "gpt-live-1", transport: "live-webrtc", answerSdp: "v=0 answer", clientSecret: null, callsUrl: null, mockUrl: null, cosName: "Dot" });
    expect(started.sessionId).toMatch(/^vl_[a-f0-9]{16}$/);
    expect(JSON.stringify(started)).not.toContain(KEY);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(LIVE_SESSIONS_URL);
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init?.body));
    expect(body.transport).toEqual({ type: "webrtc", sdp: "v=0 offer" });
    expect(body.session).toMatchObject({ model: "gpt-live-1", store: false, delegation: { type: "responses", responses: { parallel_tool_calls: false } } });
    expect(body.session.delegation.responses.tools.map((tool: { name: string }) => tool.name)).toEqual([...VOICE_TOOLS]);
    expect(body.session.instructions).toContain("can't spend money");
    expect(JSON.stringify(body)).not.toContain(KEY);
    // The voice thread opens beside the call.
    expect(await live.voiceThread(started.sessionId)).toBe("thr_voice");
    // It moves under the Bot, and the client learns its id.
    expect(claim).toHaveBeenCalledWith("thr_voice");
    expect(live.record(started.sessionId, []).voiceThreadId).toBe("thr_voice");
    expect(openThread.mock.calls[0]![0].title).toMatch(/^🎙 Voice · /);
  });

  it("gpt-realtime-2.1: mints a 2-minute client secret with the whole session", async () => {
    const { live, fetch } = setup({ model: "gpt-realtime-2.1" });
    const started = await live.start();
    expect(started).toMatchObject({ transport: "realtime-webrtc", clientSecret: "ek_client_secret", expiresAt: NOW + 120_000, callsUrl: REALTIME_CALLS_URL, answerSdp: null });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(CLIENT_SECRETS_URL);
    const body = JSON.parse(String(init?.body));
    expect(body.expires_after).toEqual({ anchor: "created_at", seconds: 120 });
    expect(body.session).toMatchObject({ type: "realtime", model: "gpt-realtime-2.1", audio: { input: { turn_detection: { type: "semantic_vad", interrupt_response: true } } } });
    expect(body.session.tools).toEqual(VOICE_TOOL_DEFINITIONS);
  });

  it("gpt-live-1 needs the SDP offer; no key means no OpenAI call", async () => {
    await expect(setup().live.start()).rejects.toThrow(/SDP offer/);
    const keyless = setup({ key: "" });
    await expect(keyless.live.start({ sdp: "x" })).rejects.toThrow(/needs an OpenAI API key/);
    expect(keyless.fetch).not.toHaveBeenCalled();
    expect(keyless.live.state()).toMatchObject({ ready: false, problem: expect.stringMatching(/OpenAI API key/) });
  });

  it("passes on OpenAI's error without the key", async () => {
    const { live } = setup({ status: 401, answer: { error: { message: "Incorrect API key provided" } } });
    const error = await live.start({ sdp: "x" }).catch((caught: Error) => caught);
    expect(String(error)).toMatch(/OpenAI couldn't start the voice session \(401\): Incorrect API key provided/);
    expect(String(error)).not.toContain(KEY);
  });

  it("a staged mock server needs no key and never calls OpenAI", async () => {
    const { live, fetch } = setup({ key: "", mock: "ws://127.0.0.1:8789" });
    expect(await live.start()).toMatchObject({ transport: "mock", mockUrl: "ws://127.0.0.1:8789", answerSdp: null, clientSecret: null });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the monthly cap", () => {
  it("counts GPT-Live by the second, refuses to start at the cap and tells a running session to stop", async () => {
    const { live, fetch, advance } = setup({ cap: 1 });
    const { sessionId } = await live.start({ sdp: "x" });
    // $0.05 a minute: 10 minutes is $0.50.
    expect(live.record(sessionId, [{ type: "live_usage", seconds: 600 }])).toMatchObject({ costUsd: 0.5, stop: null });
    // Cumulative: the latest total counts, not the sum.
    const over = live.record(sessionId, [{ type: "live_usage", seconds: 900 }, { type: "live_usage", seconds: 1200 }]);
    expect(over.costUsd).toBeCloseTo(1, 6);
    expect(over.stop).toMatch(/reached the \$1\.00 cap/);
    await expect(live.start({ sdp: "x" })).rejects.toThrow(VoiceRefused);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(live.state()).toMatchObject({ ready: false, capUsd: 1 });
    advance(31 * 86_400_000);
    expect(live.monthUsd()).toBe(0);
  });

  it("adds the backend's tokens and Realtime's", async () => {
    const { live } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    // gpt-5.6-luna: $0.20/M in, $1.20/M out.
    const cost = live.record(sessionId, [{ type: "live_usage", seconds: 60 }, { type: "backend_usage", input_tokens: 1_000_000, output_tokens: 1_000_000 }]).costUsd!;
    expect(cost).toBeCloseTo(0.05 + 0.2 + 1.2, 6);
    const realtime = setup({ model: "gpt-realtime-2.1" });
    const rt = await realtime.live.start();
    // 15,625 audio output tokens at $64/M is $1.
    expect(realtime.live.record(rt.sessionId, [{ type: "usage", usage: { output_token_details: { audio_tokens: 15_625 } } }]).costUsd).toBeCloseTo(1, 6);
  });
});

describe("eyes-free rules in the tool layer", () => {
  it("reads are free and write nothing", async () => {
    const { live, send, act, db } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    const before = eventCount(db);
    const loops = await live.tool(sessionId, "todos_list", "{}");
    expect(loops).toContain("Needs you now (1)");
    expect(loops).toContain("Reply to Dana (id loop_1, urgent)");
    expect(loops).toContain("Coming up (1)");
    expect(await live.tool(sessionId, "loops_list", "{}")).toBe(loops);
    expect(await live.tool(sessionId, "read_replies", JSON.stringify({ target: "the Larkspur lead" }))).toContain("Paused the eBay fetcher until Monday.");
    expect(await live.tool(sessionId, "read_replies", "")).toMatch(/Nothing was sent this session/);
    expect(send).not.toHaveBeenCalled();
    expect(act).not.toHaveBeenCalled();
    expect(eventCount(db)).toBe(before);
  });

  it("a relay goes at once, with no read-back, visibly from the voice thread", async () => {
    const { live, send } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    const output = await live.tool(sessionId, "send_to_thread", JSON.stringify({ target: "the Larkspur lead", intent: "do", message: "Pause the eBay fetcher until Monday." }));
    expect(output).toBe(`Sent to the Larkspur lead. Say just that ("Sent to the Larkspur lead."); its answer will come back here.`);
    const relay = send.mock.calls.find(([input]) => input.threadId === LARKSPUR.threadId)![0];
    expect(relay).toMatchObject({ senderThreadId: "thr_voice", mode: "auto", text: "🎙 From voice: Pause the eBay fetcher until Monday" });
    expect(relay.note).toMatch(/sent at once, without a read-back/);
    expect(relay.note).toMatch(/don't spend money, email or message people outside BB, post publicly or approve credentials/);
    expect(send.mock.calls.find(([input]) => input.threadId === "thr_voice")![0].text).toBe("→ **Sent to the Larkspur lead:** Pause the eBay fetcher until Monday");
    // To the CoS too, at once.
    expect(await live.tool(sessionId, "send_to_cos", JSON.stringify({ message: "Book the car service" }))).toMatch(/^Sent to Dot\./);
    expect(send.mock.calls.filter(([input]) => input.threadId === COS.threadId)).toHaveLength(1);
  });

  it("tells the client to wait on an \"answer\" relay, and only on one", async () => {
    const { live } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    const asked = await live.toolReply(sessionId, "send_to_thread", JSON.stringify({ target: "the Larkspur lead", intent: "answer", message: "What's the status?" }));
    expect(asked.output).toMatch(/^Sent to the Larkspur lead\. Say briefly "Asking the Larkspur lead now\."/);
    expect(asked.waitFor).toEqual({ title: "the Larkspur lead", ms: STILL_WAITING_MS, note: waitingNote("the Larkspur lead") });
    expect(asked.waitFor!.note).toContain(`"Still waiting on the Larkspur lead."`);
    expect((await live.toolReply(sessionId, "send_to_cos", JSON.stringify({ intent: "do", message: "Book the car service" }))).waitFor).toBeUndefined();
    expect((await live.toolReply(sessionId, "todos_list", "{}")).waitFor).toBeUndefined();
    expect((await live.toolReply(sessionId, "send_to_thread", JSON.stringify({ target: "nowhere", message: "hi" }))).waitFor).toBeUndefined();
  });

  it("asks which thread when a name matches more than one, and sends nothing", async () => {
    const { live, send } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    expect(await live.tool(sessionId, "send_to_thread", JSON.stringify({ target: "launch", message: "Ship it Thursday" }))).toMatch(/could be Launch review, or Launch checklist\. Ask which one\./);
    expect(await live.tool(sessionId, "send_to_thread", JSON.stringify({ target: "nowhere", message: "hi" }))).toMatch(/No thread called "nowhere"/);
    expect(send).not.toHaveBeenCalled();
  });

  it("never by voice: no such tools, and outward requests are marked so the target asks first", async () => {
    const { live, send } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    for (const name of ["send_email", "approve_credentials", "post_tweet", "purchase", "confirm_send"]) {
      expect(await live.tool(sessionId, name, "{}")).toMatch(/There's no tool named/);
    }
    const output = await live.tool(sessionId, "send_to_cos", JSON.stringify({ message: "Email Dana the pricing deck and buy the conference tickets" }));
    expect(output).toMatch(/It asks for spending money and messaging people outside BB, which voice can't approve: Dot will ask in its chat first\./);
    const relay = send.mock.calls.find(([input]) => input.threadId === COS.threadId)![0];
    expect(relay.text).toContain("⚠️ Voice can't approve this: ask me here first.");
    expect(relay.note).toMatch(/This request involves spending money and messaging people outside BB: ask first\./);
  });

  it("loops: done, snooze, hand off and add happen at once, with a 10 s undo", async () => {
    const { live, act, add, restore, loops, advance } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    for (const action of ["choose", "nudge", "keep"]) {
      expect(await live.tool(sessionId, "todos_act", JSON.stringify({ loop_id: "loop_1", action }))).toMatch(/Voice can mark a todo done, snooze it, hand it off or drop it/);
    }
    expect(act).not.toHaveBeenCalled();

    const done = await live.tool(sessionId, "todos_act", JSON.stringify({ loop_id: "loop_1", action: "done" }));
    expect(done).toMatch(/^Marked "Reply to Dana" done\. .*"undo" in the next 10 seconds \(action a_[a-f0-9]+\)/);
    expect(loops.loop_1!.status).toBe("done");
    expect(await live.tool(sessionId, "undo", JSON.stringify({ action_id: actionId(done) }))).toBe(`Undone: "Reply to Dana" is back as it was.`);
    expect(restore).toHaveBeenCalledWith("loop_1", { status: "surfaced", trigger: { type: "none" }, owner: "patrick" });
    expect(await live.tool(sessionId, "undo", "{}")).toBe("That was already undone.");

    const handed = await live.tool(sessionId, "todos_act", JSON.stringify({ loop_id: "loop_1", action: "hand_off", to: "the Larkspur lead" }));
    expect(handed).toMatch(/^Handed "Reply to Dana" to the Larkspur lead\./);
    expect(act).toHaveBeenLastCalledWith("loop_1", "hand_off", { snooze: undefined, owner: "thread:thr_larkspur" });
    await live.tool(sessionId, "undo", "{}");
    expect(loops.loop_1!.owner).toBe("patrick");

    const added = await live.tool(sessionId, "todos_add", JSON.stringify({ text: "Call the plumber back" }));
    expect(added).toMatch(/^Added "Call the plumber back"; Dot will fill it in\./);
    expect(add).toHaveBeenCalledWith("Call the plumber back");
    expect(await live.tool(sessionId, "undo", "{}")).toBe(`Undone: "Call the plumber back" is gone.`);
    expect(loops.loop_new!.status).toBe("dropped");

    expect(await live.tool(sessionId, "todos_act", JSON.stringify({ loop_id: "loop_2", action: "snooze", snooze: "tonight" }))).toMatch(/^Snoozed "Renew the domain" to tonight/);
    advance(UNDO_MS + 1);
    expect(await live.tool(sessionId, "undo", "{}")).toMatch(/undo window for "Renew the domain" has closed/);
    expect(loops.loop_2!.status).toBe("snoozed");
  });

  it("destructive: dropping a todo waits for the user's own spoken yes", async () => {
    const { live, act, loops } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    const asked = await live.tool(sessionId, "todos_act", JSON.stringify({ loop_id: "loop_ts", action: "drop" }));
    expect(prompt(asked)).toBe(`Drop the todo 'Remove the stale Tailscale node'? Say yes to drop.`);
    expect(act).not.toHaveBeenCalled();
    const id = actionId(asked);
    // The model can't confirm on its own; filler, unclear talk and the voice's own echo aren't a yes.
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }))).toMatch(/hasn't heard the user answer/);
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [heard("Thank you for watching", id)])).toMatch(/hasn't heard/);
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [heard("Drop the todo Remove the stale Tailscale node? Say yes to drop.", id)])).toMatch(/didn't hear a clear yes/);
    expect(act).not.toHaveBeenCalled();
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [heard("Yes, drop it", id)])).toBe(`Dropped the todo 'Remove the stale Tailscale node'. Say that briefly; it can't be undone by voice.`);
    expect(act).toHaveBeenCalledWith("loop_ts", "drop");
    expect(loops.loop_ts!.status).toBe("dropped");
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [heard("yes", id)])).toBe("That was already done.");
  });

  it("destructive: a yes before the question doesn't count, a no cancels, and it times out", async () => {
    const { live, threads, advance } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    live.record(sessionId, [heard("yes")]);
    const id = actionId(await live.tool(sessionId, "stop_thread", JSON.stringify({ target: "the Larkspur lead" })));
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }))).toMatch(/hasn't heard/);
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [heard("No, wait, leave it running", id)])).toMatch(/nothing was done/);
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [heard("yes", id)])).toMatch(/was cancelled/);
    const late = actionId(await live.tool(sessionId, "archive_thread", JSON.stringify({ target: "the Larkspur lead" })));
    advance(DRAFT_MS + 1);
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: late }), [heard("yes", late)])).toMatch(/timed out/);
    expect(threads.stop).not.toHaveBeenCalled();
    expect(threads.archive).not.toHaveBeenCalled();
  });

  it("destructive: stop or archive a thread, pause or delete an automation, each after a yes", async () => {
    const { live, threads, automations } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    const cases: [string, Record<string, string>, string, string][] = [
      ["stop_thread", { target: "the Larkspur lead" }, `Stop the thread 'the Larkspur lead'? Say yes to stop.`, `Stopped 'the Larkspur lead'.`],
      ["archive_thread", { target: "the Larkspur lead" }, `Archive the thread 'the Larkspur lead'? Say yes to archive.`, `Archived 'the Larkspur lead'.`],
      ["pause_automation", { name: "the morning brief" }, `Pause the automation 'Morning brief'? Say yes to pause.`, `Paused the automation 'Morning brief'.`],
      ["delete_automation", { name: "Larkspur heartbeat" }, `Delete the automation 'Larkspur heartbeat'? It can't be undone. Say yes to delete.`, `Deleted the automation 'Larkspur heartbeat'.`],
    ];
    for (const [tool, args, question, done] of cases) {
      const asked = await live.tool(sessionId, tool, JSON.stringify(args));
      expect(prompt(asked)).toBe(question);
      expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: actionId(asked) }), [heard("Yes, stop it", actionId(asked))])).toBe(`${done} Say that briefly; it can't be undone by voice.`);
    }
    expect(threads.stop).toHaveBeenCalledWith(LARKSPUR.threadId);
    expect(threads.archive).toHaveBeenCalledWith(LARKSPUR.threadId);
    expect(automations.pause).toHaveBeenCalledWith("auto_1");
    expect(automations.remove).toHaveBeenCalledWith("auto_2");
    expect(await live.tool(sessionId, "pause_automation", JSON.stringify({ name: "nightly backup" }))).toMatch(/No automation called "nightly backup"\. There's Morning brief, Larkspur heartbeat\./);
    // Cancel.
    const asked = await live.tool(sessionId, "stop_thread", JSON.stringify({ target: "the Larkspur lead" }));
    expect(await live.tool(sessionId, "cancel", JSON.stringify({ action_id: actionId(asked) }))).toBe("Cancelled; nothing was done.");
    expect(threads.stop).toHaveBeenCalledTimes(1);
  });
});

describe("a spoken yes counts only when it was said after the question", () => {
  it("the request itself, transcribed after the question was written, isn't the yes (review finding 3)", async () => {
    const { live, automations } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    // Realtime's transcription is late: the model calls delete first, and the request lands after the question.
    const asked = await live.tool(sessionId, "delete_automation", JSON.stringify({ name: "Larkspur heartbeat" }));
    const id = actionId(asked);
    // The client heard that line start before the question came back, so it doesn't mark it as answering it.
    live.record(sessionId, [heard("Okay, delete the heartbeat", undefined, 1_000)]);
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }))).toMatch(/hasn't heard the user answer/);
    expect(automations.remove).not.toHaveBeenCalled();
    // A line that answers another question doesn't count for this one either.
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [heard("Yes", "d_00000000", 5_000)])).toMatch(/hasn't heard/);
    expect(automations.remove).not.toHaveBeenCalled();
    // The user's own yes, said after the question: done.
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [heard("Yes, delete it", id, 6_000)])).toMatch(/^Deleted the automation 'Larkspur heartbeat'/);
    expect(automations.remove).toHaveBeenCalledWith("auto_2");
  });

  it("an older client that doesn't say when a line started can't confirm by voice: nothing is done", async () => {
    const { live, threads } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    const id = actionId(await live.tool(sessionId, "stop_thread", JSON.stringify({ target: "the Larkspur lead" })));
    const output = await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [said("Yes, stop it")]);
    expect(output).toMatch(/nothing was done/);
    expect(output).toMatch(/in BB/);
    expect(threads.stop).not.toHaveBeenCalled();
  });

  it("stores when each line started, from the contract", () => {
    const parsed = voiceLiveContract["voiceLive.event"].input.parse({ sessionId: "vl_0123456789abcdef", events: [heard("yes", "d_0a1b2c3d", 42)] });
    expect(parsed.events[0]).toEqual({ type: "transcript", role: "user", text: "yes", started_at: 42, answers: "d_0a1b2c3d" });
  });
});

describe("sessions whose hang-up never arrives (review finding 2)", () => {
  it("are ended by the reaper after STALE_MS with no word from the client: the transcript is posted and later replies are pushed", async () => {
    const { live, send, push, publish, advance } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    await live.tool(sessionId, "send_to_cos", JSON.stringify({ message: "Check the backups" }), [said("Tell Dot to check the backups")]);
    advance(STALE_MS - 1000);
    expect(await live.reap()).toEqual([]);
    advance(2000);
    expect(await live.reap()).toEqual([sessionId]);
    expect(live.view(sessionId).endedAt).not.toBeNull();
    expect(publish).toHaveBeenCalledWith({ sessionId, kind: "ended" });
    expect(send.mock.calls.some(([input]) => input.threadId === "thr_voice" && input.text.includes("**You:** Tell Dot to check the backups"))).toBe(true);
    // Reaped once.
    expect(await live.reap()).toEqual([]);
    // The reply goes to the phone, not to a session that's gone.
    await live.idle(COS.threadId, "Backups are fine.");
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ title: "Dot answered", body: "Backups are fine." }));
  });

  it("a session that keeps syncing isn't reaped, even when nothing is said", async () => {
    const { live, advance } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    for (let minute = 0; minute < 30; minute++) {
      advance(60_000);
      live.record(sessionId, []);
    }
    expect(await live.reap()).toEqual([]);
    advance(STALE_MS + 1);
    expect(await live.reap()).toEqual([sessionId]);
  });

  it("a late real end after the reaper still counts its usage, once; a concurrent end posts the transcript once", async () => {
    const { live, send, advance } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    live.record(sessionId, [said("What's waiting?")]);
    advance(STALE_MS + 1);
    const posts = () => send.mock.calls.filter(([input]) => input.threadId === "thr_voice").length;
    // The reaper and the client's end at the same moment: end() is coalesced.
    const [reaped, ended] = await Promise.all([live.reap(), live.end(sessionId, [{ type: "live_usage", seconds: 60 }])]);
    expect(reaped).toEqual([sessionId]);
    expect(ended.endedAt).not.toBeNull();
    expect(posts()).toBe(1);
    // The client was offline and its end arrives late, with the minutes it couldn't report: they count, once.
    const late = await live.end(sessionId, [{ type: "live_usage", seconds: 600 }, { type: "backend_usage", input_tokens: 1_000_000, output_tokens: 0 }]);
    expect(late.costUsd).toBeCloseTo(0.5 + 0.2, 6);
    const retried = await live.end(sessionId, [{ type: "live_usage", seconds: 600 }, { type: "backend_usage", input_tokens: 1_000_000, output_tokens: 0 }]);
    expect(retried.costUsd).toBeCloseTo(0.5 + 0.2, 6);
    expect(live.monthUsd()).toBeCloseTo(0.5 + 0.2, 6);
    expect(posts()).toBe(1);
  });

  it("an end the client sent itself isn't reopened by a retry", async () => {
    const { live } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    await live.end(sessionId, [{ type: "live_usage", seconds: 60 }]);
    // The answer was lost, so the client sends the same end again: nothing is counted twice.
    const again = await live.end(sessionId, [{ type: "live_usage", seconds: 60 }, { type: "backend_usage", input_tokens: 1_000_000, output_tokens: 0 }]);
    expect(again.costUsd).toBeCloseTo(0.05, 6);
  });
});

describe("replies, interruptions and hang-up", () => {
  it("a target's reply comes back to the live session; after hang-up to the phone and the voice thread", async () => {
    const { live, publish, push, send } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    // Not sent to: ignored.
    expect(await live.idle(LARKSPUR.threadId, "Done.")).toEqual([]);
    await live.tool(sessionId, "send_to_thread", JSON.stringify({ target: "Larkspur lead", message: "Pause the eBay fetcher" }), [said("Tell the Larkspur lead to pause the eBay fetcher")]);
    expect(await live.idle(LARKSPUR.threadId, "[PASS]")).toEqual([]);
    expect(await live.idle(LARKSPUR.threadId, "**Paused.** It resumes Monday at 9.")).toEqual([sessionId]);
    expect(publish).toHaveBeenCalledWith({ sessionId, kind: "reply" });
    // During the session a reply goes in the end transcript, not its own post.
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("answered") }));
    const polled = live.poll(sessionId);
    expect(polled.replies).toEqual([expect.objectContaining({ title: "the Larkspur lead", summary: "Paused. It resumes Monday at 9." })]);
    expect(polled.replies[0]!.note).toMatch(/^\(Studio, not the user:\) the Larkspur lead answered/);
    expect(live.poll(sessionId).replies).toEqual([]);
    expect(await live.idle(LARKSPUR.threadId, "Something else")).toEqual([]);

    const ended = await live.end(sessionId, [{ type: "interrupted", heard: "The fetcher is" }, { type: "transcript", role: "assistant", text: "Bye." }]);
    expect(ended.endedAt).not.toBeNull();
    expect(ended.sent).toEqual([expect.objectContaining({ title: "the Larkspur lead", message: "Pause the eBay fetcher" })]);
    const last = send.mock.calls.filter(([input]) => input.threadId === "thr_voice").at(-1)![0];
    expect(last.threadId).toBe("thr_voice");
    expect(last.text).toMatch(/^🎙 \*\*Voice session · \d+ s\*\* · ≈\$0\.00 · sent 1 message/);
    expect(last.text).toContain("**You:** Tell the Larkspur lead to pause the eBay fetcher");
    expect(last.text).toContain("→ **Sent to the Larkspur lead:** Pause the eBay fetcher");
    expect(last.text).toContain("← **the Larkspur lead answered:** Paused. It resumes Monday at 9.");
    expect(last.text.indexOf("_(interrupted)_")).toBeLessThan(last.text.indexOf("**Voice:** Bye."));
    await expect(live.tool(sessionId, "todos_list", "{}")).rejects.toThrow(/has ended/);
    // A later answer goes to the phone and the voice thread.
    const second = setup();
    const s2 = await second.live.start({ sdp: "x" });
    await second.live.tool(s2.sessionId, "send_to_cos", JSON.stringify({ message: "Check the backups" }));
    await second.live.end(s2.sessionId);
    await second.live.idle(COS.threadId, "Backups are fine.");
    expect(second.push).toHaveBeenCalledWith(expect.objectContaining({ title: "Dot answered", body: "Backups are fine." }));
    expect(second.send).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: "thr_voice", text: "← **Dot answered** (after the session): Backups are fine." }));
    expect(push).not.toHaveBeenCalled();
  });
});

describe("the phone's audio events", () => {
  it("stores false mutes, route changes, interruptions and why it closed in voice_call_events, and shows none of them", async () => {
    const { db, live, send } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    const at = NOW + 5_000;
    const events = [
      { type: "false_trigger", at, mic: 0.21, playback: 0.12, muted_ms: 490 },
      { type: "route_change", at: at + 1, reason: "new_device", input: "BluetoothHFP (AirPods Pro)", output: "BluetoothHFP (AirPods Pro)" },
      { type: "audio_interruption", at: at + 2, began: true },
      { type: "audio_interruption", at: at + 3, began: false },
      { type: "app_state", at: at + 4, state: "background" },
    ] as const;
    // Through the contract, as BB's RPC layer parses them.
    const parsed = voiceLiveContract["voiceLive.event"].input.parse({ sessionId, events });
    live.record(sessionId, parsed.events);
    const close = voiceLiveContract["voiceLive.end"].input.parse({ sessionId, events: [{ type: "close", at: at + 5, reason: "transport", detail: "The connection was lost.", background: true }] });
    await live.end(sessionId, close.events);
    const rows = db.prepare("SELECT at, kind, data FROM voice_call_events WHERE call_id = ? AND kind IN ('false_trigger', 'route_change', 'audio_interruption', 'app_state', 'close') ORDER BY id").all(sessionId) as { at: number; kind: string; data: string }[];
    expect(rows.map((row) => [row.at - at, row.kind, JSON.parse(row.data)])).toEqual([
      [0, "false_trigger", { mic: 0.21, playback: 0.12, muted_ms: 490 }],
      [1, "route_change", { reason: "new_device", input: "BluetoothHFP (AirPods Pro)", output: "BluetoothHFP (AirPods Pro)" }],
      [2, "audio_interruption", { began: true }],
      [3, "audio_interruption", { began: false }],
      [4, "app_state", { state: "background" }],
      [5, "close", { reason: "transport", detail: "The connection was lost.", background: true }],
    ]);
    // Not in the voice thread's transcript.
    for (const [input] of send.mock.calls) expect(input.text).not.toMatch(/false_trigger|route|AirPods|transport/);
    expect(() => voiceLiveContract["voiceLive.event"].input.parse({ sessionId, events: [{ type: "close", reason: "gone" }] })).toThrow();
    expect(() => voiceLiveContract["voiceLive.event"].input.parse({ sessionId, events: [{ type: "false_trigger", mic: 2, playback: 0, muted_ms: 1 }] })).toThrow();
  });
});

describe("the voice thread", () => {
  it("gets each relay as it happens and the whole transcript once, at hang-up: no posting turns in between", async () => {
    const { live, send } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    const posts = () => send.mock.calls.filter(([input]) => input.threadId === "thr_voice").map(([input]) => input.text);
    // Talk, reads, todo actions, a destructive one, usage and a reply: nothing posted.
    live.record(sessionId, [said("What's waiting?"), { type: "transcript", role: "assistant", text: "Two things." }, { type: "live_usage", seconds: 30 }]);
    await live.tool(sessionId, "todos_list", "{}");
    await live.tool(sessionId, "todos_act", JSON.stringify({ loop_id: "loop_1", action: "done" }));
    const asked = await live.tool(sessionId, "todos_act", JSON.stringify({ loop_id: "loop_ts", action: "drop" }));
    await live.tool(sessionId, "confirm", JSON.stringify({ action_id: actionId(asked) }), [heard("yes", actionId(asked))]);
    live.record(sessionId, [said("Tell Dot to book the car")]);
    expect(posts()).toEqual([]);
    // The relay: one post, right away.
    await live.tool(sessionId, "send_to_cos", JSON.stringify({ message: "Book the car service for Friday" }));
    expect(posts()).toEqual(["→ **Sent to Dot:** Book the car service for Friday"]);
    await live.idle(COS.threadId, "Booked for Friday at 8.");
    live.record(sessionId, [{ type: "transcript", role: "assistant", text: "Dot booked it for Friday at eight." }, { type: "live_usage", seconds: 90 }]);
    expect(posts()).toHaveLength(1);
    // Hang-up: one more post with everything, in order.
    await live.end(sessionId);
    expect(posts()).toHaveLength(2);
    expect(posts()[1]!.split("\n\n")).toEqual([
      expect.stringMatching(/^🎙 \*\*Voice session · /),
      "**You:** What's waiting?",
      "**Voice:** Two things.",
      "✓ **Todo done:** Reply to Dana",
      "**You:** yes",
      `⚠️ **Done after a spoken yes:** Dropped the todo 'Remove the stale Tailscale node'.`,
      "**You:** Tell Dot to book the car",
      "→ **Sent to Dot:** Book the car service for Friday",
      "← **Dot answered:** Booked for Friday at 8.",
      "**Voice:** Dot booked it for Friday at eight.",
    ]);
    await live.end(sessionId);
    expect(posts()).toHaveLength(2);
  });
});

describe("searching voice threads", () => {
  it("finds a session by its words (BB's thread search skips hidden threads), with its voice thread and the matching line", async () => {
    const { live } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    await live.voiceThread(sessionId);
    await live.tool(sessionId, "send_to_thread", JSON.stringify({ target: "the Larkspur lead", message: "Pause the eBay fetcher until Monday" }), [said("Tell the Larkspur lead to pause the eBay fetcher")]);
    live.record(sessionId, [{ type: "transcript", role: "assistant", text: "Sent to the Larkspur lead." }]);
    const hits = live.search("eBay fetcher");
    expect(hits).toEqual([{ threadId: "thr_voice", title: expect.stringMatching(/^🎙 Voice · /), text: "Tell the Larkspur lead to pause the eBay fetcher", at: expect.any(Number) }]);
    // Every word must be there; case doesn't matter.
    expect(live.search("EBAY monday")).toHaveLength(1);
    expect(live.search("eBay tulips")).toEqual([]);
    expect(live.search("  ")).toEqual([]);
    // A session whose thread never opened isn't findable (there's nothing to open).
    const keyless = setup({}, { openThread: async () => { throw new Error("no"); } });
    const s2 = await keyless.live.start({ sdp: "x" });
    await keyless.live.voiceThread(s2.sessionId);
    keyless.live.record(s2.sessionId, [said("eBay fetcher")]);
    expect(keyless.live.search("eBay")).toEqual([]);
  });
});

describe("identity: the session speaks as the thread it was launched from", () => {
  const leadSeed = { kind: "lead" as const, name: "Larkspur lead", threadId: "thr_larkspur", role: "Lead of the Larkspur project.", recent: [{ role: "assistant" as const, text: "The eBay fetcher hit a rate limit." }], project: "Larkspur" };

  it("builds the seed once at start, puts it in the instructions and returns who it speaks as", async () => {
    const seed = vi.fn(async (threadId: string | null) => (threadId === "thr_larkspur" ? leadSeed : null));
    const { live, fetch, db } = setup({}, { seed });
    const started = await live.start({ sdp: "v=0 offer", threadId: "thr_larkspur" });
    expect(seed).toHaveBeenCalledTimes(1);
    expect(seed).toHaveBeenCalledWith("thr_larkspur");
    expect(started.identity).toEqual({ kind: "lead", label: "Larkspur lead", name: "Larkspur lead", threadId: "thr_larkspur" });
    expect(voiceLiveContract["voiceLive.start"].output.parse(started)).toEqual(started);
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    for (const instructions of [body.session.instructions, body.session.delegation.responses.instructions]) {
      expect(instructions).toContain('You are the voice of the thread "Larkspur lead"');
      expect(instructions).toContain("<context>\nYou speak for the thread \"Larkspur lead\".\nRole: Lead of the Larkspur project.");
      expect(instructions).toContain("Larkspur lead: The eBay fetcher hit a rate limit.");
    }
    const recorded = db.prepare("SELECT data FROM voice_call_events WHERE kind = 'identity'").get() as { data: string };
    expect(JSON.parse(recorded.data)).toMatchObject({ identity: { kind: "lead" }, missing: [], ms: 0 });

    // Tools don't rebuild it.
    await live.tool(started.sessionId, "todos_list", "{}");
    await live.tool(started.sessionId, "send_to_thread", JSON.stringify({ message: "Retry the fetcher" }));
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it("relays with no target go to the launching thread; send_to_cos and names still reach the others", async () => {
    const { live, send } = setup({}, { seed: async () => leadSeed });
    const { sessionId } = await live.start({ sdp: "v=0 offer", threadId: "thr_larkspur" });
    expect(await live.tool(sessionId, "send_to_thread", JSON.stringify({ target: "", message: "Retry the fetcher at noon" }))).toMatch(/^Sent to Larkspur lead\./);
    expect(send.mock.calls.at(-2)![0]).toMatchObject({ threadId: "thr_larkspur", text: "🎙 From voice: Retry the fetcher at noon" });
    expect(await live.tool(sessionId, "send_to_cos", JSON.stringify({ message: "Book the car" }))).toMatch(/^Sent to Dot\./);
    expect(send.mock.calls.at(-2)![0]).toMatchObject({ threadId: "thr_cos" });
  });

  it("launched from the Chief of Staff, or with no seed source, it is the Chief of Staff and relays there by default", async () => {
    for (const overrides of [{ seed: async () => null }, {}, { seed: async () => { throw new Error("sources down"); } }]) {
      const { live, send } = setup({}, overrides as Partial<VoiceLiveDeps>);
      const started = await live.start({ sdp: "v=0 offer" });
      expect(started.identity).toEqual({ kind: "cos", label: "Chief of Staff", name: "Dot", threadId: "thr_cos" });
      expect(await live.tool(started.sessionId, "send_to_thread", JSON.stringify({ message: "Check the backups" }))).toMatch(/^Sent to Dot\./);
      expect(send.mock.calls.at(-2)![0]).toMatchObject({ threadId: "thr_cos" });
    }
  });

  it("no seed is built when the start is refused", async () => {
    const seed = vi.fn(async () => leadSeed);
    const { live } = setup({}, { seed });
    await expect(live.start({ threadId: "thr_larkspur" })).rejects.toThrow(/needs the phone's SDP offer/);
    expect(seed).not.toHaveBeenCalled();
  });
});

describe("hands-free voice's settings: the next session's model, voice, backend and cap", () => {
  /** A settings store like BB's: defined defaults, then saved values over them. */
  function withStore(saved: Record<string, unknown> = {}) {
    const defaults = Object.fromEntries(Object.entries(VOICE_LIVE_SETTINGS).map(([key, spec]) => [key, spec.default]));
    let values: Record<string, unknown> = { ...defaults, ...saved };
    const saveSettings = vi.fn(async (patch: Record<string, unknown>) => { values = { ...values, ...patch }; });
    return { saveSettings, settings: () => values };
  }

  it("defaults to today's values: gpt-live-1, marin, gpt-5.6-luna and $20, with plain labels", () => {
    expect(Object.fromEntries(Object.entries(VOICE_LIVE_SETTINGS).map(([key, spec]) => [key, spec.default]))).toEqual({
      voiceLiveModel: "gpt-live-1", voiceLiveVoice: "marin", voiceLiveBackendModel: "gpt-5.6-luna", voiceLiveMonthlyCapUsd: 20,
    });
    // Studio settings in its Voice section, with plain labels (no "Hands-free voice:" prefix).
    for (const spec of Object.values(VOICE_LIVE_SETTINGS)) { expect(spec.group).toBe("voice"); expect(spec.label).not.toMatch(/:/); }
    // Every voice of either model is a valid option; the select can't filter by model, so start falls back to marin.
    expect(VOICE_LIVE_SETTINGS.voiceLiveVoice.options).toEqual(expect.arrayContaining([...LIVE_VOICES["gpt-live-1"], ...LIVE_VOICES["gpt-realtime-2.1"]]));
    // Nothing saved at all (or junk) still means today's values.
    const { live } = setup({}, { settings: () => ({}) });
    expect(live.state()).toMatchObject({ model: "gpt-live-1", voice: "marin", backendModel: "gpt-5.6-luna", capUsd: 20 });
    const junk = setup({}, { settings: () => ({ voiceLiveModel: "gpt-9", voiceLiveVoice: "nobody", voiceLiveBackendModel: "gpt-1", voiceLiveMonthlyCapUsd: -3 }) });
    expect(junk.live.state()).toMatchObject({ model: "gpt-live-1", voice: "marin", backendModel: "gpt-5.6-luna", capUsd: 20 });
  });

  it("each model lists only its own voices; marin is in both", () => {
    expect(LIVE_VOICES["gpt-live-1"]).toContain("quartz");
    expect(LIVE_VOICES["gpt-live-1"]).not.toContain("cedar");
    expect(LIVE_VOICES["gpt-realtime-2.1"]).toEqual(expect.arrayContaining(["cedar", "alloy", "verse"]));
    expect(LIVE_VOICES["gpt-realtime-2.1"]).not.toContain("quartz");
    for (const voices of Object.values(LIVE_VOICES)) expect(voices[0]).toBe("marin");
  });

  it("the menu's choices are saved as Studio settings and returned as the new state", async () => {
    const store = withStore();
    const { live } = setup({}, store);
    expect(voiceLiveContract["voiceLive.configure"].output.parse(await live.configure({ voice: "quartz" }))).toMatchObject({ model: "gpt-live-1", voice: "quartz" });
    expect(store.saveSettings).toHaveBeenLastCalledWith({ voiceLiveVoice: "quartz" });
    expect(await live.configure({ backendModel: "gpt-5.6-terra" })).toMatchObject({ backendModel: "gpt-5.6-terra" });
    expect(store.saveSettings).toHaveBeenLastCalledWith({ voiceLiveBackendModel: "gpt-5.6-terra" });
    // Realtime has no quartz: switching moves the voice to marin.
    expect(await live.configure({ model: "gpt-realtime-2.1" })).toMatchObject({ model: "gpt-realtime-2.1", voice: "marin" });
    expect(store.saveSettings).toHaveBeenLastCalledWith({ voiceLiveModel: "gpt-realtime-2.1", voiceLiveVoice: "marin" });
    // A voice the model doesn't have is refused, and nothing is saved.
    const calls = store.saveSettings.mock.calls.length;
    await expect(live.configure({ voice: "quartz" })).rejects.toThrow(/gpt-realtime-2.1 has no voice called quartz/);
    expect(store.saveSettings).toHaveBeenCalledTimes(calls);
    // Marin survives a model switch.
    expect(await live.configure({ model: "gpt-live-1" })).toMatchObject({ model: "gpt-live-1", voice: "marin" });
    expect(store.saveSettings).toHaveBeenLastCalledWith({ voiceLiveModel: "gpt-live-1" });
  });

  it("the next session picks them up: GPT-Live's voice and backend, Realtime's voice, and the cost by that backend", async () => {
    const store = withStore({ voiceLiveMonthlyCapUsd: 100 });
    const { live, fetch, db } = setup({}, store);
    await live.configure({ voice: "vesper", backendModel: "gpt-5.6-sol" });
    const started = await live.start({ sdp: "x" });
    const body = JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body));
    expect(body.session.audio.output.voice).toBe("vesper");
    expect(body.session.delegation.responses.model).toBe("gpt-5.6-sol");
    expect(db.prepare("SELECT voice FROM voice_calls WHERE id = ?").get(started.sessionId)).toEqual({ voice: "vesper" });
    // Its backend tokens are priced as gpt-5.6-sol ($4/M in, $20/M out), not luna.
    expect(live.record(started.sessionId, [{ type: "backend_usage", input_tokens: 1_000_000, output_tokens: 1_000_000 }]).costUsd).toBeCloseTo(4 + 20, 6);

    await live.configure({ model: "gpt-realtime-2.1" });
    await live.configure({ voice: "cedar" });
    const realtime = await live.start();
    expect(realtime.model).toBe("gpt-realtime-2.1");
    const secret = JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body));
    expect(secret.session.audio.output.voice).toBe("cedar");
    // A model passed in that lacks the saved voice speaks in marin.
    await live.configure({ voice: "ash" });
    await live.start({ model: "gpt-live-1", sdp: "x" });
    expect(JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body)).session.audio.output.voice).toBe("marin");
  });

  it("the cap is a setting too: the state shows this month's spend against it", async () => {
    const { live } = setup({}, withStore({ voiceLiveMonthlyCapUsd: 5 }));
    expect(live.state()).toMatchObject({ capUsd: 5, monthUsd: 0, ready: true });
  });
});


describe("hands-free answer intent", () => {
  it.each(["answer", "invalid", undefined])("preserves full answers for %s intent", async (intent) => {
    const { live, send, db } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    const message = "The user asks you to run through the changes you're working on";
    const result = await live.tool(sessionId, "send_to_cos", JSON.stringify({ intent, message }), [said("run through the changes you're working on")]);
    expect(result).toContain('Asking Dot now.');
    expect(result).not.toContain("Say just that");
    const target = send.mock.calls[0]![0];
    expect(target.text).toBe(`🎙 From voice: ${message}`);
    expect(target.note).toContain("Answer the question fully");
    const sent = db.prepare("SELECT data FROM voice_call_events WHERE kind = 'sent'").get() as { data: string };
    expect(JSON.parse(sent.data).intent).toBe("answer");
    const reply = [
      "I am fixing the hands-free voice relays so your questions reach the right thread with their meaning intact. When you ask for a run-through, the target receives that request and answers it fully.",
      "The second change is reading the whole answer aloud. Previously the server clipped replies and told the voice to give a sentence or two. Now it keeps the full reply and reads it in parts when needed.",
      "The seed now includes the latest reply from the launching chat. At hang-up, that chat also gets a compact record of the conversation, with a link to the full voice transcript. These changes keep the thread informed without repeating work it already handled.",
    ].join("\n\n");
    await live.idle(COS.threadId, reply);
    const note = live.poll(sessionId).replies[0]!.note;
    expect(note).toContain(`<reply>${reply.replace(/\n{2,}/g, "\n")}</reply>`);
    expect(note).toContain("without shortening");
    expect(note).not.toContain("Then ask");
    expect(await live.tool(sessionId, "read_replies", "{}")).toBe(note);
    live.record(sessionId, [{ type: "transcript", role: "assistant", text: reply }]);
    await Promise.all([live.end(sessionId), live.end(sessionId)]);
    await live.end(sessionId);
    const home = send.mock.calls.filter(([input]) => input.threadId === COS.threadId && input.text.startsWith("🎙 Voice session"));
    expect(home).toHaveLength(1);
    expect(home[0]![0]).toMatchObject({ senderThreadId: "thr_voice", mode: "queue-if-active" });
    expect(home[0]![0].text.length).toBeLessThanOrEqual(4000);
    expect(home[0]![0].text).toContain("@thread:thr_voice");
    expect(home[0]![0].note).toContain("otherwise reply exactly [PASS]");
    expect(send.mock.calls.filter(([input]) => input.threadId === "thr_voice").at(-1)![0].text).toContain(reply.replace(/\n{2,}/g, "\n"));
    // VOICE_TRANSCRIPT_OUT=<file> writes this session out as a readable transcript.
    if (intent === "answer" && process.env.VOICE_TRANSCRIPT_OUT) writeFileSync(process.env.VOICE_TRANSCRIPT_OUT, [
      "# LiveVoice test session (real class, in-memory database, fake dependencies)",
      "User: run through the changes you're working on", "Relay tool: send_to_cos; intent: answer", "## Target message", target.text,
      "## Target agent-only note", target.note, "## Target reply", reply,
      "## Exact note delivered to voice", note, "## Hang-up post to launching thread", home[0]![0].text,
      "## Hang-up agent-only note", home[0]![0].note,
      "No live OpenAI session was run. This fixture uses fake transport and agent replies.",
    ].join("\n\n"));
  });

  it("a failed post to the launching thread still ends the session", async () => {
    const { live, send } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    live.record(sessionId, [said("what's new"), { type: "transcript", role: "assistant", text: "Nothing new." }]);
    send.mockImplementation(async (input: { threadId: string }) => { if (input.threadId === COS.threadId) throw new Error("offline"); });
    const view = await live.end(sessionId);
    expect(view.endedAt).not.toBeNull();
  });

  it("chunks at sentences and retrieves every part without losing words", async () => {
    const { live } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    await live.tool(sessionId, "send_to_thread", JSON.stringify({ target: "Larkspur", intent: "answer", message: "Walk me through the changes" }));
    const reply = Array.from({ length: 80 }, (_, i) => `Change ${i} preserves the user's request and gives the complete answer.`).join(" ");
    await live.idle(LARKSPUR.threadId, reply);
    expect(live.poll(sessionId).replies[0]!.note).toContain("Reply cut: true");
    let part = 1;
    const chunks: string[] = [];
    for (;;) {
      const chunk = replyChunk(reply, part);
      expect(chunk.text.length).toBeLessThanOrEqual(ANSWER_CHUNK_CHARS);
      expect(chunk.text).toMatch(/\.$/);
      const note = await live.tool(sessionId, "read_replies", JSON.stringify({ target: "Larkspur", part }));
      expect(note).toContain(`<reply>${chunk.text}</reply>`);
      chunks.push(chunk.text);
      if (!chunk.cut) break;
      expect(note).toContain(`part ${part + 1}`);
      part++;
    }
    expect(chunks.join(" ")).toBe(reply);
    expect(replyChunk("word ".repeat(500)).text.length).toBeLessThanOrEqual(ANSWER_CHUNK_CHARS);
  });

  it.each(["do", "fyi"])("keeps %s replies short", async (intent) => {
    const { live } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    await live.tool(sessionId, "send_to_cos", JSON.stringify({ intent, message: "Check the backups" }));
    await live.idle(COS.threadId, "All fine. ".repeat(400));
    const note = live.poll(sessionId).replies[0]!.note;
    expect(note.length).toBeLessThan(800);
    expect(note).toContain("sentence or two");
    expect(await live.tool(sessionId, "read_replies", "{}")).toBe(note);
  });

  it("posts to the launching identity, and skips sessions without user words", async () => {
    const { live, send } = setup({}, { seed: async () => ({ kind: "thread", name: "Launch", threadId: "thr_launch", role: null, recent: [] }) });
    const { sessionId } = await live.start({ sdp: "x", threadId: "thr_launch" });
    live.record(sessionId, [said("What changed?"), { type: "transcript", role: "assistant", text: "The build is ready." }]);
    await live.end(sessionId);
    expect(send.mock.calls.filter(([input]) => input.threadId === "thr_launch")).toHaveLength(1);
    for (const silent of [[], [{ type: "transcript" as const, role: "assistant" as const, text: "Hello." }]]) {
      const fixture = setup();
      const start = await fixture.live.start({ sdp: "x" });
      await fixture.live.end(start.sessionId, silent);
      expect(fixture.send.mock.calls.filter(([input]) => input.threadId === COS.threadId)).toHaveLength(0);
    }
  });
});

it("declares relay intent and read-back rules in both model instructions", async () => {
  for (const name of ["send_to_cos", "send_to_thread"]) {
    const tool = VOICE_TOOL_DEFINITIONS.find((tool) => tool.name === name)!;
    expect(tool.parameters.required).toContain("intent");
    expect((tool.parameters.properties as Record<string, { enum?: string[] }>).intent!.enum).toEqual(["answer", "do", "fyi"]);
  }
  const { live, fetch } = setup();
  await live.start({ sdp: "x" });
  const request = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
  for (const instructions of [request.session.instructions, request.session.delegation.responses.instructions]) {
    expect(instructions).toContain("run through / walk me through / what's the status / tell me about");
    expect(instructions).toContain("Never reframe a request as a suggestion");
    expect(instructions).toContain("without shortening");
    expect(instructions).toContain("Don't fill silence with guesses");
  }
});

it("caps the launching transcript while keeping the full reply in the voice thread", async () => {
  const { live, send } = setup();
  const { sessionId } = await live.start({ sdp: "x" });
  const reply = "Here is another change. ".repeat(600);
  await live.tool(sessionId, "send_to_cos", JSON.stringify({ intent: "answer", message: "Run through the changes" }), [said("Run through the changes")]);
  await live.idle(COS.threadId, reply);
  const ended = await live.end(sessionId);
  const home = send.mock.calls.find(([input]) => input.threadId === COS.threadId && input.text.startsWith("🎙 Voice session"))![0];
  expect(home.text).not.toContain(reply.trim());
  expect(home.text.match(/← Dot answered: ([^\n]+)/)![1]!.length).toBeLessThanOrEqual(300);
  expect(home.text.length).toBeLessThanOrEqual(4000);
  expect(ended.replies[0]!.text).toBe(reply.trim());
  expect(send.mock.calls.filter(([input]) => input.threadId === "thr_voice").at(-1)![0].text).toContain(reply.trim());
});

describe("a session launched from a canvas thread (the Canvas plugin)", () => {
  const CANVAS_THREAD = "thr_canvas";
  const canvasTool = { type: "function" as const, name: "canvas_add", description: "Add items", parameters: { type: "object", properties: {} } };
  function canvasSetup(model = "gpt-live-1") {
    const runs: { threadId: string; name: string; args: Record<string, unknown> }[] = [];
    const harness = setup({ model }, {
      seed: async (threadId) => ({ kind: "thread", name: "Canvas: Election", threadId, role: null, recent: [] }),
      // The Canvas plugin's RPCs, as Studio's server calls them.
      canvas: {
        tools: async (threadId) => (threadId === CANVAS_THREAD ? { tools: [canvasTool], note: "You are speaking on a canvas." } : { tools: [], note: null }),
        run: async (threadId, name, args) => { if (!name.startsWith("canvas_")) return null; runs.push({ threadId, name, args }); return `Added ${String((args.items as { id: string }[])[0]?.id)}.`; },
      },
    });
    return { ...harness, runs };
  }
  const body = (fetch: ReturnType<typeof setup>["fetch"]) => JSON.parse(String(fetch.mock.calls[0]![1]!.body)) as Record<string, any>;

  it("adds the canvas tools and the board note to the voice and its backend", async () => {
    const { live, fetch } = canvasSetup();
    await live.start({ sdp: "v=0 offer", threadId: CANVAS_THREAD });
    const session = body(fetch).session;
    expect(session.delegation.responses.tools.map((tool: { name: string }) => tool.name)).toEqual([...VOICE_TOOLS, "canvas_add"]);
    expect(session.instructions).toContain("You are speaking on a canvas");
  });

  it("does the same for the Realtime fallback", async () => {
    const { live, fetch } = canvasSetup("gpt-realtime-2.1");
    await live.start({ threadId: CANVAS_THREAD });
    expect(body(fetch).session.tools.map((tool: { name: string }) => tool.name)).toContain("canvas_add");
  });

  it("leaves other sessions' tools and words alone", async () => {
    const { live, fetch } = canvasSetup();
    await live.start({ sdp: "v=0 offer", threadId: "thr_elsewhere" });
    const session = body(fetch).session;
    expect(session.delegation.responses.tools).toEqual(VOICE_TOOL_DEFINITIONS);
    expect(session.instructions).not.toContain("canvas");
  });

  it("runs the voice's canvas calls on the launching canvas, while it talks, and records them", async () => {
    const { live, runs } = canvasSetup();
    const { sessionId } = await live.start({ sdp: "v=0 offer", threadId: CANVAS_THREAD });
    const output = await live.tool(sessionId, "canvas_add", JSON.stringify({ items: [{ id: "pa", kind: "stat", data: 1 }] }), [said("Show me Pennsylvania")]);
    expect(output).toBe("Added pa.");
    expect(runs).toEqual([{ threadId: CANVAS_THREAD, name: "canvas_add", args: { items: [{ id: "pa", kind: "stat", data: 1 }] } }]);
    expect(await live.tool(sessionId, "canvas_add", "not json")).toBe("The arguments weren't valid JSON.");
  });

  it("starts without canvas tools when the Canvas plugin isn't there", async () => {
    const { live, fetch } = setup({}, { seed: async (threadId) => ({ kind: "thread", name: "x", threadId, role: null, recent: [] }), canvas: { tools: async () => { throw new Error("no plugin canvas"); }, run: async () => null } });
    await live.start({ sdp: "v=0 offer", threadId: CANVAS_THREAD });
    expect(body(fetch).session.delegation.responses.tools).toEqual(VOICE_TOOL_DEFINITIONS);
  });

  it("refuses canvas calls from a session that doesn't speak for a canvas", async () => {
    const { live, runs } = canvasSetup();
    const { sessionId } = await live.start({ sdp: "v=0 offer", threadId: "thr_elsewhere" });
    expect(await live.tool(sessionId, "canvas_add", "{}")).toContain("There's no tool named");
    expect(runs).toEqual([]);
  });
});
