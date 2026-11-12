import { describe, expect, it, vi } from "vitest";
import { LiveSession, type LiveServer } from "./session";
import type { LiveTransport } from "./transport";
import { waitingNote } from "../shared";

function fakes(options: { stop?: string | null; replies?: number; wait?: (ms: number) => Promise<void> } = {}) {
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
    tool: vi.fn(async ({ name }: { name: string }) => ({ output: name === "send_to_thread" ? `Sent to the Larkspur lead. Say just that ("Sent to the Larkspur lead."); its answer will come back here.` : "ok" })),
    event: vi.fn(async () => ({ costUsd: 0.02, replies: options.replies ?? 0, stop: options.stop ?? null, voiceThreadId: "thr_voice" })),
    poll: vi.fn(async () => ({ replies: [{ id: 1, title: "the Larkspur lead", summary: "Paused.", note: "(Studio, not the user:) the Larkspur lead answered: Paused." }] })),
    end: vi.fn(async () => ({})),
  };
  let now = 1_800_000_000_000;
  const session = new LiveSession(server, {
    now: () => now, timers: false, earcon: () => {},
    connect: async (start) => ({ transport, started: await start() }),
    wait: options.wait ?? (async () => {}),
  });
  return { session, server, transport, sent, muted, emit: (event: Record<string, unknown>) => listener(event), setLevels: (next: typeof levels) => { levels = next; }, advance: (ms: number) => { now += ms; } };
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
    emit({ type: "session.input_transcript.delta", delta: "Tell the Larkspur lead to pause it" });
    emit({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "send_to_thread", arguments: `{"target":"the Larkspur lead","message":"Pause it"}` } } });
    await flush();
    expect(server.tool).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "vl_0123456789abcdef", name: "send_to_thread", events: [expect.objectContaining({ type: "transcript", role: "user", text: "Tell the Larkspur lead to pause it" })] }));
    expect(sent).toContainEqual({ type: "response.item.create", item: { type: "function_call_output", call_id: "c1", output: expect.stringMatching(/^Sent to the Larkspur lead/) } });
    expect(session.machine.card).toEqual({ kind: "sent", title: "Sent to the Larkspur lead", detail: "" });
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
    expect(replying.sent).toContainEqual({ type: "session.commentary.append", delegation_id: null, content: "(Studio, not the user:) the Larkspur lead answered: Paused." });
    expect(replying.session.machine.card?.title).toBe("the Larkspur lead answered");

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
    const waitFor = { title: "the Larkspur lead", ms: 20_000, note: waitingNote("the Larkspur lead") };
    vi.mocked(server.tool).mockResolvedValueOnce({ output: `Sent to the Larkspur lead. Say briefly "Asking the Larkspur lead now." Then wait for the reply; don't guess.`, waitFor });
    session.start();
    await flush();
    emit({ type: "session.started" });
    emit({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "send_to_thread", arguments: `{"target":"the Larkspur lead","intent":"answer","message":"What's the status?"}` } } });
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
      `tool → Sent to the Larkspur lead. Say briefly "Asking the Larkspur lead now." Then wait for the reply; don't guess.`,
      `note → (Studio, not the user:) the Larkspur lead hasn't answered yet. Say only, briefly: "Still waiting on the Larkspur lead." Then wait; don't guess.`,
    ]);
    expect(session.trace.map((entry) => entry.what)).toContain("waiting on the Larkspur lead");
  });

  it("a reply before 20 s cancels the still-waiting line", async () => {
    const { session, server, sent, emit, advance } = fakes({ replies: 1 });
    vi.mocked(server.tool).mockResolvedValueOnce({ output: "Sent to the Larkspur lead.", waitFor: { title: "the Larkspur lead", ms: 20_000, note: waitingNote("the Larkspur lead") } });
    session.start();
    await flush();
    emit({ type: "session.started" });
    emit({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "send_to_thread", arguments: "{}" } } });
    await flush();
    advance(5_000);
    await session.sync();
    advance(40_000);
    session.tick();
    expect(sent.filter((event) => event.type === "session.commentary.append").map((event) => event.content)).toEqual(["(Studio, not the user:) the Larkspur lead answered: Paused."]);
  });

  it("says why when Studio isn't ready", async () => {
    const { session, server } = fakes();
    vi.mocked(server.state).mockResolvedValueOnce({ ready: false, problem: "Hands-free voice needs an OpenAI API key.", model: "gpt-live-1", cosName: "Dot" });
    session.start();
    await flush();
    expect(session.machine.phase).toEqual({ kind: "failed", why: "Hands-free voice needs an OpenAI API key." });
  });
  describe("what Studio is told survives a failed sync (review findings 1 and 2)", () => {
    const usage = (index: number) => ({ type: "response.done", response: { usage: { input_tokens: index, output_tokens: 1 } } });
    const sentUsage = (calls: { events: { type: string; usage?: { input_tokens?: number } }[] }[]) => calls.flatMap((call) => call.events).filter((event) => event.type === "usage").map((event) => event.usage!.input_tokens);

    it("puts the reports back when a sync fails, and sends them next time, in order, at most 200 at a time", async () => {
      const { session, server, emit } = fakes();
      session.start();
      await flush();
      emit({ type: "session.started" });
      for (let index = 0; index < 150; index++) emit(usage(index));
      vi.mocked(server.event).mockRejectedValueOnce(new Error("offline"));
      await session.sync();
      for (let index = 150; index < 250; index++) emit(usage(index));
      vi.mocked(server.event).mockClear();
      await session.sync();
      const calls = vi.mocked(server.event).mock.calls.map(([input]) => input);
      expect(calls.map((call) => call.events.length)).toEqual([200, 50]);
      expect(sentUsage(calls as never)).toEqual(Array.from({ length: 250 }, (_, index) => index));
      expect(session.machine.isLive).toBe(true);
    });

    it("a batch that fails partway keeps the part Studio didn't get", async () => {
      const { session, server, emit } = fakes();
      session.start();
      await flush();
      emit({ type: "session.started" });
      for (let index = 0; index < 250; index++) emit(usage(index));
      vi.mocked(server.event).mockResolvedValueOnce({ costUsd: 0, replies: 0, stop: null, voiceThreadId: null }).mockRejectedValueOnce(new Error("offline"));
      await session.sync();
      await session.sync();
      const calls = vi.mocked(server.event).mock.calls.map(([input]) => input);
      expect(calls.map((call) => call.events.length)).toEqual([200, 50, 50]);
      expect(sentUsage([calls[0], calls[2]] as never)).toEqual(Array.from({ length: 250 }, (_, index) => index));
    });

    it("hangs up after 10 failed syncs in a row (30 s without Studio), saying why", async () => {
      const { session, server, emit } = fakes();
      session.start();
      await flush();
      emit({ type: "session.started" });
      emit(usage(7));
      vi.mocked(server.event).mockRejectedValue(new Error("offline"));
      for (let index = 0; index < 9; index++) await session.sync();
      expect(session.machine.isLive).toBe(true);
      await session.sync();
      await flush();
      expect(session.machine.phase).toEqual({ kind: "failed", why: expect.stringMatching(/couldn't reach Studio/) });
      // The end carries what never got through.
      expect(server.end).toHaveBeenCalledWith({ sessionId: "vl_0123456789abcdef", events: [expect.objectContaining({ type: "usage" })] });
    });

    it("a successful sync resets the count", async () => {
      const { session, server, emit } = fakes();
      session.start();
      await flush();
      emit({ type: "session.started" });
      for (let round = 0; round < 3; round++) {
        vi.mocked(server.event).mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"))
          .mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
        for (let index = 0; index < 6; index++) await session.sync();
      }
      expect(session.machine.isLive).toBe(true);
    });

    it("retries the end until Studio answers, with the same reports", async () => {
      const waits: number[] = [];
      const { session, server, emit } = fakes({ wait: async (ms) => { waits.push(ms); } });
      session.start();
      await flush();
      emit({ type: "session.started" });
      emit(usage(1));
      vi.mocked(server.end).mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
      session.stop();
      for (let index = 0; index < 10; index++) await flush();
      expect(server.end).toHaveBeenCalledTimes(3);
      const ends = vi.mocked(server.end).mock.calls.map(([input]) => input);
      expect(ends[2]).toEqual(ends[0]);
      expect(sentUsage([ends[0]] as never)).toEqual([1]);
      expect(waits.length).toBeGreaterThanOrEqual(2);
    });

    it("session.close's final usage reaches Studio with the end", async () => {
      let grace: () => void = () => {};
      const { session, server, emit } = fakes({ wait: (ms) => new Promise((resolve) => { if (ms === 400) grace = resolve; else resolve(); }) });
      session.start();
      await flush();
      emit({ type: "session.started" });
      session.stop();
      await flush();
      expect(server.end).not.toHaveBeenCalled();
      // GPT-Live answers session.close with the session's final seconds.
      emit({ type: "session.closed", reason: "close_requested", usage: { seconds: 90 } });
      grace();
      for (let index = 0; index < 5; index++) await flush();
      expect(server.end).toHaveBeenCalledWith({ sessionId: "vl_0123456789abcdef", events: [{ type: "live_usage", seconds: 90 }] });
    });

    it("a failed tool call puts its lines back for the next sync", async () => {
      const { session, server, emit } = fakes();
      session.start();
      await flush();
      emit({ type: "session.started" });
      emit({ type: "session.input_transcript.delta", delta: "What's waiting?" });
      vi.mocked(server.tool).mockRejectedValueOnce(new Error("offline"));
      emit({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "todos_list", arguments: "{}" } } });
      await flush();
      await session.sync();
      expect(server.event).toHaveBeenCalledWith({ sessionId: "vl_0123456789abcdef", events: [expect.objectContaining({ type: "transcript", text: "What's waiting?" })] });
    });

    it("a tool call with more than 200 reports sends the older ones first", async () => {
      const { session, server, emit } = fakes();
      session.start();
      await flush();
      emit({ type: "session.started" });
      for (let index = 0; index < 230; index++) emit(usage(index));
      emit({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "todos_list", arguments: "{}" } } });
      for (let index = 0; index < 5; index++) await flush();
      const events = vi.mocked(server.event).mock.calls.map(([input]) => input);
      const tool = vi.mocked(server.tool).mock.calls[0]![0];
      expect(events.map((call) => call.events.length)).toEqual([30]);
      expect(tool.events).toHaveLength(200);
      expect(sentUsage([...events, tool] as never)).toEqual(Array.from({ length: 230 }, (_, index) => index));
    });
  });
});
