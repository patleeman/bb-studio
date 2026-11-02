import { describe, expect, it, vi } from "vitest";
import { LiveSession, type LiveServer } from "./session";
import type { LiveTransport } from "./transport";

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

  it("says why when Studio isn't ready", async () => {
    const { session, server } = fakes();
    vi.mocked(server.state).mockResolvedValueOnce({ ready: false, problem: "Hands-free voice needs an OpenAI API key.", model: "gpt-live-1", cosName: "Dot" });
    session.start();
    await flush();
    expect(session.machine.phase).toEqual({ kind: "failed", why: "Hands-free voice needs an OpenAI API key." });
  });
});
