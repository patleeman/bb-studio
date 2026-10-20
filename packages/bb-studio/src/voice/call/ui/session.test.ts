import { describe, expect, it, vi } from "vitest";
import { CallSession, SERVER_VAD, type CallServer } from "./session";
import type { RealtimeTransport, ServerEvent } from "./transport";

/** A transport that records what the session sends and lets the test play server events. */
function fakeTransport() {
  const sent: Record<string, unknown>[] = [];
  let listener: (event: ServerEvent) => void = () => {};
  let closer: (reason: string) => void = () => {};
  const mic: boolean[] = [];
  const transport: RealtimeTransport & { emit(event: ServerEvent): void; drop(reason: string): void } = {
    send: (event) => { sent.push(event); },
    onEvent: (next) => { listener = next; },
    onClose: (next) => { closer = next; },
    setMic: (on) => { mic.push(on); },
    levels: () => ({ mic: 0, voice: 0 }),
    close: vi.fn(),
    emit: (event) => listener(event),
    drop: (reason) => closer(reason),
  };
  return { transport, sent, mic, types: () => sent.map((event) => event.type) };
}

function fakeServer(overrides: Partial<CallServer> = {}) {
  return {
    tool: vi.fn(async (name: string) => (name === "send_to_bot" ? "sent" : `${name} says hi`)),
    report: vi.fn(async () => ({ costUsd: 0.12, replies: 0 })),
    poll: vi.fn(async () => ({ replies: [] as { id: number; summary: string; note: string }[] })),
    end: vi.fn(async () => ({ id: "vc_x", costUsd: 0.2 }) as never),
    ...overrides,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("CallSession", () => {
  it("cancels the response when the user starts talking over it (barge-in)", () => {
    const { transport, types } = fakeTransport();
    const session = new CallSession(transport, fakeServer(), { timers: false });
    transport.emit({ type: "input_audio_buffer.speech_started" });
    expect(types()).toEqual([]);
    transport.emit({ type: "response.created" });
    transport.emit({ type: "input_audio_buffer.speech_started" });
    expect(types()).toEqual(["response.cancel"]);
    expect(session.state.userSpeaking).toBe(true);
    // Cancelling when nothing plays isn't shown as an error.
    transport.emit({ type: "error", error: { code: "response_cancel_not_active", message: "no" } });
    expect(session.state.error).toBeNull();
  });

  it("runs function calls on the server and answers them once the response is done", async () => {
    const { transport, sent } = fakeTransport();
    const server = fakeServer();
    const session = new CallSession(transport, server, { timers: false });
    transport.emit({ type: "response.created" });
    transport.emit({ type: "response.function_call_arguments.done", call_id: "call_1", name: "bot_status", arguments: "{}" });
    transport.emit({ type: "response.function_call_arguments.done", call_id: "call_2", name: "send_to_bot", arguments: "{\"message\":\"Do it\"}" });
    expect(server.tool).toHaveBeenCalledWith("bot_status", "{}");
    expect(server.tool).toHaveBeenCalledWith("send_to_bot", "{\"message\":\"Do it\"}");
    expect(sent).toEqual([]);
    transport.emit({ type: "response.done", response: { status: "completed" } });
    await settle();
    expect(sent).toEqual([
      { type: "conversation.item.create", item: { type: "function_call_output", call_id: "call_1", output: "bot_status says hi" } },
      { type: "conversation.item.create", item: { type: "function_call_output", call_id: "call_2", output: "sent" } },
      { type: "response.create" },
    ]);
    expect(session.state.waiting).toBe(1);
  });

  it("reports transcripts and usage, and shows the running cost", async () => {
    const { transport } = fakeTransport();
    const server = fakeServer();
    const session = new CallSession(transport, server, { timers: false, now: () => 1000 });
    const usage = { output_token_details: { audio_tokens: 100 } };
    transport.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "Hello there", usage: { type: "tokens", input_tokens: 10, output_tokens: 3 } });
    transport.emit({ type: "response.output_audio_transcript.done", transcript: "Hi! What do you need?" });
    transport.emit({ type: "response.done", response: { usage } });
    await session.flush();
    expect(server.report).toHaveBeenCalledWith([
      { type: "transcript", role: "user", text: "Hello there", at: 1000 },
      { type: "transcription_usage", usage: { type: "tokens", input_tokens: 10, output_tokens: 3 } },
      { type: "transcript", role: "assistant", text: "Hi! What do you need?", at: 1000 },
      { type: "usage", usage },
    ]);
    expect(session.state.costUsd).toBe(0.12);
  });

  it("says a Bot reply when nothing else is in flight", async () => {
    const { transport, sent } = fakeTransport();
    const server = fakeServer({ poll: vi.fn(async () => ({ replies: [{ id: 7, summary: "Done.", note: "(Studio, not the user:) Dot replied: Done." }] })) });
    const session = new CallSession(transport, server, { timers: false });
    transport.emit({ type: "response.created" });
    await session.pickUp();
    // A response is playing: it waits.
    expect(sent).toEqual([]);
    transport.emit({ type: "response.done", response: {} });
    await settle();
    expect(sent).toEqual([
      { type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "(Studio, not the user:) Dot replied: Done." }] } },
      { type: "response.create" },
    ]);
    // The same reply isn't said twice.
    sent.length = 0;
    transport.emit({ type: "response.done", response: {} });
    await session.pickUp();
    await settle();
    expect(sent).toEqual([]);
  });

  it("picks replies up when a report says the server holds some", async () => {
    const { transport } = fakeTransport();
    const server = fakeServer({ report: vi.fn(async () => ({ costUsd: 0.1, replies: 1 })) });
    const session = new CallSession(transport, server, { timers: false });
    transport.emit({ type: "response.output_audio_transcript.done", transcript: "On it." });
    await session.flush();
    expect(server.poll).toHaveBeenCalled();
  });

  it("push-to-talk turns server VAD off, holds the mic to the button, and commits on release", () => {
    const { transport, sent, mic } = fakeTransport();
    const session = new CallSession(transport, fakeServer(), { timers: false });
    session.setPushToTalk(true);
    expect(sent.at(-1)).toEqual({ type: "session.update", session: { type: "realtime", audio: { input: { turn_detection: null } } } });
    expect(mic.at(-1)).toBe(false);
    transport.emit({ type: "response.created" });
    session.pressTalk();
    expect(sent.slice(1).map((event) => event.type)).toEqual(["response.cancel", "output_audio_buffer.clear", "input_audio_buffer.clear"]);
    expect(mic.at(-1)).toBe(true);
    session.releaseTalk();
    expect(sent.slice(-2)).toEqual([{ type: "input_audio_buffer.commit" }, { type: "response.create" }]);
    expect(mic.at(-1)).toBe(false);
    session.setPushToTalk(false);
    expect(sent.at(-1)).toEqual({ type: "session.update", session: { type: "realtime", audio: { input: { turn_detection: SERVER_VAD } } } });
    expect(mic.at(-1)).toBe(true);
  });

  it("mutes the mic", () => {
    const { transport, mic } = fakeTransport();
    const session = new CallSession(transport, fakeServer(), { timers: false });
    session.setMuted(true);
    expect(mic.at(-1)).toBe(false);
    session.setMuted(false);
    expect(mic.at(-1)).toBe(true);
  });

  it("hangs up with what's left to report, once", async () => {
    const { transport } = fakeTransport();
    const server = fakeServer();
    const session = new CallSession(transport, server, { timers: false, now: () => 5 });
    transport.emit({ type: "response.output_audio_transcript.done", transcript: "Bye!" });
    const record = await session.hangUp();
    expect(transport.close).toHaveBeenCalled();
    expect(server.end).toHaveBeenCalledWith([{ type: "transcript", role: "assistant", text: "Bye!", at: 5 }]);
    expect(record).toMatchObject({ id: "vc_x" });
    expect(session.state).toMatchObject({ status: "ended", costUsd: 0.2 });
    await session.hangUp();
    expect(server.end).toHaveBeenCalledTimes(1);
    // Events after hang-up are ignored.
    transport.emit({ type: "response.created" });
    expect(session.state.responding).toBe(false);
  });

  it("hangs up when the connection drops", async () => {
    const { transport } = fakeTransport();
    const server = fakeServer();
    const session = new CallSession(transport, server, { timers: false });
    transport.drop("The call's connection dropped.");
    await settle();
    expect(server.end).toHaveBeenCalled();
    expect(session.state.error).toBe("The call's connection dropped.");
  });
});
