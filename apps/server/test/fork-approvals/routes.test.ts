import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  requestPluginApproval,
  setForkApprovalRegistryForTest,
} from "../../src/services/fork-approvals/index.js";
import {
  ApprovalRegistry,
  approvalSigningPayload,
} from "../../src/services/fork-approvals/registry.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const API = "/api/v1/fork/approvals";

function useRegistry() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  setForkApprovalRegistryForTest(
    new ApprovalRegistry({
      publicKeyPem: publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    }),
  );
  return (id: string, approved: boolean, picked: string[]) =>
    sign(
      null,
      approvalSigningPayload(id, { approved, picked }),
      privateKey,
    ).toString("base64url");
}

function post(
  harness: TestAppHarness,
  path: string,
  body: unknown,
  cookie?: string,
) {
  return harness.app.request(`${API}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

async function pendingId(harness: TestAppHarness): Promise<string> {
  const response = await harness.app.request(`${API}/pending`);
  const { approvals } = (await response.json()) as {
    approvals: { id: string }[];
  };
  const id = approvals.at(-1)?.id;
  if (id === undefined) throw new Error("nothing pending");
  return id;
}

afterEach(() => setForkApprovalRegistryForTest(null));

describe("approval routes", () => {
  it("lets a plugin ask, refuses an answer from a plain client, and accepts the desktop app's signed answer", async () => {
    const signFor = useRegistry();
    await withTestHarness(async (harness) => {
      const decision = requestPluginApproval("studio", {
        title: "Allow network access?",
        message: "Trip planner asks to fetch from api.example.com.",
        items: [{ id: "fetch", label: "Fetch from api.example.com" }],
      });
      const id = await pendingId(harness);

      const plain = await post(harness, `/${id}/resolve`, {
        approved: true,
        picked: ["fetch"],
      });
      expect(plain.status).toBe(403);

      const signed = await post(harness, `/${id}/resolve`, {
        approved: true,
        picked: ["fetch"],
        signature: signFor(id, true, ["fetch"]),
      });
      expect(signed.status).toBe(200);
      await expect(decision).resolves.toEqual({
        approved: true,
        picked: ["fetch"],
      });
    });
  });

  it("pairs a browser through the desktop app and then takes that browser's cookie as proof", async () => {
    const signFor = useRegistry();
    await withTestHarness(async (harness) => {
      const started = await post(harness, "/pairings", {});
      const pairing = (await started.json()) as {
        pairingId: string;
        secret: string;
        approvalId: string;
      };
      const early = await post(
        harness,
        `/pairings/${pairing.pairingId}/claim`,
        {
          secret: pairing.secret,
        },
      );
      expect(await early.json()).toEqual({ paired: false });

      await post(harness, `/${pairing.approvalId}/resolve`, {
        approved: true,
        picked: [],
        signature: signFor(pairing.approvalId, true, []),
      });
      await Promise.resolve();
      const claimed = await post(
        harness,
        `/pairings/${pairing.pairingId}/claim`,
        {
          secret: pairing.secret,
        },
      );
      expect(await claimed.json()).toEqual({ paired: true });
      const setCookie = claimed.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Strict");
      const cookie = setCookie.split(";")[0] ?? "";

      const session = await harness.app.request(`${API}/session`, {
        headers: { cookie },
      });
      expect(await session.json()).toEqual({
        approver: true,
        desktopChannel: true,
      });

      const decision = requestPluginApproval("studio", {
        title: "Run this script?",
        message: "A dashboard wants to run a script.",
      });
      const id = await pendingId(harness);
      const answered = await post(
        harness,
        `/${id}/resolve`,
        { approved: false, picked: [] },
        cookie,
      );
      expect(answered.status).toBe(200);
      await expect(decision).resolves.toEqual({ approved: false, picked: [] });
    });
  });
});
