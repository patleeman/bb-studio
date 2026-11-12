export interface LoopItem {
  visible(): boolean;
  frame(dt: number): void;
  still(): void;
}

export interface LoopEnvironment {
  request(run: (time: number) => void): number;
  cancel(handle: number): void;
  active(): boolean;
  reduced(): boolean;
  watch(changed: () => void): () => void;
}

export const MAX_STEP = 0.05;
export const MAX_OWED = 0.25;
export const MAX_ACTIVE = 12;

export class PresenceLoop {
  private readonly items = new Set<LoopItem>();
  private readonly owed = new Map<LoopItem, number>();
  private handle: number | null = null;
  private last: number | null = null;
  private unwatch: (() => void) | null = null;
  private cursor = 0;
  frames = 0;
  drawn = 0;

  constructor(private readonly env: LoopEnvironment, private readonly cap = MAX_ACTIVE) {}

  get running(): boolean { return this.handle !== null; }
  get size(): number { return this.items.size; }

  private live(): boolean {
    return !this.env.reduced() && this.env.active();
  }

  add(item: LoopItem): () => void {
    this.items.add(item);
    if (!this.unwatch) this.unwatch = this.env.watch(() => this.sync(true));
    if (!this.live()) item.still();
    this.sync(false);
    return () => {
      this.items.delete(item);
      this.owed.delete(item);
      if (!this.items.size) { this.unwatch?.(); this.unwatch = null; }
      this.sync(false);
    };
  }

  private sync(changed: boolean): void {
    const run = this.items.size > 0 && this.live();
    if (run && this.handle === null) {
      this.last = null;
      this.handle = this.env.request(this.tick);
    } else if (!run && this.handle !== null) {
      this.env.cancel(this.handle);
      this.handle = null;
    }
    if (changed && !run) for (const item of this.items) item.still();
  }

  private readonly tick = (time: number): void => {
    this.handle = null;
    const dt = this.last === null ? 0 : Math.min(MAX_STEP, Math.max(0, (time - this.last) / 1000));
    this.last = time;
    this.frames++;
    const seen = [...this.items].filter((item) => item.visible());
    for (const item of seen) this.owed.set(item, Math.min(MAX_OWED, (this.owed.get(item) ?? 0) + dt));
    const count = Math.min(this.cap, seen.length);
    if (seen.length <= this.cap) this.cursor = 0;
    for (let i = 0; i < count; i++) {
      const item = seen[(this.cursor + i) % seen.length]!;
      const step = this.owed.get(item) ?? 0;
      this.owed.set(item, 0);
      this.drawn++;
      item.frame(step);
    }
    if (seen.length > this.cap) this.cursor = (this.cursor + count) % seen.length;
    if (this.items.size > 0 && this.live()) this.handle = this.env.request(this.tick);
  };
}

export function browserEnvironment(view: Window): LoopEnvironment {
  const doc = view.document;
  const motion = typeof view.matchMedia === "function" ? view.matchMedia("(prefers-reduced-motion: reduce)") : null;
  return {
    request: (run) => view.requestAnimationFrame(run),
    cancel: (handle) => view.cancelAnimationFrame(handle),
    active: () => doc.visibilityState !== "hidden" && doc.hasFocus(),
    reduced: () => !!motion?.matches,
    watch: (changed) => {
      view.addEventListener("focus", changed);
      view.addEventListener("blur", changed);
      doc.addEventListener("visibilitychange", changed);
      motion?.addEventListener?.("change", changed);
      return () => {
        view.removeEventListener("focus", changed);
        view.removeEventListener("blur", changed);
        doc.removeEventListener("visibilitychange", changed);
        motion?.removeEventListener?.("change", changed);
      };
    },
  };
}

let shared: PresenceLoop | null = null;

export function sharedLoop(): PresenceLoop {
  shared ??= new PresenceLoop(browserEnvironment(window));
  return shared;
}
