import { describe, expect, it, vi } from "vitest";
import { LiveSession } from "../../live/ui/session";
import type { LiveTransport } from "../../live/ui/transport";
import { MeetingController, heldBackNote, type MeetingServer } from "./controller";

function fakes(mode: "name" | "judge" = "name") {
  let listener: (event: Record<string, unknown>) => void = () => {};
  const sent: Record<string, unknown>[] = [];
  /** The transport's audio: true while the room can hear her. */
  const audio: boolean[] = [];
  const transport: LiveTransport = {
    send: (event) => sent.push(event),
    onEvent: (next) => { listener = next; },
    onClose: () => {},
    setAgentAudio: (enabled) => audio.push(enabled),
    levels: () => ({ mic: [], playback: 0 }),
    micLabel: "Room mic", micOpenedAt: null, close: vi.fn(),
  };
  const started = { sessionId: "mt_0123456789abcdef", model: "gpt-live-1", transport: "mock", answerSdp: null, clientSecret: null, callsUrl: null, mockUrl: "ws://mock", cosName: "Iris" };
  const view = vi.fn(async () => ({ lookups: [], notes: [{ id: 1, kind: "decision" as const, text: "Ship Tuesday", owner: null, at: 1 }], costUsd: 0.01 }));
  const server: MeetingServer = {
    state: vi.fn(async () => ({ ready: true, problem: null, model: "gpt-live-1", cosName: "Iris" })),
    start: vi.fn(async () => started),
    tool: vi.fn(async () => ({ output: "ok" })),
    event: vi.fn(async () => ({ costUsd: 0, replies: 0, stop: null })),
    poll: vi.fn(async () => ({ replies: [] })),
    end: vi.fn(async () => ({})),
    view,
  };
  let now = 1_800_000_000_000;
  const session = new LiveSession(server, { now: () => now, timers: false, earcon: () => {}, connect: async (start) => ({ transport, started: await start() }) });
  const meeting = new MeetingController(server, "Iris", mode, { now: () => now, timers: false, session });
  return {
    meeting, session, sent, audio, server,
    emit: (event: Record<string, unknown>) => listener(event),
    advance: (ms: number) => { now += ms; session.tick(); meeting.tick(); },
    heard: () => audio.at(-1) ?? true,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const roomSays = (emit: (event: Record<string, unknown>) => void, text: string) => emit({ type: "session.input_transcript.delta", delta: text });
const sheSays = (emit: (event: Record<string, unknown>) => void, text: string) => emit({ type: "session.output_transcript.delta", delta: text });

describe("MeetingController", () => {
  it("holds back an answer nobody asked for, and tells her", async () => {
    const { meeting, emit, sent, advance, heard } = fakes();
    meeting.start();
    await flush();
    emit({ type: "session.started" });
    expect(heard()).toBe(false);
    roomSays(emit, "I think the launch slipped to Thursday");
    advance(1500);
    sheSays(emit, "Actually the launch is on Tuesday.");
    expect(heard()).toBe(false);
    expect(meeting.gate.heldBack).toBe(1);
    expect(sent).toContainEqual({ type: "session.thinking.append", delegation_id: null, content: heldBackNote("Iris") });
    advance(1500);
    // The room's line is a caption; her held-back words never are.
    expect(meeting.captions).toEqual([{ speaker: "room", text: "I think the launch slipped to Thursday" }]);
  });

  it("her name lets her answer, and a follow-up without it still counts", async () => {
    const { meeting, emit, advance, heard } = fakes();
    meeting.start();
    await flush();
    emit({ type: "session.started" });
    roomSays(emit, "Iris, when is the launch?");
    // Open while the line is still coming in, so her first words aren't lost.
    expect(heard()).toBe(true);
    advance(1500);
    sheSays(emit, "Tuesday.");
    advance(1500);
    expect(meeting.captions).toEqual([{ speaker: "room", text: "Iris, when is the launch?" }, { speaker: "agent", text: "Tuesday." }]);
    advance(10_000);
    roomSays(emit, "and what time");
    advance(1500);
    sheSays(emit, "Ten in the morning.");
    expect(heard()).toBe(true);
    expect(meeting.gate.heldBack).toBe(0);
    // Long after, it shuts again.
    advance(60_000);
    expect(heard()).toBe(false);
  });

  it("Quiet silences her even when she's named; Ask opens it", async () => {
    const { meeting, emit, sent, advance, heard } = fakes("judge");
    meeting.start();
    await flush();
    emit({ type: "session.started" });
    expect(heard()).toBe(true);
    meeting.setQuiet(true);
    expect(heard()).toBe(false);
    expect(sent.at(-1)).toMatchObject({ type: "session.thinking.append", content: expect.stringContaining("Quiet") });
    roomSays(emit, "Iris, you there?");
    expect(heard()).toBe(false);
    meeting.setQuiet(false);
    advance(100);
    expect(heard()).toBe(true);

    const named = fakes("name");
    named.meeting.start();
    await flush();
    named.emit({ type: "session.started" });
    expect(named.heard()).toBe(false);
    named.meeting.ask();
    expect(named.heard()).toBe(true);
    expect(named.meeting.gate.why(1_800_000_000 + 1000)).toBeNull();
  });

  it("an answer arriving opens the gate and has her say it; the stage refreshes its notes", async () => {
    const { meeting, emit, server, heard } = fakes();
    meeting.start();
    await flush();
    emit({ type: "session.started" });
    expect(heard()).toBe(false);
    await meeting.answerArrived();
    expect(heard()).toBe(true);
    expect(server.poll).toHaveBeenCalled();
    expect(meeting.view.notes[0]!.text).toBe("Ship Tuesday");
  });
});
