import { describe, expect, it } from "vitest";
import { encodeOutgoing, parseEvent } from "./events";
import { BargeInGate, interruptedNote, SessionMachine, type Effect } from "./machine";

const t0 = 1_800_000_000;
const DROP = `Not done yet (action d_1): it's hard to undo, so it needs the user's yes. Ask exactly this and wait: "Drop the todo 'Remove the stale Tailscale node'? Say yes to drop." Call confirm only after they say yes.`;

function live(ends = true) {
  const machine = new SessionMachine(ends);
  expect(machine.start(t0)).toEqual([{ type: "earcon", earcon: "start" }, { type: "connect" }]);
  machine.handle({ type: "started" }, t0 + 0.5);
  expect(machine.phase.kind).toBe("listening");
  return machine;
}

const transcripts = (effects: Effect[] | ReturnType<SessionMachine["drain"]>) =>
  (effects as { type: string; role?: string; text?: string }[]).filter((each) => each.type === "transcript").map((each) => `${each.role}: ${each.text}`);

describe("events", () => {
  it("reads GPT-Live's events, its backend's tool calls and usage", () => {
    expect(parseEvent({ type: "session.started" })).toEqual([{ type: "started" }]);
    expect(parseEvent(`{"type":"session.input_transcript.delta","delta":"tell the"}`)).toEqual([{ type: "userText", text: "tell the" }]);
    expect(parseEvent({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "todos_list", arguments: "{}" } } }))
      .toEqual([{ type: "toolCall", callId: "c1", name: "todos_list", arguments: "{}" }]);
    expect(parseEvent({ type: "response.event", event: { type: "response.output_item.done", item: { type: "message" } } })).toEqual([]);
    expect(parseEvent({ type: "session.closed", reason: "expired", usage: { seconds: 90 } })).toEqual([{ type: "liveUsage", seconds: 90 }, { type: "closed", reason: "expired" }]);
    expect(parseEvent({ type: "input_audio_buffer.speech_started" })).toEqual([{ type: "userSpeechStarted" }]);
    expect(parseEvent("not json")).toEqual([]);
  });

  it("writes tool results and notes for each protocol", () => {
    expect(encodeOutgoing({ type: "toolResult", callId: "c", output: "x" }, "live").map((each) => each.type)).toEqual(["response.item.create", "response.create"]);
    expect(encodeOutgoing({ type: "toolResult", callId: "c", output: "x" }, "realtime").map((each) => each.type)).toEqual(["conversation.item.create", "response.create"]);
    expect(encodeOutgoing({ type: "note", text: "say", spoken: true }, "live")[0]!.type).toBe("session.commentary.append");
    expect(encodeOutgoing({ type: "note", text: "know", spoken: false }, "live")[0]!.type).toBe("session.thinking.append");
    expect(encodeOutgoing({ type: "note", text: "know", spoken: false }, "realtime")).toHaveLength(1);
  });
});

describe("barge-in gate", () => {
  const feed = (gate: BargeInGate, level: number, playback: number, from: number, seconds: number, playing = true) => {
    for (let at = from; at < from + seconds; at += 0.02) if (gate.feed(level, playback, playing, at)) return at;
    return null;
  };
  it("triggers on sustained speech above the voice's echo, not on a spike or the echo itself", () => {
    expect(feed(new BargeInGate(), 0.15, 0.1, t0, 1)! - t0).toBeCloseTo(0.12, 1);
    expect(feed(new BargeInGate(), 0.3, 0.1, t0, 0.08)).toBeNull();
    for (const playback of [0.05, 0.1, 0.2, 0.4]) expect(feed(new BargeInGate(), playback * 0.45, playback, t0, 2)).toBeNull();
    expect(new BargeInGate().threshold(0.2, true)).toBeCloseTo(0.12);
    expect(new BargeInGate().threshold(0, false)).toBe(0.02);
  });
});

