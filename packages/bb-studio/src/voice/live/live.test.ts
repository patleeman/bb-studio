import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../migrations";
import { voiceLiveContract } from "./contract";
import { VoiceLive, VoiceRefused, type LoopBefore, type VoiceAutomation, type VoiceLiveDeps, type VoiceLoop, type VoiceTarget } from "./live";
import { CLIENT_SECRETS_URL, LIVE_SESSIONS_URL, VOICE_TOOL_DEFINITIONS } from "./session";
import { REALTIME_CALLS_URL, VOICE_TOOLS } from "./shared";
import { DRAFT_MS, UNDO_MS } from "./rules";

const KEY = "sk-test-secret-key";
const NOW = new Date(2026, 10, 1, 9, 0, 0).getTime();
const COS = { name: "Dot", threadId: "thr_cos" };
const KENSICO: VoiceTarget = { threadId: "thr_kensico", title: "the Kensico lead" };

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
  const automationList: VoiceAutomation[] = [{ id: "auto_1", name: "Morning brief", state: "active" }, { id: "auto_2", name: "Kensico heartbeat", state: "active" }];
  const automations = { list: vi.fn(async () => automationList), pause: vi.fn(async (_id: string) => {}), remove: vi.fn(async (_id: string) => {}) };
  const resolve = vi.fn(async (name: string): Promise<VoiceTarget[]> => {
    if (/kensico/i.test(name)) return [KENSICO];
    if (/launch/i.test(name)) return [{ threadId: "thr_a", title: "Launch review" }, { threadId: "thr_b", title: "Launch checklist" }];
    return [];
  });
  const live = new VoiceLive({
    db, fetch: fetch as never,
    key: () => options.key ?? KEY,
    settings: () => ({ voiceLiveMonthlyCapUsd: options.cap ?? 20, voiceLiveModel: options.model ?? "gpt-live-1" }),
    cos: () => COS,
    resolve,
    latestReply: async (threadId) => (threadId === KENSICO.threadId ? { title: "the Kensico lead", text: "**Paused** the eBay fetcher until Monday." } : null),
    loops: { groups: () => ({ needsYouNow: [loops.loop_1!], comingUp: [loops.loop_2!] }), get: (id) => { if (!loops[id]) throw new Error("No such loop."); return loops[id]!; }, act, add, restore },
    threads, automations, claim,
    openThread, send, push, publish,
    mockUrl: () => options.mock ?? null,
    now: () => now,
    ...overrides,
  });
  return { db, live, fetch, send, push, publish, openThread, claim, act, add, restore, threads, automations, loops, resolve, advance: (ms: number) => { now += ms; } };
}

