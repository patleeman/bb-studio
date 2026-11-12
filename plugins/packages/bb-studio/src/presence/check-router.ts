import { randomUUID } from "node:crypto";
import type { CheckLine } from "./checks";
import type { PresencePackage } from "./schema";

import { PRESENCE_CHECK_CHANNEL_NAME } from "./check-bridge";

export const PRESENCE_CHECK_CHANNEL = PRESENCE_CHECK_CHANNEL_NAME;
export const CHECK_CLAIM_MS = 1500;
export const CHECK_RESULT_MS = 20_000;

export interface CheckRequest { requestId: string; presence: PresencePackage }
interface Pending { claimed: boolean; timer: ReturnType<typeof setTimeout>; finish(results: CheckLine[] | null): void }

export class PresenceCheckRouter {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly publish: (request: CheckRequest) => void,
    private readonly timing: { claimMs: number; resultMs: number } = { claimMs: CHECK_CLAIM_MS, resultMs: CHECK_RESULT_MS },
    private readonly newId: () => string = randomUUID,
  ) {}

  measure(presence: PresencePackage): Promise<CheckLine[] | null> {
    const requestId = this.newId();
    return new Promise((resolve) => {
      const finish = (results: CheckLine[] | null) => {
        const entry = this.pending.get(requestId);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(requestId);
        resolve(results?.length ? results : null);
      };
      this.pending.set(requestId, { claimed: false, timer: setTimeout(() => finish(null), this.timing.claimMs), finish });
      try { this.publish({ requestId, presence }); } catch { finish(null); }
    });
  }

  claim(requestId: string): boolean {
    const entry = this.pending.get(requestId);
    if (!entry || entry.claimed) return false;
    entry.claimed = true;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => entry.finish(null), this.timing.resultMs);
    return true;
  }

  reply(requestId: string, results: CheckLine[]): boolean {
    const entry = this.pending.get(requestId);
    if (!entry?.claimed) return false;
    entry.finish(results);
    return true;
  }

  dispose(): void {
    for (const entry of [...this.pending.values()]) entry.finish(null);
  }
}
