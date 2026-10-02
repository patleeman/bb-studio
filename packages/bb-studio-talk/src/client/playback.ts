import type { Segment } from "../shared/contract";

type Clip = Pick<Segment, "id" | "offsetMs" | "durationMs">;
type AudioClip = Pick<HTMLAudioElement, "currentTime" | "playbackRate" | "volume" | "readyState" | "src" | "play" | "pause" | "load" | "addEventListener">;
export interface PlaybackState { positionMs: number; segmentId: string | null; playing: boolean; rate: number; volume: number }

/** One recording timeline across independently encoded audio files. */
export class RecordingPlayer {
  state: PlaybackState = { positionMs: 0, segmentId: null, playing: false, rate: 1, volume: 1 };
  private audio: AudioClip | null = null;
  segments: readonly Clip[] = [];

  constructor(
    private readonly recordingId: string,
    private readonly changed: (state: PlaybackState) => void,
    private readonly failed: (error: unknown) => void,
    private readonly createAudio: (url: string) => AudioClip = (url) => new Audio(url),
  ) {}

  get durationMs(): number { return this.segments.reduce((end, clip) => Math.max(end, clip.offsetMs + clip.durationMs), 0); }
  private set(patch: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  pause(): void { this.audio?.pause(); this.set({ playing: false }); }
  toggle(): void {
    if (this.state.playing) this.pause();
    else this.seek(this.state.positionMs >= this.durationMs ? 0 : this.state.positionMs, true);
  }
  setRate(rate: number): void {
    if (this.audio) this.audio.playbackRate = rate;
    this.set({ rate });
  }
  setVolume(volume: number): void {
    const value = Math.max(0, Math.min(volume, 1));
    if (this.audio) this.audio.volume = value;
    this.set({ volume: value });
  }
  seek(positionMs: number, play = this.state.playing): void {
    if (!this.segments.length) return;
    const position = Math.max(0, Math.min(positionMs, this.durationMs));
    const clip = this.segments.find((item) => position < item.offsetMs + item.durationMs) ?? this.segments.at(-1)!;
    const localSeconds = Math.max(0, position - clip.offsetMs) / 1000;
    let element = this.audio;
    const same = element && this.state.segmentId === clip.id;
    if (!same) {
      this.release();
      element = this.createAudio(`/api/v1/plugins/talk/http/audio?recording=${encodeURIComponent(this.recordingId)}&segment=${encodeURIComponent(clip.id)}`);
      this.audio = element;
    }
    const current = element!;
    this.set({ positionMs: position, segmentId: clip.id, playing: play });
    current.playbackRate = this.state.rate;
    current.volume = this.state.volume;
    const move = () => {
      if (this.audio === current) current.currentTime = localSeconds;
    };
    if (current.readyState > 0) move();
    else current.addEventListener("loadedmetadata", move, { once: true });
    if (!same) {
      current.addEventListener("timeupdate", () => {
        if (this.audio === current) this.set({ positionMs: clip.offsetMs + Math.min(current.currentTime * 1000, clip.durationMs) });
      });
      current.addEventListener("ended", () => {
        if (this.audio !== current) return;
        const next = this.segments[this.segments.findIndex((item) => item.id === clip.id) + 1];
        if (next && this.state.playing) this.seek(next.offsetMs, true);
        else { this.pause(); this.set({ positionMs: clip.offsetMs + clip.durationMs }); }
      });
      current.addEventListener("error", () => this.onError(current, new Error("The recording's audio could not be loaded.")));
    }
    if (play) void current.play().catch((error: unknown) => this.onError(current, error));
    else current.pause();
  }
  private onError(element: AudioClip, error: unknown): void {
    if (this.audio !== element || (!this.state.playing && error instanceof Error && error.name === "AbortError")) return;
    this.pause();
    this.failed(error);
  }
  private release(): void {
    const previous = this.audio;
    this.audio = null;
    if (previous) { previous.pause(); previous.src = ""; previous.load(); }
  }
  dispose(): void { this.release(); }
}
