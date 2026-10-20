import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { callLine, callMarkdown, CallRefused, replySummary, VoiceCalls, type CallBot, type VoiceCallDeps } from "./calls";
import { voiceCallContract } from "./contract";
import { CALL_TOOL_DEFINITIONS, CLIENT_SECRETS_URL } from "./session";
import { REALTIME_CALLS_URL } from "./shared";
import { VOICE_CALL_TABLES } from "./store";

const KEY = "sk-test-secret-key";
const BOT: CallBot = { id: "bot_main", name: "Dot", threadId: "thr_bot", state: "active" };
const NOW = new Date(2026, 9, 20, 10, 0, 0).getTime();

function setup(overrides: Partial<VoiceCallDeps> = {}, options: { key?: string; cap?: number; minted?: object; status?: number } = {}) {
  const db = new Database(":memory:");
  db.exec(VOICE_CALL_TABLES);
  let now = NOW;
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(options.minted ?? { value: "ek_client_secret", expires_at: NOW / 1000 + 120, session: { model: "gpt-realtime-2.1" } }), { status: options.status ?? 200 }));
  const send = vi.fn(async (_input: { threadId: string; text: string; note: string; mode: string }) => {});
  const push = vi.fn(async (_input: { title: string; body: string; threadId: string; coalesceKey: string }) => {});
  const publish = vi.fn();
  const read = { botStatus: vi.fn(async () => "Dot is active."), leadsStatus: vi.fn(async () => "No project has a lead."), dailyBrief: vi.fn(async () => "Kensico Brief: not found.") };
  const savePage = vi.fn((_input: { title: string; markdown: string }) => "pg_call");
  const calls = new VoiceCalls({
    db,
    fetch: fetch as never,
    key: () => options.key ?? KEY,
    settings: () => ({ voiceCallMonthlyCapUsd: options.cap ?? 20, voiceCallModel: "gpt-realtime-2.1", voiceCallVoice: "marin" }),
    bot: (botId) => (!botId || botId === BOT.id ? BOT : null),
    botForThread: (threadId) => (threadId === BOT.threadId ? BOT : null),
    read, send, push, publish, savePage,
    pageHref: (pageId) => `/plugins/studio/studio/pages/${pageId}`,
    now: () => now,
    ...overrides,
  });
  return { db, calls, fetch, send, push, publish, read, savePage, advance: (ms: number) => { now += ms; } };
}

/** Usage that costs about $1 on gpt-realtime-2.1: 15,625 audio output tokens at $64/M. */
const DOLLAR = { output_token_details: { audio_tokens: 15_625 } };

describe("voice_call_start", () => {
  it("mints a client secret with the call's session and never returns the key", async () => {
    const { calls, fetch } = setup();
    const started = await calls.start();
    expect(voiceCallContract.voice_call_start.output.parse(started)).toEqual(started);
    expect(started).toMatchObject({ clientSecret: "ek_client_secret", model: "gpt-realtime-2.1", voice: "marin", callsUrl: REALTIME_CALLS_URL, botName: "Dot", expiresAt: NOW + 120_000 });
    expect(started.callId).toMatch(/^vc_[a-f0-9]{16}$/);
    expect(JSON.stringify(started)).not.toContain(KEY);
    expect(JSON.stringify(calls.view(started.callId))).not.toContain(KEY);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(CLIENT_SECRETS_URL);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init?.body));
    expect(body.session).toMatchObject({
      type: "realtime", model: "gpt-realtime-2.1",
      audio: { input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "server_vad" } }, output: { voice: "marin" } },
    });
    expect(body.session.tools.map((tool: { name: string }) => tool.name)).toEqual(["bot_status", "leads_status", "daily_brief", "send_to_bot"]);
    expect(body.session.instructions).toContain("front end for Dot");
    expect(body.session.instructions).toMatch(/Never approve or agree to spending money/);
    expect(body.session.instructions).toContain("send_to_bot");
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it("refuses without a key, before calling OpenAI", async () => {
    const { calls, fetch } = setup({}, { key: "" });
    await expect(calls.start()).rejects.toThrow(/need an OpenAI API key/);
    expect(fetch).not.toHaveBeenCalled();
    expect(calls.state({ threadId: "thr_bot" })).toMatchObject({ botId: "bot_main", ready: false, problem: expect.stringMatching(/OpenAI API key/) });
  });

  it("passes on OpenAI's error without the key", async () => {
    const { calls } = setup({}, { status: 401, minted: { error: { message: "Incorrect API key provided" } } });
    const error = await calls.start().catch((caught: Error) => caught);
    expect(String(error)).toMatch(/OpenAI couldn't start the call \(401\): Incorrect API key provided/);
    expect(String(error)).not.toContain(KEY);
  });

  it("refuses at the monthly cap with a clear message, and counts only this month", async () => {
    const { calls, fetch, advance } = setup({}, { cap: 2 });
    const first = await calls.start();
    calls.record(first.callId, [{ type: "usage", usage: DOLLAR }, { type: "usage", usage: DOLLAR }]);
    expect(calls.monthUsd()).toBeCloseTo(2, 6);
    await expect(calls.start()).rejects.toThrow(CallRefused);
    await expect(calls.start()).rejects.toThrow(/This month's voice calls have reached the \$2\.00 cap \(about \$2\.00 so far\)\. Raise "Voice calls: monthly cap" in Studio's settings, or call again from November 1\./);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(calls.state({ threadId: "thr_bot" })).toMatchObject({ ready: false, monthUsd: 2, capUsd: 2 });
    // A new month starts from nothing.
    advance(15 * 86_400_000);
    expect(calls.monthUsd()).toBe(0);
    await expect(calls.start()).resolves.toMatchObject({ clientSecret: "ek_client_secret" });
  });

  it("shows no call button on other threads", () => {
    const { calls } = setup();
    expect(calls.state({ threadId: "thr_other" })).toMatchObject({ botId: null, ready: false, problem: null });
    expect(calls.state({ threadId: "thr_bot" })).toMatchObject({ botId: "bot_main", botName: "Dot", ready: true, capUsd: 20, model: "gpt-realtime-2.1" });
  });
});

