export const STUDIO_APPROVAL_WAIT_MS = 5_000;
const KEEP_MS = 10 * 60_000;

export class StudioApprovals {
  private readonly sent = new Map<string, { to: ReadonlySet<string>; at: number }>();
  private readonly waiters = new Map<string, Set<() => void>>();

  constructor(private readonly waitMs = STUDIO_APPROVAL_WAIT_MS, private readonly now: () => number = Date.now) {}

  finish(interactionId: string, delivered: readonly string[]): void {
    const at = this.now();
    for (const [id, entry] of this.sent) if (at - entry.at > KEEP_MS) this.sent.delete(id);
    this.sent.set(interactionId, { to: new Set(delivered), at });
    const waiting = this.waiters.get(interactionId);
    this.waiters.delete(interactionId);
    for (const wake of waiting ?? []) wake();
  }

  async reached(interactionId: string, to: string): Promise<boolean> {
    if (!this.sent.has(interactionId)) {
      await new Promise<void>((resolve) => {
        const waiting = this.waiters.get(interactionId) ?? new Set<() => void>();
        const wake = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => { waiting.delete(wake); if (!waiting.size) this.waiters.delete(interactionId); resolve(); }, this.waitMs);
        waiting.add(wake);
        this.waiters.set(interactionId, waiting);
      });
    }
    return this.sent.get(interactionId)?.to.has(to) ?? false;
  }
}