const said = (text: string) => ({ type: "transcript" as const, role: "user" as const, text });
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
    const loops = await live.tool(sessionId, "loops_list", "{}");
    expect(loops).toContain("Needs you now (1)");
    expect(loops).toContain("Reply to Dana (id loop_1, urgent)");
    expect(loops).toContain("Coming up (1)");
    expect(await live.tool(sessionId, "read_replies", JSON.stringify({ target: "the Kensico lead" }))).toContain("Paused the eBay fetcher until Monday.");
    expect(await live.tool(sessionId, "read_replies", "")).toMatch(/Nothing was sent this session/);
    expect(send).not.toHaveBeenCalled();
    expect(act).not.toHaveBeenCalled();
    expect(eventCount(db)).toBe(before);
  });

  it("a relay goes at once, with no read-back, visibly from the voice thread", async () => {
    const { live, send } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    const output = await live.tool(sessionId, "send_to_thread", JSON.stringify({ target: "the Kensico lead", message: "Pause the eBay fetcher until Monday." }));
    expect(output).toBe(`Sent to the Kensico lead. Say just that ("Sent to the Kensico lead."); its answer will come back here.`);
    const relay = send.mock.calls.find(([input]) => input.threadId === KENSICO.threadId)![0];
    expect(relay).toMatchObject({ senderThreadId: "thr_voice", mode: "auto", text: "🎙 From voice: Pause the eBay fetcher until Monday" });
    expect(relay.note).toMatch(/sent at once, without a read-back/);
    expect(relay.note).toMatch(/don't spend money, email or message people outside BB, post publicly or approve credentials/);
    expect(send.mock.calls.find(([input]) => input.threadId === "thr_voice")![0].text).toBe("→ **Sent to the Kensico lead:** Pause the eBay fetcher until Monday");
    // To the CoS too, at once.
    expect(await live.tool(sessionId, "send_to_cos", JSON.stringify({ message: "Book the car service" }))).toMatch(/^Sent to Dot\./);
    expect(send.mock.calls.filter(([input]) => input.threadId === COS.threadId)).toHaveLength(1);
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
      expect(await live.tool(sessionId, "loops_act", JSON.stringify({ loop_id: "loop_1", action }))).toMatch(/Voice can mark a loop done, snooze it, hand it off or drop it/);
    }
    expect(act).not.toHaveBeenCalled();

    const done = await live.tool(sessionId, "loops_act", JSON.stringify({ loop_id: "loop_1", action: "done" }));
    expect(done).toMatch(/^Marked "Reply to Dana" done\. .*"undo" in the next 10 seconds \(action a_[a-f0-9]+\)/);
    expect(loops.loop_1!.status).toBe("done");
    expect(await live.tool(sessionId, "undo", JSON.stringify({ action_id: actionId(done) }))).toBe(`Undone: "Reply to Dana" is back as it was.`);
    expect(restore).toHaveBeenCalledWith("loop_1", { status: "surfaced", trigger: { type: "none" }, owner: "patrick" });
    expect(await live.tool(sessionId, "undo", "{}")).toBe("That was already undone.");

    const handed = await live.tool(sessionId, "loops_act", JSON.stringify({ loop_id: "loop_1", action: "hand_off", to: "the Kensico lead" }));
    expect(handed).toMatch(/^Handed "Reply to Dana" to the Kensico lead\./);
    expect(act).toHaveBeenLastCalledWith("loop_1", "hand_off", { snooze: undefined, owner: "thread:thr_kensico" });
    await live.tool(sessionId, "undo", "{}");
    expect(loops.loop_1!.owner).toBe("patrick");

    const added = await live.tool(sessionId, "loops_add", JSON.stringify({ text: "Call the plumber back" }));
    expect(added).toMatch(/^Added "Call the plumber back"; Dot will fill it in\./);
    expect(add).toHaveBeenCalledWith("Call the plumber back");
    expect(await live.tool(sessionId, "undo", "{}")).toBe(`Undone: "Call the plumber back" is gone.`);
    expect(loops.loop_new!.status).toBe("dropped");

    expect(await live.tool(sessionId, "loops_act", JSON.stringify({ loop_id: "loop_2", action: "snooze", snooze: "tonight" }))).toMatch(/^Snoozed "Renew the domain" to tonight/);
    advance(UNDO_MS + 1);
    expect(await live.tool(sessionId, "undo", "{}")).toMatch(/undo window for "Renew the domain" has closed/);
    expect(loops.loop_2!.status).toBe("snoozed");
  });

  it("destructive: dropping a loop waits for the user's own spoken yes", async () => {
    const { live, act, loops } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    const asked = await live.tool(sessionId, "loops_act", JSON.stringify({ loop_id: "loop_ts", action: "drop" }));
    expect(prompt(asked)).toBe(`Drop the loop 'Remove the stale Tailscale node'? Say yes to drop.`);
    expect(act).not.toHaveBeenCalled();
    const id = actionId(asked);
    // The model can't confirm on its own; filler, unclear talk and the voice's own echo aren't a yes.
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }))).toMatch(/hasn't heard the user answer/);
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [said("Thank you for watching")])).toMatch(/hasn't heard/);
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [said("Drop the loop Remove the stale Tailscale node? Say yes to drop.")])).toMatch(/didn't hear a clear yes/);
    expect(act).not.toHaveBeenCalled();
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [said("Yes, drop it")])).toBe(`Dropped the loop 'Remove the stale Tailscale node'. Say that briefly; it can't be undone by voice.`);
    expect(act).toHaveBeenCalledWith("loop_ts", "drop");
    expect(loops.loop_ts!.status).toBe("dropped");
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [said("yes")])).toBe("That was already done.");
  });

  it("destructive: a yes before the question doesn't count, a no cancels, and it times out", async () => {
    const { live, threads, advance } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    live.record(sessionId, [said("yes")]);
    const id = actionId(await live.tool(sessionId, "stop_thread", JSON.stringify({ target: "the Kensico lead" })));
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }))).toMatch(/hasn't heard/);
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [said("No, wait, leave it running")])).toMatch(/nothing was done/);
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: id }), [said("yes")])).toMatch(/was cancelled/);
    const late = actionId(await live.tool(sessionId, "archive_thread", JSON.stringify({ target: "the Kensico lead" })));
    advance(DRAFT_MS + 1);
    expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: late }), [said("yes")])).toMatch(/timed out/);
    expect(threads.stop).not.toHaveBeenCalled();
    expect(threads.archive).not.toHaveBeenCalled();
  });

  it("destructive: stop or archive a thread, pause or delete an automation, each after a yes", async () => {
    const { live, threads, automations } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    const cases: [string, Record<string, string>, string, string][] = [
      ["stop_thread", { target: "the Kensico lead" }, `Stop the thread 'the Kensico lead'? Say yes to stop.`, `Stopped 'the Kensico lead'.`],
      ["archive_thread", { target: "the Kensico lead" }, `Archive the thread 'the Kensico lead'? Say yes to archive.`, `Archived 'the Kensico lead'.`],
      ["pause_automation", { name: "the morning brief" }, `Pause the automation 'Morning brief'? Say yes to pause.`, `Paused the automation 'Morning brief'.`],
      ["delete_automation", { name: "Kensico heartbeat" }, `Delete the automation 'Kensico heartbeat'? It can't be undone. Say yes to delete.`, `Deleted the automation 'Kensico heartbeat'.`],
    ];
    for (const [tool, args, question, done] of cases) {
      const asked = await live.tool(sessionId, tool, JSON.stringify(args));
      expect(prompt(asked)).toBe(question);
      expect(await live.tool(sessionId, "confirm", JSON.stringify({ action_id: actionId(asked) }), [said("Yes, stop it")])).toBe(`${done} Say that briefly; it can't be undone by voice.`);
    }
    expect(threads.stop).toHaveBeenCalledWith(KENSICO.threadId);
    expect(threads.archive).toHaveBeenCalledWith(KENSICO.threadId);
    expect(automations.pause).toHaveBeenCalledWith("auto_1");
    expect(automations.remove).toHaveBeenCalledWith("auto_2");
    expect(await live.tool(sessionId, "pause_automation", JSON.stringify({ name: "nightly backup" }))).toMatch(/No automation called "nightly backup"\. There's Morning brief, Kensico heartbeat\./);
    // Cancel.
    const asked = await live.tool(sessionId, "stop_thread", JSON.stringify({ target: "the Kensico lead" }));
    expect(await live.tool(sessionId, "cancel", JSON.stringify({ action_id: actionId(asked) }))).toBe("Cancelled; nothing was done.");
    expect(threads.stop).toHaveBeenCalledTimes(1);
  });
});