describe("voice_call_tool", () => {
  it("runs the read tools without writing anything", async () => {
    const { calls, send, read, db } = setup();
    const { callId } = await calls.start();
    const before = db.prepare("SELECT COUNT(*) AS n FROM voice_call_events").get();
    expect(await calls.tool(callId, "bot_status", "{}")).toBe("Dot is active.");
    expect(await calls.tool(callId, "leads_status", "")).toBe("No project has a lead.");
    expect(await calls.tool(callId, "daily_brief", undefined)).toBe("Kensico Brief: not found.");
    expect(read.botStatus).toHaveBeenCalledWith(BOT);
    expect(send).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS n FROM voice_call_events").get()).toEqual(before);
  });

  it("send_to_bot is the only write: a visible message in the Bot's chat, marked as from the call", async () => {
    const { calls, send } = setup();
    const { callId } = await calls.start();
    expect(await calls.tool(callId, "send_to_bot", JSON.stringify({ message: "Book a table for two at 7" }))).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ threadId: "thr_bot", mode: "auto", text: "📞 From the call: Book a table for two at 7" });
    expect(send.mock.calls[0]![0].note).toMatch(/Don't spend money, send anything outward-facing or delete anything on the call's word/);
    expect(calls.view(callId).sent).toEqual([{ message: "Book a table for two at 7", at: NOW }]);
    // Only the four tools are offered, and only send_to_bot takes input.
    expect(CALL_TOOL_DEFINITIONS.filter((tool) => Object.keys((tool.parameters.properties ?? {}) as object).length).map((tool) => tool.name)).toEqual(["send_to_bot"]);
  });

  it("validates arguments and caps output", async () => {
    const { calls, send, read } = setup();
    const { callId } = await calls.start();
    expect(await calls.tool(callId, "delete_everything", "{}")).toMatch(/^There's no tool named "delete_everything"/);
    expect(await calls.tool(callId, "send_to_bot", "{nope")).toBe("The arguments weren't valid JSON.");
    expect(await calls.tool(callId, "send_to_bot", "[1]")).toBe("The arguments must be a JSON object.");
    expect(await calls.tool(callId, "send_to_bot", JSON.stringify({ message: "  " }))).toBe("send_to_bot needs a message.");
    expect(await calls.tool(callId, "send_to_bot", JSON.stringify({ message: "x".repeat(4001) }))).toMatch(/the most is 4000/);
    expect(send).not.toHaveBeenCalled();
    read.botStatus.mockResolvedValueOnce("y".repeat(10_000));
    expect((await calls.tool(callId, "bot_status", "{}")).length).toBe(4000);
    read.leadsStatus.mockRejectedValueOnce(new Error("BB is down"));
    expect(await calls.tool(callId, "leads_status", "{}")).toBe("That didn't work: BB is down");
  });

  it("refuses tools on an ended call", async () => {
    const { calls } = setup();
    const { callId } = await calls.start();
    await calls.end(callId);
    await expect(calls.tool(callId, "bot_status", "{}")).rejects.toThrow(/ended/);
    await expect(calls.tool("vc_0000000000000000", "bot_status", "{}")).rejects.toThrow(/no such call/);
  });
});

