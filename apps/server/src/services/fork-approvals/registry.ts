import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
  type KeyObject,
} from "node:crypto";

export const APPROVAL_PUBLIC_KEY_ENV = "BB_APPROVAL_PUBLIC_KEY";
export const APPROVAL_SESSION_COOKIE = "bb_approver";

const APPROVAL_TTL_MS = 10 * 60_000;
const PAIRING_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_PENDING = 50;

export interface ApprovalItem {
  id: string;
  label: string;
}

export interface ApprovalRequest {
  pluginId: string;
  title: string;
  message: string;
  detail: string | null;
  items: ApprovalItem[];
  confirmLabel: string;
}

export interface ApprovalDecision {
  approved: boolean;
  picked: string[];
}

export interface PendingApproval extends ApprovalRequest {
  id: string;
  kind: "plugin" | "pair-browser";
  createdAt: number;
  expiresAt: number;
}

interface Entry {
  approval: PendingApproval;
  settle(decision: ApprovalDecision): void;
}

export type ApprovalProof =
  | { channel: "desktop"; signature: string }
  | { channel: "session"; token: string | null };

export class ApprovalRefusedError extends Error {
  constructor(
    readonly reason: "unknown" | "expired" | "no_proof" | "bad_proof",
    message: string,
  ) {
    super(message);
  }
}

export function approvalSigningPayload(
  approvalId: string,
  decision: ApprovalDecision,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      "bb-approval-v1",
      approvalId,
      decision.approved,
      [...decision.picked].sort(),
    ]),
  );
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class ApprovalRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly sessions = new Map<string, number>();
  private readonly pairings = new Map<
    string,
    { secretHash: string; approved: boolean; expiresAt: number }
  >();
  private readonly publicKey: KeyObject | null;

  constructor(
    private readonly options: {
      publicKeyPem: string | null;
      now?: () => number;
      onChange?: () => void;
    },
  ) {
    let key: KeyObject | null = null;
    if (options.publicKeyPem !== null && options.publicKeyPem.length > 0) {
      try {
        key = createPublicKey(options.publicKeyPem);
      } catch {
        key = null;
      }
    }
    this.publicKey = key;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  hasDesktopChannel(): boolean {
    return this.publicKey !== null;
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.approval.expiresAt <= now) {
        this.entries.delete(id);
        entry.settle({ approved: false, picked: [] });
      }
    }
    for (const [id, pairing] of this.pairings) {
      if (pairing.expiresAt <= now) this.pairings.delete(id);
    }
    for (const [hash, expiresAt] of this.sessions) {
      if (expiresAt <= now) this.sessions.delete(hash);
    }
  }

  private add(
    kind: PendingApproval["kind"],
    request: ApprovalRequest,
  ): { approval: PendingApproval; decision: Promise<ApprovalDecision> } {
    this.sweep();
    if (this.entries.size >= MAX_PENDING) {
      throw new Error(
        "Too many approvals are waiting. Answer or dismiss some first.",
      );
    }
    const now = this.now();
    const approval: PendingApproval = {
      ...request,
      id: `apr_${randomBytes(12).toString("base64url")}`,
      kind,
      createdAt: now,
      expiresAt: now + APPROVAL_TTL_MS,
    };
    const decision = new Promise<ApprovalDecision>((resolve) => {
      this.entries.set(approval.id, { approval, settle: resolve });
    });
    this.options.onChange?.();
    return { approval, decision };
  }

  request(request: ApprovalRequest): {
    approval: PendingApproval;
    decision: Promise<ApprovalDecision>;
  } {
    return this.add("plugin", request);
  }

  pending(): PendingApproval[] {
    this.sweep();
    return [...this.entries.values()].map((entry) => entry.approval);
  }

  get(id: string): PendingApproval | null {
    this.sweep();
    return this.entries.get(id)?.approval ?? null;
  }

  isApprover(token: string | null): boolean {
    if (token === null || token.length === 0) return false;
    this.sweep();
    return this.sessions.has(hashToken(token));
  }

  private proves(
    approvalId: string,
    decision: ApprovalDecision,
    proof: ApprovalProof,
  ): boolean {
    if (proof.channel === "session") return this.isApprover(proof.token);
    if (this.publicKey === null) return false;
    try {
      return verify(
        null,
        approvalSigningPayload(approvalId, decision),
        this.publicKey,
        Buffer.from(proof.signature, "base64url"),
      );
    } catch {
      return false;
    }
  }

  resolve(id: string, decision: ApprovalDecision, proof: ApprovalProof): void {
    this.sweep();
    const entry = this.entries.get(id);
    if (entry === undefined) {
      throw new ApprovalRefusedError(
        "unknown",
        "This approval is gone. It was answered or it expired.",
      );
    }
    if (entry.approval.kind === "pair-browser" && proof.channel !== "desktop") {
      throw new ApprovalRefusedError(
        "bad_proof",
        "A browser can only be paired from the desktop app.",
      );
    }
    if (!this.proves(id, decision, proof)) {
      throw new ApprovalRefusedError(
        proof.channel === "session" && proof.token === null
          ? "no_proof"
          : "bad_proof",
        "Only a person in the bb app can answer an approval.",
      );
    }
    const allowed = new Set(entry.approval.items.map((item) => item.id));
    this.entries.delete(id);
    entry.settle({
      approved: decision.approved,
      picked: decision.approved
        ? decision.picked.filter((item) => allowed.has(item))
        : [],
    });
    this.options.onChange?.();
  }

  startPairing(description: string): {
    pairingId: string;
    secret: string;
    approvalId: string;
  } {
    const secret = randomBytes(32).toString("base64url");
    const pairingId = `pair_${randomBytes(9).toString("base64url")}`;
    const { approval, decision } = this.add("pair-browser", {
      pluginId: "bb",
      title: "Let this browser answer approvals?",
      message: description,
      detail:
        "Approve only if you just asked for this in a browser you are using. That browser can then approve what plugins ask, as you.",
      items: [],
      confirmLabel: "Allow this browser",
    });
    this.pairings.set(pairingId, {
      secretHash: hashToken(secret),
      approved: false,
      expiresAt: this.now() + PAIRING_TTL_MS,
    });
    void decision.then((result) => {
      const pairing = this.pairings.get(pairingId);
      if (pairing === undefined) return;
      if (result.approved) pairing.approved = true;
      else this.pairings.delete(pairingId);
    });
    return { pairingId, secret, approvalId: approval.id };
  }

  claimPairing(pairingId: string, secret: string): string | null {
    this.sweep();
    const pairing = this.pairings.get(pairingId);
    if (pairing === undefined || !pairing.approved) return null;
    const given = Buffer.from(hashToken(secret));
    const expected = Buffer.from(pairing.secretHash);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return null;
    }
    this.pairings.delete(pairingId);
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(hashToken(token), this.now() + SESSION_TTL_MS);
    return token;
  }
}
