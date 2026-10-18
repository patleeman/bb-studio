import { describe, expect, it } from "vitest";
import {
  BARGE_MS,
  HINT_KEY,
  INITIAL_INPUT,
  LONG_PRESS_MS,
  SPEECH_MS,
  SpeechGate,
  TURN_END_MS,
  footer,
  reduce,
  takeHint,
  wantsCapture,
  type VoiceInput,
} from "./voice-input";

const idle = { speaking: false, capturing: false };
const live = { speaking: false, capturing: true };
const handsFree: VoiceInput = { sub: "hands-free", pressedAt: null };

describe("one mic, one indicator", () => {
  const base = { state: INITIAL_INPUT, dictating: false, capturing: false, speaking: false };

  it("idle: the dictation mic and the speaker, nothing recording", () => {
    expect(footer({ ...base, voiceOn: false })).toMatchObject({ kind: "idle", dictationMic: true, ptt: false, indicator: null, placeholder: null });
  });

  it("dictating with voice mode off: Talk's one recorder", () => {
    expect(footer({ ...base, voiceOn: false, dictating: true })).toMatchObject({ kind: "dictating", indicator: "recorder", ptt: false });
  });

  it("voice mode on hides the dictation mic in every state", () => {
    for (const state of [INITIAL_INPUT, { sub: "ptt", pressedAt: 1 } as VoiceInput, handsFree]) {
      for (const speaking of [false, true]) {
        for (const capturing of [false, true]) {
          const view = footer({ voiceOn: true, state, dictating: false, capturing, speaking });
          expect(view.dictationMic).toBe(false);
          expect(view.indicator).not.toBe("recorder");
        }
      }
    }
  });

  it("push-to-talk at rest: just the hold-to-talk control", () => {
    expect(footer({ ...base, voiceOn: true })).toMatchObject({ kind: "ready", ptt: true, indicator: null });
  });

  it("holding to talk shows your voice, even over the Bot", () => {
    const held = { sub: "ptt", pressedAt: 5 } as VoiceInput;
    expect(footer({ ...base, voiceOn: true, state: held, capturing: true, speaking: true })).toMatchObject({ kind: "listening", indicator: "input", placeholder: "Listening…" });
  });

  it("the hold-to-talk key's capture shows as listening too", () => {
    expect(footer({ ...base, voiceOn: true, capturing: true })).toMatchObject({ kind: "listening", indicator: "input" });
  });

  it("hands-free listens; while the Bot speaks the same spot shows the Bot", () => {
    expect(footer({ ...base, voiceOn: true, state: handsFree, capturing: true })).toMatchObject({ kind: "listening", sub: "hands-free", ptt: false, indicator: "input" });
    expect(footer({ ...base, voiceOn: true, state: handsFree, capturing: true, speaking: true })).toMatchObject({ kind: "speaking", indicator: "output", placeholder: "Speaking…", ptt: false });
  });

  it("the Bot speaking in push-to-talk keeps the control, to interrupt it", () => {
    expect(footer({ ...base, voiceOn: true, speaking: true })).toMatchObject({ kind: "speaking", indicator: "output", ptt: true });
  });
});

describe("dictation and voice mode", () => {
  it("turning voice mode on while dictating finishes the dictation first", () => {
    expect(reduce(INITIAL_INPUT, { type: "voice-on", dictating: true }, idle).effects).toEqual(["finish-dictation"]);
    expect(reduce(INITIAL_INPUT, { type: "voice-on", dictating: false }, idle).effects).toEqual([]);
  });

  it("turning voice mode off closes its mic without sending and goes back to push-to-talk", () => {
    expect(reduce(handsFree, { type: "voice-off" }, live)).toEqual({ state: INITIAL_INPUT, effects: ["discard"] });
    expect(reduce(handsFree, { type: "voice-off" }, idle).effects).toEqual([]);
  });

  it("voice mode starts in push-to-talk", () => {
    expect(reduce(handsFree, { type: "voice-on", dictating: false }, idle).state).toEqual(INITIAL_INPUT);
  });
});