describe("the Bot's replies", () => {
  it("relays the reply to the turn send_to_bot started into the live call", async () => {
    const { calls, publish, push } = setup();
    const { callId } = await calls.start();
    // Nothing sent yet: an idle Bot isn't the call's business.
    expect(await calls.idle("thr_bot", "Morning check-in done.")).toEqual([]);
    await calls.tool(callId, "send_to_bot", JSON.stringify({ message: "What's on my calendar?" }));
    // [PASS] isn't an answer.
    expect(await calls.idle("thr_bot", "[PASS]")).toEqual([]);
    expect(await calls.idle("thr_other", "Unrelated")).toEqual([]);
    expect(await calls.idle("thr_bot", "## Today\n\n- **10:00** standup\n- Lunch with [Sam](https://example.com)")).toEqual([callId]);
    expect(publish).toHaveBeenCalledWith({ callId, kind: "reply" });
    expect(push).not.toHaveBeenCalled();
    expect(calls.record(callId, []).replies).toBe(1);
    const { replies } = calls.poll(callId);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.summary).toBe("Today 10:00 standup Lunch with Sam");
    expect(replies[0]!.note).toMatch(/^\(Studio, not the user:\) Dot replied to what you sent: Today 10:00 standup/);
    // Picked up once.
    expect(calls.poll(callId).replies).toEqual([]);
    // Answered: the next idle isn't for the call.
    expect(await calls.idle("thr_bot", "Something else")).toEqual([]);
  });

  it("after hang-up, the reply goes to the phone and stays in the chat", async () => {
    const { calls, publish, push } = setup();
    const { callId } = await calls.start();
    await calls.tool(callId, "send_to_bot", JSON.stringify({ message: "Draft the weekly update" }));
    calls.record(callId, [{ type: "transcript", role: "user", text: "Draft the weekly update", at: NOW }]);
    await calls.end(callId);
    publish.mockClear();
    expect(await calls.idle("thr_bot", "Drafted it: three sections, ready for you.")).toEqual([callId]);
    expect(publish).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith({ title: "Dot replied", body: "Drafted it: three sections, ready for you.", threadId: "thr_bot", coalesceKey: `voice-call:${callId}` });
    expect(calls.view(callId).replies).toEqual([{ text: "Drafted it: three sections, ready for you.", at: NOW }]);
  });

  it("cuts a long reply down for the voice", () => {
    expect(replySummary("word ".repeat(400)).length).toBe(600);
  });
});

describe("the call's record", () => {
  it("saves the transcript, what it sent, minutes and cost, and links it in the Bot's chat", async () => {
    const { calls, send, savePage, advance, publish } = setup();
    const { callId } = await calls.start();
    advance(30_000);
    calls.record(callId, [
      { type: "transcript", role: "user", text: "Hey, anything need me?", at: NOW + 30_000 },
      { type: "transcript", role: "assistant", text: "Two things need you.", at: NOW + 33_000 },
      { type: "usage", usage: DOLLAR },
    ]);
    await calls.tool(callId, "send_to_bot", JSON.stringify({ message: "Summarize the launch thread" }));
    advance(330_000);
    const view = await calls.end(callId, [{ type: "transcript", role: "user", text: "Thanks, bye", at: NOW + 359_000 }]);
    expect(voiceCallContract.voice_call_end.output.parse(view)).toEqual(view);
    expect(view).toMatchObject({ botName: "Dot", durationMs: 360_000, pageId: "pg_call", endedAt: NOW + 360_000 });
    expect(view.costUsd).toBeCloseTo(1, 6);
    expect(view.transcript.map((line) => line.role)).toEqual(["user", "assistant", "user"]);

    const page = savePage.mock.calls[0]![0];
    expect(page.title).toBe("Call with Dot · Oct 20, 10:00 AM · 6 min");
    expect(page.markdown).toContain("6 min · about $1.00 · gpt-realtime-2.1 · voice marin");
    expect(page.markdown).toContain("## Sent to Dot\n\n- 10:00 AM: Summarize the launch thread");
    expect(page.markdown).toContain("**You** (10:00 AM): Hey, anything need me?");
    expect(page.markdown).toContain("**Voice** (10:00 AM): Two things need you.");
    expect(page.markdown).toContain("→ **Sent to Dot** (10:00 AM): Summarize the launch thread");

    const line = send.mock.calls.at(-1)![0];
    expect(line).toMatchObject({ threadId: "thr_bot", mode: "queue-if-active", text: "📞 **Call · 6 min** · ≈$1.00 · sent you 1 message · [Transcript](/plugins/studio/studio/pages/pg_call)" });
    expect(line.note).toMatch(/reply exactly \[PASS\]/);
    expect(publish).toHaveBeenCalledWith({ callId, kind: "ended" });
    // Hanging up again returns the record and posts nothing more.
    const sends = send.mock.calls.length;
    expect(await calls.end(callId)).toEqual(view);
    expect(send.mock.calls.length).toBe(sends);
    await expect(Promise.resolve().then(() => calls.record(callId, []))).rejects.toThrow(/ended/);
  });

  it("leaves no record in the chat for a call that never got going", async () => {
    const { calls, send, savePage } = setup();
    const { callId } = await calls.start();
    const view = await calls.end(callId);
    expect(view.pageId).toBeNull();
    expect(view.endedAt).toBe(NOW);
    expect(savePage).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("formats the chat line without a cost or page when there's none", () => {
    const base = { id: "vc_x", botId: "b", botName: "Dot", model: "m", voice: "v", startedAt: NOW, endedAt: NOW + 45_000, durationMs: 45_000, costUsd: null, transcript: [], sent: [], replies: [], pageId: null };
    expect(callLine(base, null)).toBe("📞 **Call · 45 s**");
    expect(callMarkdown(base)).toContain("cost unknown");
    expect(callMarkdown(base)).toContain("Nothing was said.");
  });
});
