import { describe, expect, it, vi } from "vitest";
import { LiveSession, type LiveServer } from "./session";
import type { LiveTransport } from "./transport";
import { waitingNote } from "../shared";

function fakes(options: { stop?: string | null; replies?: number } = {}) {
  let listener: (event: Record<string, unknown>) => void = () => {};
  const sent: Record<string, unknown>[] = [];
  const muted: boolean[] = [];
  let levels = { mic: [] as number[], playback: 0 };
  const transport: LiveTransport = {
    send: (event) => sent.push(event),
    onEvent: (next) => { listener = next; },
    onClose: () => {},
    setAgentAudio: (enabled) => muted.push(!enabled),
    levels: () => { const now = levels; levels = { mic: [], playback: levels.playback }; return now; },
    micLabel: "Fake mic",
    micOpenedAt: null,
    close: vi.fn(),
  };
  const started = { sessionId: "vl_0123456789abcdef", model: "gpt-live-1", transport: "mock", answerSdp: null, clientSecret: null, callsUrl: null, mockUrl: "ws://mock", cosName: "Dot" };
  const server: LiveServer = {
    state: vi.fn(async () => ({ ready: true, problem: null, model: "gpt-live-1", cosName: "Dot" })),
    start: vi.fn(async () => started),
    tool: vi.fn(async ({ name }: { name: string }) => ({ output: name === "send_to_thread" ? `Sent to the Kensico lead. Say just that ("Sent to the Kensico lead."); its answer will come back here.` : "ok" })),
    event: vi.fn(async () => ({ costUsd: 0.02, replies: options.replies ?? 0, stop: options.stop ?? null, voiceThreadId: "thr_voice" })),
    poll: vi.fn(async () => ({ replies: [{ id: 1, title: "the Kensico lead", summary: "Paused.", note: "(Studio, not the user:) the Kensico lead answered: Paused." }] })),
    end: vi.fn(async () => ({})),
  };
  let now = 1_800_000_000_000;
  const session = new LiveSession(server, {
    now: () => now, timers: false, earcon: () => {},
    connect: async (start) => ({ transport, started: await start() }),
  });
  return { session, server, sent, muted, emit: (event: Record<string, unknown>) => listener(event), setLevels: (next: typeof levels) => { levels = next; }, advance: (ms: number) => { now += ms; } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LiveSession", () => {
  it("connects, relays a tool call with the lines heard, and returns the result to the model", async () => {
    const { session, server, sent, emit } = fakes();
    session.start();
    await flush();
    expect(session.micLabel).toBe("Fake mic");
    emit({ type: "session.started" });
    expect(session.machine.phase.kind).toBe("listening");
    emit({ type: "session.input_transcript.delta", delta: "Tell the Kensico lead to pause it" });
    emit({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "send_to_thread", arguments: `{"target":"the Kensico lead","message":"Pause it"}` } } });
    await flush();
    expect(server.tool).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "vl_0123456789abcdef", name: "send_to_thread", events: [expect.objectContaining({ type: "transcript", role: "user", text: "Tell the Kensico lead to pause it" })] }));
    expect(sent).toContainEqual({ type: "response.item.create", item: { type: "function_call_output", call_id: "c1", output: expect.stringMatching(/^Sent to the Kensico lead/) } });
    expect(session.machine.card).toEqual({ kind: "sent", title: "Sent to the Kensico lead", detail: "" });
  });

  it("recovers an interviewer server close on the same record without ending it", async () => {
    const h = fakes();
    const started = await h.server.start({});
    vi.mocked(h.server.start).mockResolvedValue({ ...started, identity: { kind: 'thread', name: 'Interviewer · rate limiter', label: 'Interviewer · rate limiter', threadId: null } });
    h.server.reconnect = vi.fn(async () => ({ sessionId: started.sessionId, answerSdp: 'new answer', clientSecret: null, callsUrl: null }));
    h.session.start();
    await flush();
    h.emit({ type: 'session.started' });
    h.emit({ type: 'session.input_transcript.delta', delta: 'Counter keys include org and model.' });
    h.emit({ type: 'session.closed', reason: 'connection_lost', usage: { seconds: 60 } });
    await flush();
    expect(h.server.reconnect).toHaveBeenCalledWith(expect.objectContaining({ sessionId: started.sessionId }));
    expect(h.server.end).not.toHaveBeenCalled();
    expect(h.session.machine.isLive).toBe(true);
  });
  it("barge-in by level mutes the transport at once", async () => {
    const { session, muted, emit, setLevels, advance } = fakes();
    session.start();
    await flush();
    emit({ type: "session.started" });
    emit({ type: "session.output_transcript.delta", delta: "First, reply to Dana about the pricing deck, then renew the domain before Friday" });
    setLevels({ mic: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2], playback: 0.1 });
    advance(50);
    session.tick();
    expect(muted).toEqual([true]);
    expect(session.trace.map((entry) => entry.what)).toContain("voice muted");
  });

  it("picks up replies, reports cost, and stops at the cap", async () => {
    const replying = fakes({ replies: 1 });
    replying.session.start();
    await flush();
    replying.emit({ type: "session.started" });
    await replying.session.sync();
    expect(replying.session.costUsd).toBe(0.02);
    expect(replying.session.voiceThreadId).toBe("thr_voice");
    expect(replying.sent).toContainEqual({ type: "session.commentary.append", delegation_id: null, content: "(Studio, not the user:) the Kensico lead answered: Paused." });
    expect(replying.session.machine.card?.title).toBe("the Kensico lead answered");

    const capped = fakes({ stop: "This month's hands-free voice has reached the $20.00 cap." });
    capped.session.start();
    await flush();
    capped.emit({ type: "session.started" });
    await capped.session.sync();
    await flush();
    expect(capped.session.machine.phase.kind).toBe("ended");
    expect(capped.server.end).toHaveBeenCalled();
  });

  it("after an answer relay, the voice says once that it's still waiting (transcript)", async () => {
    const { session, server, sent, emit, advance } = fakes();
    const waitFor = { title: "the Kensico lead", ms: 20_000, note: waitingNote("the Kensico lead") };
    vi.mocked(server.tool).mockResolvedValueOnce({ output: `Sent to the Kensico lead. Say briefly "Asking the Kensico lead now." Then wait for the reply; don't guess.`, waitFor });
    session.start();
    await flush();
    emit({ type: "session.started" });
    emit({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "send_to_thread", arguments: `{"target":"the Kensico lead","intent":"answer","message":"What's the status?"}` } } });
    await flush();
    const spoken = () => sent.filter((event) => event.type === "session.commentary.append").map((event) => event.content);
    advance(19_000);
    session.tick();
    expect(spoken()).toEqual([]);
    advance(1_000);
    session.tick();
    advance(30_000);
    session.tick();
    // What the model is told, in order: the tool result, then the one spoken note.
    const transcript = sent.map((event) => event.type === "response.item.create" ? `tool → ${(event.item as { output: string }).output}` : event.type === "session.commentary.append" ? `note → ${event.content as string}` : null).filter(Boolean);
    expect(transcript).toEqual([
      `tool → Sent to the Kensico lead. Say briefly "Asking the Kensico lead now." Then wait for the reply; don't guess.`,
      `note → (Studio, not the user:) the Kensico lead hasn't answered yet. Say only, briefly: "Still waiting on the Kensico lead." Then wait; don't guess.`,
    ]);
    expect(session.trace.map((entry) => entry.what)).toContain("waiting on the Kensico lead");
  });

  it("a reply before 20 s cancels the still-waiting line", async () => {
    const { session, server, sent, emit, advance } = fakes({ replies: 1 });
    vi.mocked(server.tool).mockResolvedValueOnce({ output: "Sent to the Kensico lead.", waitFor: { title: "the Kensico lead", ms: 20_000, note: waitingNote("the Kensico lead") } });
    session.start();
    await flush();
    emit({ type: "session.started" });
    emit({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "send_to_thread", arguments: "{}" } } });
    await flush();
    advance(5_000);
    await session.sync();
    advance(40_000);
    session.tick();
    expect(sent.filter((event) => event.type === "session.commentary.append").map((event) => event.content)).toEqual(["(Studio, not the user:) the Kensico lead answered: Paused."]);
  });

  it("says why when Studio isn't ready", async () => {
    const { session, server } = fakes();
    vi.mocked(server.state).mockResolvedValueOnce({ ready: false, problem: "Hands-free voice needs an OpenAI API key.", model: "gpt-live-1", cosName: "Dot" });
    session.start();
    await flush();
    expect(session.machine.phase).toEqual({ kind: "failed", why: "Hands-free voice needs an OpenAI API key." });
  });
});
