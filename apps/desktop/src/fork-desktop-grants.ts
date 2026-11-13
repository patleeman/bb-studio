import type {
  DesktopAsk,
  DesktopGrantAnswer,
  DesktopGrantKind,
} from "./fork-desktop-control-ipc.js";

export type ForegroundDecision = "granted" | "refused" | "stopped" | "busy";

interface PendingAsk {
  ask: DesktopAsk;
  settle: (decision: ForegroundDecision) => void;
  promise: Promise<ForegroundDecision>;
}

export interface GrantSnapshot {
  kind: DesktopGrantKind;
  threadId: string | null;
  ask: DesktopAsk | null;
}

export class DesktopGrants {
  private kind: DesktopGrantKind = "none";
  private threadId: string | null = null;
  private pending: PendingAsk | null = null;
  private readonly stopped = new Set<string>();
  private nextId = 1;

  constructor(private readonly onChange: () => void = () => {}) {}

  snapshot(): GrantSnapshot {
    return {
      kind: this.kind,
      threadId: this.threadId,
      ask: this.pending?.ask ?? null,
    };
  }

  allowsForeground(threadId: string): boolean {
    return this.kind !== "none" && this.threadId === threadId;
  }

  isStopped(threadId: string): boolean {
    return this.stopped.has(threadId);
  }

  askForeground(request: Omit<DesktopAsk, "id">): Promise<ForegroundDecision> {
    if (this.stopped.has(request.threadId)) return Promise.resolve("stopped");
    if (this.allowsForeground(request.threadId)) {
      return Promise.resolve("granted");
    }
    if (this.pending !== null) {
      return this.pending.ask.threadId === request.threadId
        ? this.pending.promise
        : Promise.resolve("busy");
    }
    let settle: (decision: ForegroundDecision) => void = () => {};
    const promise = new Promise<ForegroundDecision>((resolve) => {
      settle = resolve;
    });
    const ask: DesktopAsk = { ...request, id: `ask-${String(this.nextId++)}` };
    this.pending = { ask, settle, promise };
    this.onChange();
    return promise;
  }

  answer(id: string, answer: DesktopGrantAnswer): boolean {
    const pending = this.pending;
    if (pending === null || pending.ask.id !== id) return false;
    this.pending = null;
    if (answer === "no") {
      this.revoke();
      pending.settle("refused");
    } else {
      this.kind = answer;
      this.threadId = pending.ask.threadId;
      pending.settle("granted");
    }
    this.onChange();
    return true;
  }

  expireAsk(id: string): void {
    if (this.pending?.ask.id === id) this.answer(id, "no");
  }

  usedForeground(threadId: string): void {
    if (this.kind === "once" && this.threadId === threadId) {
      this.revoke();
      this.onChange();
    }
  }

  userMoved(): boolean {
    if (this.kind === "none") return false;
    this.revoke();
    this.onChange();
    return true;
  }

  stop(threadId: string | null): void {
    if (threadId !== null) this.stopped.add(threadId);
    if (this.pending !== null) {
      const pending = this.pending;
      this.pending = null;
      pending.settle("stopped");
    }
    this.revoke();
    this.onChange();
  }

  resume(threadId: string | null): void {
    if (threadId === null) this.stopped.clear();
    else this.stopped.delete(threadId);
    this.onChange();
  }

  endSession(): void {
    this.stop(null);
    this.stopped.clear();
    this.onChange();
  }

  private revoke(): void {
    this.kind = "none";
    this.threadId = null;
  }
}

export interface PointerSample {
  x: number;
  y: number;
  at: number;
}

export interface InputWatchVerdict {
  moved: boolean;
  insideTarget: boolean;
}

export const POINTER_MOVE_THRESHOLD = 3;

export function judgePointer(
  previous: PointerSample | null,
  next: PointerSample,
  target: { x: number; y: number; width: number; height: number } | null,
  suppressedUntil: number,
): InputWatchVerdict {
  if (previous === null || next.at < suppressedUntil) {
    return { moved: false, insideTarget: false };
  }
  const moved =
    Math.hypot(next.x - previous.x, next.y - previous.y) >=
    POINTER_MOVE_THRESHOLD;
  const insideTarget =
    target !== null &&
    next.x >= target.x &&
    next.y >= target.y &&
    next.x <= target.x + target.width &&
    next.y <= target.y + target.height;
  return { moved, insideTarget };
}

export const PAUSE_HOLD_MS = 1500;

export function pausePhase(input: {
  phase: "acting" | "paused" | "stopped";
  verdict: InputWatchVerdict;
  now: number;
  pausedUntil: number;
}): { phase: "acting" | "paused" | "stopped"; pausedUntil: number } {
  if (input.phase === "stopped")
    return { phase: "stopped", pausedUntil: input.pausedUntil };
  if (input.verdict.moved && input.verdict.insideTarget) {
    return { phase: "paused", pausedUntil: input.now + PAUSE_HOLD_MS };
  }
  if (input.phase === "paused" && input.now <= input.pausedUntil) {
    return { phase: "paused", pausedUntil: input.pausedUntil };
  }
  return { phase: "acting", pausedUntil: input.pausedUntil };
}
