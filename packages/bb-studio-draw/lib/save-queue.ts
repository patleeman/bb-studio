/** Ordered autosaves. A failed request retains the newest scene until acknowledged. */
export class DrawingSaveQueue {
  private pending: { data: string } | null = null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private error: unknown = null;
  private listener: ((state: { pending: boolean; error: unknown }) => void) | null = null;

  constructor(private readonly save: (data: string) => Promise<unknown>) {}

  subscribe(listener: (state: { pending: boolean; error: unknown }) => void): () => void {
    this.listener = listener;
    this.notify();
    return () => { if (this.listener === listener) this.listener = null; };
  }

  get hasPending(): boolean { return this.pending !== null; }

  enqueue(data: string): void {
    this.pending = { data };
    this.failures = 0;
    this.error = null;
    this.schedule(1200);
    this.notify();
  }

  retry(): void {
    this.failures = 0;
    this.error = null;
    void this.flush();
  }

  flush(): Promise<void> {
    this.clearTimer();
    if (this.running) return this.running;
    const pending = this.pending;
    if (!pending) return Promise.resolve();
    this.running = Promise.resolve()
      .then(() => this.save(pending.data))
      .then(() => {
        if (this.pending === pending) this.pending = null;
        this.failures = 0;
        this.error = null;
      }, (error: unknown) => {
        this.error = error;
        this.failures++;
      })
      .finally(() => {
        this.running = null;
        if (this.pending) {
          // A newer scene replaces the failed payload; never put an older one back.
          if (!this.error || this.pending !== pending) this.schedule(0);
          else if (this.failures <= 3) this.schedule(1000 * 2 ** (this.failures - 1));
        }
        this.notify();
      });
    this.notify();
    return this.running;
  }

  /** Used only after the user deletes the drawing. */
  cancel(): void {
    this.pending = null;
    this.clearTimer();
    this.notify();
  }

  private notify(): void { this.listener?.({ pending: this.hasPending, error: this.error }); }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => { void this.flush(); }, delay);
  }
}
