import { describe, expect, it } from "vitest";
import { RecordingPlayer } from "./playback";

class FakeAudio extends EventTarget {
  currentTime = 0;
  playbackRate = 1;
  volume = 1;
  readyState = 1;
  src = "";
  paused = true;
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
}
function setup() {
  const files: FakeAudio[] = [];
  const errors: unknown[] = [];
  const player = new RecordingPlayer("rec_test", () => {}, (error) => errors.push(error), (url) => {
    const audio = new FakeAudio(); audio.src = url; files.push(audio); return audio;
  });
  player.segments = [
    { id: "first", offsetMs: 0, durationMs: 25_000 },
    { id: "second", offsetMs: 25_000, durationMs: 20_000 },
    { id: "third", offsetMs: 45_000, durationMs: 15_000 },
  ];
  return { player, files, errors };
}

describe("recording playback", () => {
  it("seeks across files and reports recording time for transcript highlighting", () => {
    const { player, files } = setup();
    player.seek(32_000, true);
    expect(files[0]!.src).toContain("segment=second");
    expect(files[0]!.currentTime).toBe(7);
    files[0]!.currentTime = 9;
    files[0]!.dispatchEvent(new Event("timeupdate"));
    expect(player.state).toMatchObject({ positionMs: 34_000, segmentId: "second", playing: true });
    player.seek(49_000);
    expect(files[0]!.paused).toBe(true);
    expect(files[1]!.currentTime).toBe(4);
    expect(player.state.segmentId).toBe("third");
    files[0]!.dispatchEvent(new Event("ended"));
    expect(files).toHaveLength(2);
  });
  it("pauses and resumes at the same time, and keeps speed across segments", () => {
    const { player, files } = setup();
    player.setRate(1.5);
    player.setVolume(0.4);
    player.seek(10_000, true);
    player.toggle();
    expect(files[0]!.paused).toBe(true);
    player.toggle();
    expect(files).toHaveLength(1);
    expect(files[0]!.currentTime).toBe(10);
    files[0]!.dispatchEvent(new Event("ended"));
    expect(player.state).toMatchObject({ segmentId: "second", positionMs: 25_000, playing: true });
    expect(files[1]!.playbackRate).toBe(1.5);
    expect(files[1]!.volume).toBe(0.4);
  });
  it("clamps seeks and restarts after the final segment ends", () => {
    const { player, files } = setup();
    player.seek(-10_000);
    expect(player.state.positionMs).toBe(0);
    player.seek(90_000, true);
    expect(player.state.positionMs).toBe(60_000);
    files.at(-1)!.dispatchEvent(new Event("ended"));
    expect(player.state.playing).toBe(false);
    player.toggle();
    expect(player.state).toMatchObject({ segmentId: "first", positionMs: 0, playing: true });
  });
  it("seeks after metadata loads and ignores events after disposal", () => {
    const { player, files, errors } = setup();
    player.seek(0);
    files[0]!.readyState = 0;
    player.seek(12_000);
    files[0]!.dispatchEvent(new Event("loadedmetadata"));
    expect(files[0]!.currentTime).toBe(12);
    player.dispose();
    files[0]!.dispatchEvent(new Event("ended"));
    files[0]!.dispatchEvent(new Event("error"));
    expect(files).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});
