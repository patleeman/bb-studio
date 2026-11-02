import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../migrations";
import { LIVE_SESSIONS_URL } from "../live/session";
import { meetingContract } from "./contract";
import { MeetingLive, MeetingRefused, type MeetingDeps } from "./meeting";
import { MEETING_TOOL_DEFINITIONS, meetingInstructions } from "./session";
import { MEETING_TOOLS } from "./shared";

const TABLES = MIGRATIONS.find((statement) => statement.includes("CREATE TABLE voice_calls"))!;
const NOW = new Date(2026, 10, 2, 10, 0, 0).getTime();

function setup(options: { key?: string; spent?: number; settings?: Record<string, unknown>; status?: number } = {}, overrides: Partial<MeetingDeps> = {}) {
  const db = new Database(":memory:");
  db.exec(TABLES);
  let now = NOW;
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(options.status ? { error: { message: "nope" } } : { transport: { type: "webrtc", sdp: "v=0 answer" } }), { status: options.status ?? 201 }));
  let threads = 0;
  const openThread = vi.fn(async (_input: { title: string; text: string; note: string }) => `thr_lookup${++threads}`);
  const claim = vi.fn(async () => true);
  const publish = vi.fn();
  const meeting = new MeetingLive({
    db, fetch: fetch as never, key: () => options.key ?? "sk-test",
    settings: () => ({ voiceLiveMonthlyCapUsd: 20, ...options.settings }),
    monthUsd: () => options.spent ?? 0,
    openThread, claim, publish, now: () => now,
    ...overrides,
  });
  return { db, meeting, fetch, openThread, claim, publish, advance: (ms: number) => { now += ms; } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("MeetingLive", () => {
  it("starts gpt-live-1 with her name, the meeting rules and only the meeting tools", async () => {
    const { meeting, fetch } = setup({ settings: { meetingAgentName: "Nadia", meetingAddressing: "judge" } });
    const started = await meeting.start({ sdp: "v=0 offer" });
    expect(started).toMatchObject({ model: "gpt-live-1", transport: "live-webrtc", answerSdp: "v=0 answer", name: "Nadia", addressing: "judge" });
    expect(started.sessionId).toMatch(/^mt_[a-f0-9]{16}$/);
    expect(meetingContract["meeting.start"].output.parse(started)).toBeTruthy();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(LIVE_SESSIONS_URL);
    const body = JSON.parse(String(init!.body));
    expect(body.transport).toEqual({ type: "webrtc", sdp: "v=0 offer" });
    expect(body.session.instructions).toContain("You are Nadia");
    expect(body.session.instructions).toContain("Stay silent unless you're addressed");
    expect(body.session.instructions).toContain("unmistakable that the room wants you");
    expect(body.session.delegation.responses.tools.map((tool: { name: string }) => tool.name)).toEqual([...MEETING_TOOLS]);
    expect(MEETING_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([...MEETING_TOOLS]);
  });

  it("name mode's instructions don't let her answer without her name", () => {
    const text = meetingInstructions({ name: "Iris", addressing: "name", ownerName: null, date: "Monday" });
    expect(text).toContain("Without your name or a follow-up, stay silent");
    expect(text).not.toContain("unmistakable");
  });

  it("refuses without a key, over the shared cap, or when OpenAI says no", async () => {
    await expect(setup({ key: "" }).meeting.start({ sdp: "x" })).rejects.toBeInstanceOf(MeetingRefused);
    await expect(setup({ spent: 25 }).meeting.start({ sdp: "x" })).rejects.toThrow(/cap/);
    await expect(setup({ status: 400 }).meeting.start({ sdp: "x" })).rejects.toThrow(/nope/);
    expect(setup({ spent: 25 }).meeting.state()).toMatchObject({ ready: false, name: "Iris", addressing: "name" });
  });

  it("a lookup opens its own back-office thread; its answer is kept, published, picked up once and shown", async () => {
    const { meeting, openThread, claim, publish } = setup();
    const { sessionId } = await meeting.start({ sdp: "x" });
    const output = await meeting.tool(sessionId, "look_up", JSON.stringify({ question: "What's checkout's p99 this week?" }), [{ type: "transcript", role: "user", text: "Iris, what's checkout's p99 this week?", at: 1 }]);
    expect(output).toMatch(/^Looking it up/);
    expect(openThread).toHaveBeenCalledWith(expect.objectContaining({ title: "🔎 What's checkout's p99 this week?", text: expect.stringContaining("The room asked Iris") }));
    expect(openThread.mock.calls[0]![0].note).toContain("Read only");
    await flush();
    expect(claim).toHaveBeenCalledWith("thr_lookup1");
    expect(meeting.view(sessionId).lookups).toEqual([expect.objectContaining({ question: "What's checkout's p99 this week?", status: "running", threadId: "thr_lookup1" })]);

    expect(meeting.idle("thr_other", "unrelated")).toEqual([]);
    expect(meeting.idle("thr_lookup1", "[PASS]")).toEqual([]);
    expect(meeting.idle("thr_lookup1", "**p99 is 412 ms**, up from 380 ms last week.")).toEqual([sessionId]);
    // Only the first answer counts.
    expect(meeting.idle("thr_lookup1", "later")).toEqual([]);
    expect(publish).toHaveBeenCalledWith({ sessionId, kind: "reply" });
    expect(meeting.record(sessionId, []).replies).toBe(1);
    const { replies } = meeting.poll(sessionId);
    expect(replies).toEqual([expect.objectContaining({ title: "What's checkout's p99 this week?", summary: "p99 is 412 ms, up from 380 ms last week." })]);
    expect(replies[0]!.note).toContain("came back: p99 is 412 ms");
    expect(meeting.poll(sessionId).replies).toEqual([]);
    expect(meeting.view(sessionId).lookups[0]).toMatchObject({ status: "answered", answer: "p99 is 412 ms, up from 380 ms last week." });
    expect(await meeting.tool(sessionId, "read_lookups", "")).toContain("p99 is 412 ms");
  });

  it("notes go on the stage by kind; unknown tools and bad arguments are refused", async () => {
    const { meeting } = setup();
    const { sessionId } = await meeting.start({ sdp: "x" });
    expect(await meeting.tool(sessionId, "take_note", JSON.stringify({ text: "Ship on Tuesday", kind: "decision" }))).toMatch(/^Noted as a decision/);
    expect(await meeting.tool(sessionId, "take_note", JSON.stringify({ text: "Update the runbook", kind: "action", owner: "Sam" }))).toMatch(/action item/);
    expect(await meeting.tool(sessionId, "take_note", JSON.stringify({ text: "Odd", kind: "whatever" }))).toMatch(/^Noted as a note/);
    expect(meeting.view(sessionId).notes.map(({ kind, text, owner }) => ({ kind, text, owner }))).toEqual([
      { kind: "decision", text: "Ship on Tuesday", owner: null },
      { kind: "action", text: "Update the runbook", owner: "Sam" },
      { kind: "note", text: "Odd", owner: null },
    ]);
    expect(await meeting.tool(sessionId, "send_to_thread", "{}")).toMatch(/no tool named/);
    expect(await meeting.tool(sessionId, "take_note", "nope")).toBe("The arguments weren't valid JSON.");
    expect(await meeting.tool(sessionId, "look_up", "{}")).toMatch(/empty/);
  });

  it("records transcript and usage, prices it, and ends once", async () => {
    const { meeting, publish, advance } = setup();
    const { sessionId } = await meeting.start({ sdp: "x" });
    const result = meeting.record(sessionId, [{ type: "transcript", role: "user", text: "Iris, hi", at: 1 }, { type: "live_usage", seconds: 120 }]);
    expect(result.costUsd).toBeCloseTo(0.1, 5);
    advance(120_000);
    const view = meeting.end(sessionId, [{ type: "transcript", role: "assistant", text: "Hi.", at: 2 }]);
    expect(view.transcript.map((line) => line.text)).toEqual(["Iris, hi", "Hi."]);
    expect(view.endedAt).toBe(NOW + 120_000);
    expect(publish).toHaveBeenCalledWith({ sessionId, kind: "ended" });
    expect(() => meeting.record(sessionId, [])).toThrow(/ended/);
    expect(meeting.end(sessionId).endedAt).toBe(view.endedAt);
    expect(meetingContract["meeting.end"].output.parse(view)).toBeTruthy();
  });
});