describe("push-to-talk", () => {
  it("press opens the mic; release after speaking sends", () => {
    const pressed = reduce(INITIAL_INPUT, { type: "press", at: 100 }, idle);
    expect(pressed).toEqual({ state: { sub: "ptt", pressedAt: 100 }, effects: ["start-capture"] });
    expect(reduce(pressed.state, { type: "release", at: 2000, heard: true }, live)).toEqual({ state: INITIAL_INPUT, effects: ["send"] });
  });

  it("a press while the Bot speaks interrupts it", () => {
    expect(reduce(INITIAL_INPUT, { type: "press", at: 0 }, { speaking: true, capturing: false }).effects).toEqual(["stop-playback", "start-capture"]);
  });

  it("a quick silent tap sends nothing and says how it works", () => {
    const pressed = reduce(INITIAL_INPUT, { type: "press", at: 0 }, idle).state;
    expect(reduce(pressed, { type: "release", at: LONG_PRESS_MS - 1, heard: false }, live)).toEqual({ state: INITIAL_INPUT, effects: ["discard", "show-hint"] });
  });

  it("a long silent press switches to hands-free and keeps listening", () => {
    const pressed = reduce(INITIAL_INPUT, { type: "press", at: 0 }, idle).state;
    expect(reduce(pressed, { type: "release", at: LONG_PRESS_MS, heard: false }, live)).toEqual({ state: handsFree, effects: [] });
  });

  it("a long press with speech in it is still push-to-talk: it sends", () => {
    const pressed = reduce(INITIAL_INPUT, { type: "press", at: 0 }, idle).state;
    expect(reduce(pressed, { type: "release", at: 5000, heard: true }, live)).toEqual({ state: INITIAL_INPUT, effects: ["send"] });
  });

  it("a lost pointer discards the turn", () => {
    expect(reduce({ sub: "ptt", pressedAt: 0 }, { type: "cancel" }, live)).toEqual({ state: INITIAL_INPUT, effects: ["discard"] });
  });

  it("ignores a second press and a stray release", () => {
    expect(reduce({ sub: "ptt", pressedAt: 0 }, { type: "press", at: 10 }, live).effects).toEqual([]);
    expect(reduce(INITIAL_INPUT, { type: "release", at: 10, heard: true }, idle).effects).toEqual([]);
  });

  it("doesn't end turns on a pause: you release to send", () => {
    expect(reduce({ sub: "ptt", pressedAt: 0 }, { type: "turn-end" }, live).effects).toEqual([]);
  });
});

describe("hands-free", () => {
  it("keeps the mic open whenever Talk is free", () => {
    expect(wantsCapture(true, handsFree, true)).toBe(true);
    expect(wantsCapture(true, handsFree, false)).toBe(false);
    expect(wantsCapture(true, INITIAL_INPUT, true)).toBe(false);
    expect(wantsCapture(false, handsFree, true)).toBe(false);
  });

  it("a pause after you speak sends the turn", () => {
    expect(reduce(handsFree, { type: "turn-end" }, live)).toEqual({ state: handsFree, effects: ["send"] });
  });

  it("talking over the Bot stops it", () => {
    expect(reduce(handsFree, { type: "barge-in" }, { speaking: true, capturing: true }).effects).toEqual(["stop-playback"]);
    expect(reduce(handsFree, { type: "barge-in" }, live).effects).toEqual([]);
  });

  it("the control isn't push-to-talk while hands-free", () => {
    expect(reduce(handsFree, { type: "press", at: 0 }, live)).toEqual({ state: handsFree, effects: [] });
  });

  it("tapping the red pill goes back to push-to-talk, sending what was said", () => {
    expect(reduce(handsFree, { type: "tap-pill", heard: true }, live)).toEqual({ state: INITIAL_INPUT, effects: ["send"] });
    expect(reduce(handsFree, { type: "tap-pill", heard: false }, live)).toEqual({ state: INITIAL_INPUT, effects: ["discard"] });
    expect(reduce(INITIAL_INPUT, { type: "tap-pill", heard: false }, live).effects).toEqual([]);
  });
});

describe("the speech gate", () => {
  const loud = { level: 0.5, quietForMs: 0 };
  const quiet = (ms: number) => ({ level: 0.02, quietForMs: ms });

  it("hears you after a short burst, not a click", () => {
    const gate = new SpeechGate();
    gate.push(loud, 100, false);
    expect(gate.heard).toBe(false);
    for (let ms = 100; ms < SPEECH_MS; ms += 100) gate.push(loud, 100, false);
    expect(gate.heard).toBe(true);
  });

  it("noise under the speech level isn't speech", () => {
    const gate = new SpeechGate();
    for (let i = 0; i < 20; i++) gate.push({ level: 0.1, quietForMs: 0 }, 100, false);
    expect(gate.heard).toBe(false);
  });

  it("barges in after sustained loud speech over the Bot, not its quieter echo", () => {
    const gate = new SpeechGate();
    for (let i = 0; i < 10; i++) expect(gate.push({ level: 0.25, quietForMs: 0 }, 100, true).bargeIn).toBe(false);
    let barged = false;
    for (let ms = 0; ms < BARGE_MS; ms += 100) barged = gate.push(loud, 100, true).bargeIn;
    expect(barged).toBe(true);
  });

  it("ends the turn after a long pause, only once you've spoken", () => {
    const gate = new SpeechGate();
    expect(gate.push(quiet(TURN_END_MS * 2), 100, false).turnEnd).toBe(false);
    for (let i = 0; i < 3; i++) gate.push(loud, 100, false);
    expect(gate.push(quiet(TURN_END_MS - 100), 100, false).turnEnd).toBe(false);
    expect(gate.push(quiet(TURN_END_MS), 100, false).turnEnd).toBe(true);
    gate.reset();
    expect(gate.push(quiet(TURN_END_MS), 100, false).turnEnd).toBe(false);
  });
});

describe("the first-time hint", () => {
  const memory = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), values };
  };

  it("shows once, then is remembered as seen", () => {
    const storage = memory();
    expect(takeHint(storage)).toBe(true);
    expect(storage.values.get(HINT_KEY)).toBe("1");
    expect(takeHint(storage)).toBe(false);
    expect(takeHint(storage)).toBe(false);
  });

  it("stays away when storage can't remember it", () => {
    expect(takeHint(null)).toBe(false);
    expect(takeHint({ getItem: () => null, setItem: () => { throw new Error("full"); } })).toBe(false);
  });
});
