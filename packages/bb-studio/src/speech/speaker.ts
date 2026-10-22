// Plays text aloud in the browser through Studio's speech service. Text is
// cut into pieces (speechChunks); while one piece plays, the next one's audio
// is already loading, so long text plays without gaps after the first piece.
import { speechChunks } from "./chunks";

type Clip = Pick<HTMLAudioElement, "play" | "pause" | "removeAttribute" | "load" | "addEventListener" | "preload" | "playbackRate">;

export type SpeakerState = "idle" | "loading" | "speaking";

export class Speaker {
  private run = 0;
  private current: Clip | null = null;
  private next: Clip | null = null;
  state: SpeakerState = "idle";
  /** Playback speed; the browser keeps the pitch. */
  private rate = 1;

  constructor(
    /** The audio URL for one piece of text. */
    private readonly prepare: (text: string) => Promise<string>,
    private readonly changed: (state: SpeakerState) => void = () => {},
    private readonly createAudio: (url: string) => Clip = (url) => new Audio(url),
  ) {}

  /** Play faster or slower, now and from the next piece on. */
  setRate(rate: number): void {
    this.rate = rate;
    for (const clip of [this.current, this.next]) if (clip) clip.playbackRate = rate;
  }

  private clip(url: string): Clip {
    const clip = this.createAudio(url);
    clip.playbackRate = this.rate;
    return clip;
  }

  private set(state: SpeakerState): void {
    if (this.state === state) return;
    this.state = state;
    this.changed(state);
  }

  /** Speak text, stopping anything already playing. Resolves when it has all played; rejects when a piece fails. A later speak() or stop() resolves it early. */
  speak(text: string): Promise<void> {
    return this.play(speechChunks(text).map((piece) => this.prepare(piece)));
  }

  /** Play audio URLs in order (a server that prepared the pieces already), stopping anything already playing. `onPiece` hears each piece's index as it starts. */
  async play(sources: readonly (string | Promise<string>)[], onPiece?: (index: number) => void): Promise<void> {
    this.stop();
    const run = ++this.run;
    if (!sources.length) return;
    this.set("loading");
    try {
      const urls = sources.map((source) => Promise.resolve(source));
      // Keep a failed later piece from rejecting unheard while an earlier one plays.
      urls.forEach((url) => url.catch(() => {}));
      let clip = this.clip(await urls[0]!);
      for (let index = 0; index < urls.length; index++) {
        if (run !== this.run) return;
        this.current = clip;
        const ended = this.played(clip, run);
        ended.catch(() => {});
        try {
          await clip.play();
        } catch (error) {
          // Stopped while it was still starting: the browser rejects play(), and that's not a failure.
          if (run !== this.run) return;
          throw error;
        }
        if (run !== this.run) return;
        this.set("speaking");
        onPiece?.(index);
        if (index + 1 < urls.length) {
          // Start the next piece's audio while this one plays.
          const following = this.clip(await urls[index + 1]!);
          following.preload = "auto";
          following.load();
          this.next = following;
          await ended;
          clip = following;
        } else {
          await ended;
        }
      }
    } catch (error) {
      if (run === this.run) this.stop();
      throw error;
    } finally {
      if (run === this.run) {
        this.current = this.next = null;
        this.set("idle");
      }
    }
  }

  private played(clip: Clip, run: number): Promise<void> {
    return new Promise((resolve, reject) => {
      clip.addEventListener("ended", () => resolve(), { once: true });
      clip.addEventListener("pause", () => { if (run !== this.run) resolve(); }, { once: true });
      clip.addEventListener("error", () => reject(new Error("The speech audio couldn't play.")), { once: true });
    });
  }

  stop(): void {
    this.run++;
    for (const clip of [this.current, this.next]) {
      if (!clip) continue;
      clip.pause();
      clip.removeAttribute("src");
      clip.load();
    }
    this.current = this.next = null;
    this.set("idle");
  }
}
