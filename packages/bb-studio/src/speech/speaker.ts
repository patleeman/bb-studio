// Plays text aloud in the browser through Studio's speech service. Text is
// cut into pieces (speechChunks); while one piece plays, the next one's audio
// is already loading, so long text plays without gaps after the first piece.
import { speechChunks } from "./chunks";

type Clip = Pick<HTMLAudioElement, "play" | "pause" | "removeAttribute" | "load" | "addEventListener" | "preload">;

export type SpeakerState = "idle" | "loading" | "speaking";

export class Speaker {
  private run = 0;
  private current: Clip | null = null;
  private next: Clip | null = null;
  state: SpeakerState = "idle";

  constructor(
    /** The audio URL for one piece of text. */
    private readonly prepare: (text: string) => Promise<string>,
    private readonly changed: (state: SpeakerState) => void = () => {},
    private readonly createAudio: (url: string) => Clip = (url) => new Audio(url),
  ) {}

  private set(state: SpeakerState): void {
    if (this.state === state) return;
    this.state = state;
    this.changed(state);
  }

  /** Speak text, stopping anything already playing. Resolves when it has all played; rejects when a piece fails. A later speak() or stop() resolves it early. */
  async speak(text: string): Promise<void> {
    this.stop();
    const run = ++this.run;
    const pieces = speechChunks(text);
    if (!pieces.length) return;
    this.set("loading");
    try {
      const urls: Promise<string>[] = pieces.map((piece) => this.prepare(piece));
      // Keep a failed later piece from rejecting unheard while an earlier one plays.
      urls.forEach((url) => url.catch(() => {}));
      let clip = this.createAudio(await urls[0]!);
      for (let index = 0; index < pieces.length; index++) {
        if (run !== this.run) return;
        this.current = clip;
        const ended = this.played(clip, run);
        ended.catch(() => {});
        await clip.play();
        if (run !== this.run) return;
        this.set("speaking");
        if (index + 1 < pieces.length) {
          // Start the next piece's audio while this one plays.
          const following = this.createAudio(await urls[index + 1]!);
          following.preload = "auto";
          following.load();
          this.next = following;
          await ended;
          clip = following;
        } else {
          await ended;
        }
      }
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