describe("replies, interruptions and hang-up", () => {
  it("a target's reply comes back to the live session; after hang-up to the phone and the voice thread", async () => {
    const { live, publish, push, send } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    // Not sent to: ignored.
    expect(await live.idle(KENSICO.threadId, "Done.")).toEqual([]);
    await live.tool(sessionId, "send_to_thread", JSON.stringify({ target: "Kensico lead", message: "Pause the eBay fetcher" }), [said("Tell the Kensico lead to pause the eBay fetcher")]);
    expect(await live.idle(KENSICO.threadId, "[PASS]")).toEqual([]);
    expect(await live.idle(KENSICO.threadId, "**Paused.** It resumes Monday at 9.")).toEqual([sessionId]);
    expect(publish).toHaveBeenCalledWith({ sessionId, kind: "reply" });
    // During the session a reply goes in the end transcript, not its own post.
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("answered") }));
    const polled = live.poll(sessionId);
    expect(polled.replies).toEqual([expect.objectContaining({ title: "the Kensico lead", summary: "Paused. It resumes Monday at 9." })]);
    expect(polled.replies[0]!.note).toMatch(/^\(Studio, not the user:\) the Kensico lead answered/);
    expect(live.poll(sessionId).replies).toEqual([]);
    expect(await live.idle(KENSICO.threadId, "Something else")).toEqual([]);

    const ended = await live.end(sessionId, [{ type: "interrupted", heard: "The fetcher is" }, { type: "transcript", role: "assistant", text: "Bye." }]);
    expect(ended.endedAt).not.toBeNull();
    expect(ended.sent).toEqual([expect.objectContaining({ title: "the Kensico lead", message: "Pause the eBay fetcher" })]);
    const last = send.mock.calls.at(-1)![0];
    expect(last.threadId).toBe("thr_voice");
    expect(last.text).toMatch(/^🎙 \*\*Voice session · \d+ s\*\* · ≈\$0\.00 · sent 1 message/);
    expect(last.text).toContain("**You:** Tell the Kensico lead to pause the eBay fetcher");
    expect(last.text).toContain("→ **Sent to the Kensico lead:** Pause the eBay fetcher");
    expect(last.text).toContain("← **the Kensico lead answered:** Paused. It resumes Monday at 9.");
    expect(last.text.indexOf("_(interrupted)_")).toBeLessThan(last.text.indexOf("**Voice:** Bye."));
    await expect(live.tool(sessionId, "loops_list", "{}")).rejects.toThrow(/has ended/);
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

describe("the voice thread", () => {
  it("gets each relay as it happens and the whole transcript once, at hang-up: no posting turns in between", async () => {
    const { live, send } = setup();
    const { sessionId } = await live.start({ sdp: "x" });
    const posts = () => send.mock.calls.filter(([input]) => input.threadId === "thr_voice").map(([input]) => input.text);
    // Talk, reads, loop actions, a destructive one, usage and a reply: nothing posted.
    live.record(sessionId, [said("What's waiting?"), { type: "transcript", role: "assistant", text: "Two things." }, { type: "live_usage", seconds: 30 }]);
    await live.tool(sessionId, "loops_list", "{}");
    await live.tool(sessionId, "loops_act", JSON.stringify({ loop_id: "loop_1", action: "done" }));
    const asked = await live.tool(sessionId, "loops_act", JSON.stringify({ loop_id: "loop_ts", action: "drop" }));
    await live.tool(sessionId, "confirm", JSON.stringify({ action_id: actionId(asked) }), [said("yes")]);
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
      "✓ **Loop done:** Reply to Dana",
      "**You:** yes",
      `⚠️ **Done after a spoken yes:** Dropped the loop 'Remove the stale Tailscale node'.`,
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
    await live.tool(sessionId, "send_to_thread", JSON.stringify({ target: "the Kensico lead", message: "Pause the eBay fetcher until Monday" }), [said("Tell the Kensico lead to pause the eBay fetcher")]);
    live.record(sessionId, [{ type: "transcript", role: "assistant", text: "Sent to the Kensico lead." }]);
    const hits = live.search("eBay fetcher");
    expect(hits).toEqual([{ threadId: "thr_voice", title: expect.stringMatching(/^🎙 Voice · /), text: "Tell the Kensico lead to pause the eBay fetcher", at: expect.any(Number) }]);
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
