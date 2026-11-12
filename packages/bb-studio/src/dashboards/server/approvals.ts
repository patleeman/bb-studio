// One-time approval nonces for script widgets.
//
// BB's plugin RPC can't tell the app from the `bb` CLI or a curl from an
// agent's shell: every one of them is a `client` caller. So approval is a
// two-step exchange the approval dialog makes. Opening the dialog asks for a
// nonce (dashboards.requestApproval); Approve sends it back
// (dashboards.approveScript). A nonce:
// - approves one widget's one command (its sha256), once;
// - is refused before NOT_BEFORE_MS (the dialog was on screen a moment) and
//   after TTL_MS;
// - dies with any change to the dashboard after it was issued (the revision
//   is the dashboard's updated_at), and with a newer dialog for the widget.
// Nonces live in memory only: a restart forgets them.
import { createHash, randomBytes } from "node:crypto";

export const APPROVAL_TTL_MS = 5 * 60_000;
export const APPROVAL_NOT_BEFORE_MS = 750;

interface Pending {
  dashboardId: string;
  widgetId: string;
  sha256: string;
  revision: number;
  issuedAt: number;
}

const key = (nonce: string) => createHash("sha256").update(nonce).digest("hex");

export class ApprovalNonces {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly now: () => number) {}

  issue(input: Omit<Pending, "issuedAt">): { nonce: string; notBefore: number; expiresAt: number } {
    this.sweep();
    // A newer dialog for the widget replaces the older one's nonce.
    for (const [id, each] of this.pending) if (each.dashboardId === input.dashboardId && each.widgetId === input.widgetId) this.pending.delete(id);
    const nonce = randomBytes(32).toString("base64url");
    const issuedAt = this.now();
    this.pending.set(key(nonce), { ...input, issuedAt });
    return { nonce, notBefore: issuedAt + APPROVAL_NOT_BEFORE_MS, expiresAt: issuedAt + APPROVAL_TTL_MS };
  }

  /**
   * Spends a nonce: it's gone after this call, whatever the outcome (but a
   * too-early Approve keeps it). Throws a reason the dialog can show.
   */
  redeem(nonce: string, expected: { dashboardId: string; widgetId: string; sha256: string; revision: number }): void {
    const id = key(nonce);
    const found = this.pending.get(id);
    if (!found || found.dashboardId !== expected.dashboardId || found.widgetId !== expected.widgetId) {
      throw new Error("Approve a script from its approval dialog in the dashboard.");
    }
    const at = this.now();
    if (at < found.issuedAt + APPROVAL_NOT_BEFORE_MS) throw new Error("Read the command first, then approve it.");
    this.pending.delete(id);
    if (at > found.issuedAt + APPROVAL_TTL_MS) throw new Error("This approval dialog expired. Open it again.");
    if (found.sha256 !== expected.sha256) throw new Error("The command changed since it was shown. Review the new command and approve it again.");
    if (found.revision !== expected.revision) throw new Error("The dashboard changed since the dialog opened. Review the command again.");
  }

  /** Drops a dialog's nonce (Deny, or the dialog closing). */
  cancel(nonce: string): void {
    this.pending.delete(key(nonce));
  }

  /** Drops every nonce for a dashboard. */
  forget(dashboardId: string): void {
    for (const [id, each] of this.pending) if (each.dashboardId === dashboardId) this.pending.delete(id);
  }

  private sweep(): void {
    const at = this.now();
    for (const [id, each] of this.pending) if (at > each.issuedAt + APPROVAL_TTL_MS) this.pending.delete(id);
  }
}
