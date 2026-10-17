import { describe, expect, it } from "vitest";
import { Speaker, type SpeakerState } from "./speaker";

class FakeAudio extends EventTarget {
  preload: "" | "none" | "auto" | "metadata" = "";
  paused = true;
  loaded = 0;
  constructor(public src: string) { super(); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  load() { this.loaded++; }
  end() { this.paused = true; this.dispatchEvent(new Event("ended")); }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const clips: FakeAudio[] = [];
  const states: SpeakerState[] = [];
  const prepared: string[] = [];
  const speaker = new Speaker(async (text) => { prepared.push(text); return `/audio/${prepared.length}`; }, (state) => states.push(state), (url) => {
    const clip = new FakeAudio(url);
    clips.push(clip);
    return clip;
  });
  return { speaker, clips, states, prepared };
}

describe("Speaker", () => {
  it("plays pieces in order, loading the next while one plays", async () => {
    const { speaker, clips, states, prepared } = setup();
    const long = "This sentence is about sixty characters long, give or take. ".repeat(12);
    const done = speaker.speak(long);
    await tick();
    expect(prepared.length).toBeGreaterThan(1);
    expect(clips.map((clip) => clip.src)).toEqual(["/audio/1", "/audio/2"]);
    expect(clips[1]!.preload).toBe("auto");
    expect(states).toEqual(["loading", "speaking"]);
    for (let index = 0; index < prepared.length; index++) {
      clips[index]!.end();
      await tick();
    }
    await done;
    expect(clips).toHaveLength(prepared.length);
    expect(states.at(-1)).toBe("idle");
  });

  it("plays URLs a server already prepared", async () => {
    const { speaker, clips, prepared } = setup();
    const started: number[] = [];
    const done = speaker.play(["/audio/a", "/audio/b"], (index) => started.push(index));
    await tick();
    expect(prepared).toEqual([]);
    clips[0]!.end();
    await tick();
    clips[1]!.end();
    await done;
    expect(started).toEqual([0, 1]);
    expect(clips.map((clip) => clip.src)).toEqual(["/audio/a", "/audio/b"]);
  });

  it("stops at once and resolves the speech it cut off", async () => {
    const { speaker, clips, states } = setup();
    const done = speaker.speak("One. Two.");
    await tick();
    speaker.stop();
    await done;
    expect(clips[0]!.paused).toBe(true);
    expect(clips[0]!.src).toBe("");
    expect(states.at(-1)).toBe("idle");
  });

  it("rejects when the audio can't play", async () => {
    const { speaker, clips } = setup();
    const done = speaker.speak("Broken.");
    await tick();
    clips[0]!.dispatchEvent(new Event("error"));
    await expect(done).rejects.toThrow(/couldn't play/);
  });
});
