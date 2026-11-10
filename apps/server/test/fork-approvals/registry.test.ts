import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApprovalRegistry,
  approvalSigningPayload,
  type ApprovalDecision,
} from "../../src/services/fork-approvals/registry.js";

function setup() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const clock = { now: 1_000_000 };
  const registry = new ApprovalRegistry({
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    now: () => clock.now,
  });
  const signed = (id: string, decision: ApprovalDecision) => ({
    channel: "desktop" as const,
    signature: sign(
      null,
      approvalSigningPayload(id, decision),
      privateKey,
    ).toString("base64url"),
  });
  return { registry, clock, signed };
}

const REQUEST = {
  pluginId: "studio",
  title: "Let Trip planner use the network?",
  message: "It asks for two things.",
  detail: null,
  items: [
    { id: "fetch", label: "Fetch from api.example.com" },
    { id: "clipboard", label: "Read the clipboard" },
  ],
  confirmLabel: "Allow",
};

describe("approvals", () => {
  it("resolves with a decision the desktop app signed, limited to the items that were asked", async () => {
    const { registry, signed } = setup();
    const { approval, decision } = registry.request(REQUEST);
    const answer = { approved: true, picked: ["fetch", "not-asked"] };

    registry.resolve(approval.id, answer, signed(approval.id, answer));

    await expect(decision).resolves.toEqual({
      approved: true,
      picked: ["fetch"],
    });
    expect(registry.pending()).toEqual([]);
  });

  it("refuses an answer without proof, with a signature for another decision, or from an unpaired browser", () => {
    const { registry, signed } = setup();
    const { approval } = registry.request(REQUEST);
    const approve = { approved: true, picked: ["fetch"] };
    const deny = { approved: false, picked: [] };

    expect(() =>
      registry.resolve(approval.id, approve, {
        channel: "session",
        token: null,
      }),
    ).toThrowError(expect.objectContaining({ reason: "no_proof" }));
    expect(() =>
      registry.resolve(approval.id, approve, {
        channel: "session",
        token: "guess",
      }),
    ).toThrowError(expect.objectContaining({ reason: "bad_proof" }));
    expect(() =>
      registry.resolve(approval.id, approve, signed(approval.id, deny)),
    ).toThrowError(expect.objectContaining({ reason: "bad_proof" }));
    expect(registry.pending()).toHaveLength(1);
  });

  it("counts an approval nobody answered as denied when it expires", async () => {
    const { registry, clock } = setup();
    const { decision } = registry.request(REQUEST);
    clock.now += 11 * 60_000;
    expect(registry.pending()).toEqual([]);
    await expect(decision).resolves.toEqual({ approved: false, picked: [] });
  });

  it("pairs a browser only through the desktop app, then accepts that browser's answers", async () => {
    const { registry, signed } = setup();
    const pairing = registry.startPairing("Chrome on a phone, 100.64.0.2");
    const allow = { approved: true, picked: [] };

    expect(registry.claimPairing(pairing.pairingId, pairing.secret)).toBeNull();
    expect(() =>
      registry.resolve(pairing.approvalId, allow, {
        channel: "session",
        token: "anything",
      }),
    ).toThrowError(expect.objectContaining({ reason: "bad_proof" }));
    registry.resolve(
      pairing.approvalId,
      allow,
      signed(pairing.approvalId, allow),
    );
    await Promise.resolve();
    expect(registry.claimPairing(pairing.pairingId, "wrong")).toBeNull();
    const token = registry.claimPairing(pairing.pairingId, pairing.secret);
    expect(token).not.toBeNull();
    expect(registry.claimPairing(pairing.pairingId, pairing.secret)).toBeNull();

    const { approval, decision } = registry.request(REQUEST);
    registry.resolve(
      approval.id,
      { approved: true, picked: ["clipboard"] },
      { channel: "session", token },
    );
    await expect(decision).resolves.toEqual({
      approved: true,
      picked: ["clipboard"],
    });
  });

  it("has no desktop channel without a public key, so nothing can be signed in", () => {
    const registry = new ApprovalRegistry({ publicKeyPem: null });
    const { approval } = registry.request(REQUEST);
    expect(registry.hasDesktopChannel()).toBe(false);
    expect(() =>
      registry.resolve(
        approval.id,
        { approved: true, picked: [] },
        { channel: "desktop", signature: "AAAA" },
      ),
    ).toThrowError(expect.objectContaining({ reason: "bad_proof" }));
  });
});
