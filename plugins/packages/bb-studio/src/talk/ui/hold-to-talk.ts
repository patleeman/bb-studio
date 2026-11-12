// Hold-to-talk: hold one modifier key on its own to dictate, let go to
// insert. BB command shortcuts only fire on press, so this watches keydown
// and keyup itself. A short delay tells a hold from a chord such as
// Option+E or AltGr+Q: another key in that window cancels it.

/** How long the key must be held alone before dictation starts. */
export const HOLD_DELAY_MS = 250;

interface KeyLike {
  code: string;
  repeat?: boolean;
}

export interface HoldToTalkOptions {
  /** The KeyboardEvent.code to watch, read on every press; null is off. */
  code(): string | null;
  /** Starts dictating; false when Talk was already busy, so release does nothing. */
  start(): boolean;
  /** Finishes the dictation the hold started and inserts it. */
  finish(): void;
  setTimer?(run: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
}

export class HoldToTalk {
  private timer: unknown = null;
  private holding = false;
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(private readonly options: HoldToTalkOptions) {
    this.setTimer = options.setTimer ?? ((run, ms) => window.setTimeout(run, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => window.clearTimeout(timer as number));
  }

  keydown(event: KeyLike): void {
    const code = this.options.code();
    if (code !== null && event.code === code) {
      if (event.repeat || this.timer !== null || this.holding) return;
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.holding = this.options.start();
      }, HOLD_DELAY_MS);
      return;
    }
    // A chord, not a hold. Once dictation has started, other keys don't matter.
    this.cancelPending();
  }

  keyup(event: KeyLike): void {
    if (event.code === this.options.code()) this.release();
  }

  /** The window lost focus mid-hold; the keyup will never come. */
  blur(): void {
    this.release();
  }

  private release(): void {
    this.cancelPending();
    if (!this.holding) return;
    this.holding = false;
    this.options.finish();
  }

  private cancelPending(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }
}

let watching = false;

/** Watches the window's keys until `signal` aborts; one watcher per window. */
export function watchHoldToTalk(options: HoldToTalkOptions, signal: AbortSignal): void {
  if (watching || signal.aborted) return;
  watching = true;
  const hold = new HoldToTalk(options);
  const down = (event: KeyboardEvent) => hold.keydown(event);
  const up = (event: KeyboardEvent) => hold.keyup(event);
  const blur = () => hold.blur();
  window.addEventListener("keydown", down, true);
  window.addEventListener("keyup", up, true);
  window.addEventListener("blur", blur);
  signal.addEventListener(
    "abort",
    () => {
      watching = false;
      hold.blur();
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    },
    { once: true },
  );
}