describe("session machine", () => {
  it("ends hands-free turns on a pause, with no clicks", () => {
    const machine = live();
    machine.handle({ type: "userText", text: "What's waiting" }, t0 + 1);
    machine.handle({ type: "userText", text: " on me?" }, t0 + 1.3);
    expect(machine.speaking).toBe("user");
    expect(machine.subtitle).toEqual({ speaker: "user", text: "What's waiting on me?" });
    expect(machine.tick(t0 + 2.3)).toEqual([{ type: "earcon", earcon: "heard" }]);
    expect(machine.phase.kind).toBe("thinking");
    machine.handle({ type: "agentText", text: "Two things need you." }, t0 + 3);
    expect(machine.speaking).toBe("agent");
    machine.tick(t0 + 6);
    expect(machine.phase.kind).toBe("listening");
    expect(transcripts(machine.drain())).toEqual(["user: What's waiting on me?", "assistant: Two things need you."]);
  });

  it("barge-in by level mutes at once; words confirm it, with the note", () => {
    const machine = live();
    machine.handle({ type: "agentText", text: "First, reply to Dana about the pricing deck, then renew the domain" }, t0 + 1);
    const frames = (level: number, from: number, count: number) => Array.from({ length: count }, (_, index) => ({ level, at: from + index * 0.02 }));
    expect(machine.micLevels(frames(0.05, t0 + 1.5, 10), 0.1)).toEqual([]);
    expect(machine.micLevels(frames(0.2, t0 + 2, 10), 0.1)).toEqual([{ type: "muteAgentAudio", muted: true }]);
    machine.micLevels(frames(0.2, t0 + 2.2, 70), 0.1);
    expect(machine.tick(t0 + 3.5)).toEqual([]);
    const confirmed = machine.handle({ type: "userText", text: "Okay, stop" }, t0 + 4.4);
    expect(confirmed).toContainEqual({ type: "send", outgoing: { type: "note", text: interruptedNote("First, reply to Dana about the pricing deck, then renew the domain"), spoken: false } });
    expect(machine.interruptions).toBe(1);
    expect(machine.falseTriggers).toBe(0);
  });

  it("a level trigger with no words lets the voice carry on", () => {
    const machine = live();
    machine.handle({ type: "agentText", text: "First, reply to Dana about the pricing deck, then renew the domain" }, t0 + 1);
    machine.micLevels([{ level: 0.2, at: t0 + 2 }, { level: 0.2, at: t0 + 2.06 }, { level: 0.2, at: t0 + 2.12 }], 0.1);
    expect(machine.agentMuted).toBe(true);
    expect(machine.tick(t0 + 2.9)).toEqual([]);
    expect(machine.tick(t0 + 3.2)).toEqual([{ type: "muteAgentAudio", muted: false }]);
    expect(machine.falseTriggers).toBe(1);
    expect(machine.phase.kind).toBe("agentSpeaking");
  });

  it("the voice's own echo isn't the user", () => {
    const machine = live();
    machine.handle({ type: "agentText", text: "Sent to the Larkspur lead, they will pause the fetcher." }, t0 + 1);
    expect(machine.handle({ type: "userText", text: "pause the fetcher" }, t0 + 1.4)).toEqual([]);
    expect(machine.agentMuted).toBe(false);
  });

  it("relays show Sent at once; only destructive actions wait for a yes", () => {
    const machine = live();
    machine.toolFinished("c1", "send_to_thread", `Sent to the Larkspur lead. Say just that ("Sent to the Larkspur lead."); its answer will come back here.`, t0 + 1);
    expect(machine.confirmation).toBeNull();
    expect(machine.card).toEqual({ kind: "sent", title: "Sent to the Larkspur lead", detail: "" });
    machine.toolFinished("c2", "loops_act", DROP, t0 + 2);
    expect(machine.confirmation).toBe("Drop the todo 'Remove the stale Tailscale node'? Say yes to drop.");
    machine.toolFinished("c3", "confirm", `Studio didn't hear a clear yes (it heard "hmm"), so nothing was done.`, t0 + 3);
    expect(machine.confirmation).not.toBeNull();
    machine.toolFinished("c4", "confirm", "Dropped the todo 'Remove the stale Tailscale node'. Say that briefly.", t0 + 4);
    expect(machine.confirmation).toBeNull();
    expect(machine.card?.title).toBe("Dropped the todo 'Remove the stale Tailscale node'.");
  });

  it("a line doesn't end while the user is still audibly talking, however slow the transcript", () => {
    const machine = live();
    machine.handle({ type: "userText", text: "Okay" }, t0 + 1);
    // 1.2 s with no new words, but the mic still hears them (live run: the transcript lags while the voice talks).
    machine.micLevels(Array.from({ length: 60 }, (_, index) => ({ level: 0.1, at: t0 + 1 + index * 0.02 })), 0);
    expect(machine.tick(t0 + 2.2)).toEqual([]);
    expect(machine.phase.kind).toBe("userSpeaking");
    machine.handle({ type: "userText", text: ". Stop there" }, t0 + 2.3);
    expect(machine.tick(t0 + 3.4)).toEqual([{ type: "earcon", earcon: "heard" }]);
    expect(transcripts(machine.drain())).toEqual(["user: Okay. Stop there"]);
  });

  it("says why the session ended, in words", () => {
    const machine = live();
    machine.handle({ type: "closed", reason: "remote_hangup" }, t0 + 9);
    expect(machine.phase).toEqual({ kind: "ended", why: "The voice ended the session" });
  });

  it("a tool call carries the lines heard so far, so Studio hears the yes first", () => {
    const machine = live();
    machine.handle({ type: "userText", text: "Yes." }, t0 + 1);
    const effects = machine.handle({ type: "toolCall", callId: "c9", name: "confirm", arguments: `{"action_id":"d_1"}` }, t0 + 1.2);
    const run = effects.find((effect) => effect.type === "runTool") as Extract<Effect, { type: "runTool" }>;
    expect(transcripts(run.reports)).toEqual(["user: Yes."]);
  });

  describe("still waiting on an answer relay", () => {
    const NOTE = `(Studio, not the user:) the Larkspur lead hasn't answered yet. Say only, briefly: "Still waiting on the Larkspur lead." Then wait; don't guess.`;
    const waiting = { note: NOTE, ms: 20_000 };
    const notes = (effects: Effect[]) => effects.filter((effect) => effect.type === "send" && effect.outgoing.type === "note");
    const relayed = () => {
      const machine = live();
      machine.toolFinished("c1", "send_to_thread", `Sent to the Larkspur lead. Say briefly "Asking the Larkspur lead now."`, t0 + 1);
      machine.waitForReply(waiting, t0 + 1);
      return machine;
    };

    it("says it once, 20 s after the relay, when the voice is free", () => {
      const machine = relayed();
      expect(machine.phase.kind).toBe("listening");
      expect(notes(machine.tick(t0 + 20.9))).toEqual([]);
      expect(notes(machine.tick(t0 + 21))).toEqual([{ type: "send", outgoing: { type: "note", text: NOTE, spoken: true } }]);
      expect(machine.waitingOnReply).toBe(false);
      expect(notes(machine.tick(t0 + 45))).toEqual([]);
    });

    it("waits for the voice or the user to finish talking", () => {
      const machine = relayed();
      machine.handle({ type: "agentText", text: "Asking the Larkspur lead now." }, t0 + 20);
      expect(notes(machine.tick(t0 + 21))).toEqual([]);
      expect(notes(machine.tick(t0 + 30))).toHaveLength(1);
      expect(machine.phase.kind).toBe("listening");
      expect(notes(machine.tick(t0 + 30.05))).toEqual([]);
    });

    it("is cancelled by the reply", () => {
      const machine = relayed();
      machine.reply("the Larkspur lead", "Paused.", "(Studio, not the user:) the Larkspur lead answered: Paused.");
      expect(notes(machine.tick(t0 + 30))).toEqual([]);
    });

    it("is cancelled by the user's next request", () => {
      const machine = relayed();
      machine.handle({ type: "userText", text: "And what's on my calendar?" }, t0 + 5);
      machine.tick(t0 + 6.5);
      expect(machine.waitingOnReply).toBe(false);
      expect(notes(machine.tick(t0 + 30))).toEqual([]);
    });

    it("is cancelled when the session ends", () => {
      const machine = relayed();
      machine.stop(t0 + 5);
      expect(machine.waitingOnReply).toBe(false);
      expect(machine.tick(t0 + 30)).toEqual([]);
      const failed = relayed();
      failed.fail("The connection was lost", t0 + 5);
      expect(failed.waitingOnReply).toBe(false);
    });

    it("a newer relay restarts the wait, still once", () => {
      const machine = relayed();
      machine.waitForReply({ note: NOTE.replaceAll("the Larkspur lead", "Dot"), ms: 20_000 }, t0 + 15);
      expect(notes(machine.tick(t0 + 21))).toEqual([]);
      expect(notes(machine.tick(t0 + 35))).toEqual([{ type: "send", outgoing: { type: "note", text: expect.stringContaining("Still waiting on Dot."), spoken: true } }]);
      expect(notes(machine.tick(t0 + 60))).toEqual([]);
    });
  });
  describe("what Studio is told (review findings 1 and 3)", () => {
    const users = (reports: ReturnType<SessionMachine["drain"]>) => reports.filter((report) => report.type === "transcript" && report.role === "user");

    it("reports put back after a failed sync go first, in their order", () => {
      const machine = live();
      machine.handle({ type: "backendUsage", input: 1, cached: 0, output: 1 }, t0 + 1);
      machine.handle({ type: "backendUsage", input: 2, cached: 0, output: 2 }, t0 + 1);
      const failed = machine.drain();
      machine.handle({ type: "backendUsage", input: 3, cached: 0, output: 3 }, t0 + 2);
      machine.requeue(failed);
      expect(machine.drain().map((report) => (report as { input_tokens: number }).input_tokens)).toEqual([1, 2, 3]);
    });

    it("usage that comes after the hang-up (session.close's final usage) is still reported", () => {
      const machine = live();
      const stopped = machine.stop(t0 + 5);
      expect(stopped).toContainEqual({ type: "hangUp", reports: [] });
      machine.handle({ type: "liveUsage", seconds: 90 }, t0 + 5.2);
      machine.handle({ type: "closed", reason: "close_requested" }, t0 + 5.2);
      machine.handle({ type: "userText", text: "too late" }, t0 + 5.3);
      expect(machine.drain()).toEqual([{ type: "live_usage", seconds: 90 }]);
    });

    it("Realtime: the request transcribed after the question isn't marked as answering it; the yes after it is", () => {
      const machine = live(false);
      machine.handle({ type: "userSpeechStarted" }, t0 + 1);
      // The model calls delete before the request's transcript arrives.
      machine.handle({ type: "toolCall", callId: "c1", name: "delete_automation", arguments: `{"name":"heartbeat"}` }, t0 + 3);
      machine.toolFinished("c1", "delete_automation", DROP, t0 + 3.5);
      machine.handle({ type: "userLine", text: "Okay, delete the heartbeat" }, t0 + 4);
      machine.handle({ type: "userSpeechStarted" }, t0 + 7);
      machine.handle({ type: "userLine", text: "Yes" }, t0 + 8);
      expect(users(machine.drain())).toEqual([
        { type: "transcript", role: "user", text: "Okay, delete the heartbeat", at: (t0 + 4) * 1000, started_at: (t0 + 1) * 1000 },
        { type: "transcript", role: "user", text: "Yes", at: (t0 + 8) * 1000, started_at: (t0 + 7) * 1000, answers: "d_1" },
      ]);
    });

    it("Realtime: a yes whose speech start came before the request's transcript still answers", () => {
      const machine = live(false);
      machine.handle({ type: "userSpeechStarted" }, t0 + 1);
      machine.handle({ type: "toolCall", callId: "c1", name: "delete_automation", arguments: "{}" }, t0 + 3);
      machine.toolFinished("c1", "delete_automation", DROP, t0 + 3.5);
      machine.handle({ type: "userSpeechStarted" }, t0 + 6);
      machine.handle({ type: "userLine", text: "Okay, delete the heartbeat" }, t0 + 6.5);
      machine.handle({ type: "userLine", text: "Yes" }, t0 + 7);
      const [request, yes] = users(machine.drain()) as { started_at?: number; answers?: string }[];
      expect(request).toMatchObject({ started_at: (t0 + 1) * 1000 });
      expect(request!.answers).toBeUndefined();
      expect(yes).toMatchObject({ answers: "d_1" });
    });

    it("GPT-Live: a line starts when the mic first heard it, not when its slow transcript came", () => {
      const machine = live();
      machine.micLevels(Array.from({ length: 50 }, (_, index) => ({ level: 0.1, at: t0 + 1 + index * 0.02 })), 0);
      machine.handle({ type: "toolCall", callId: "c1", name: "delete_automation", arguments: "{}" }, t0 + 2.5);
      machine.toolFinished("c1", "delete_automation", DROP, t0 + 3);
      machine.handle({ type: "userText", text: "Okay delete it" }, t0 + 3.5);
      machine.tick(t0 + 5);
      machine.handle({ type: "userText", text: "Yes" }, t0 + 8);
      machine.tick(t0 + 10);
      const [request, yes] = users(machine.drain()) as { started_at?: number; answers?: string }[];
      expect(request).toMatchObject({ started_at: (t0 + 1) * 1000 });
      expect(request!.answers).toBeUndefined();
      expect(yes).toMatchObject({ started_at: (t0 + 8) * 1000, answers: "d_1" });
    });

    it("once the question is settled, later lines answer nothing", () => {
      const machine = live(false);
      machine.toolFinished("c1", "delete_automation", DROP, t0 + 1);
      machine.toolFinished("c2", "cancel", "Cancelled; nothing was done.", t0 + 2);
      machine.handle({ type: "userLine", text: "Yes" }, t0 + 3);
      expect((users(machine.drain())[0] as { answers?: string }).answers).toBeUndefined();
    });
  });
});
