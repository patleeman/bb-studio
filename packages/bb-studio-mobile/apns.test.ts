import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { apnsPayload, deliverApns, normalizePem, notificationCategory, ProviderToken, type ApnsConfig, type ApnsSend } from "./apns.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const token = "ab".repeat(32);

const config: ApnsConfig = {
  keyPem: pem,
  keyId: "KEY123",
  teamId: "TEAM123",
  bundleId: "nyc.plee.bbgo",
  environment: "auto",
};

function recordingSend(results: Record<string, { status: number; reason?: string }>) {
  const calls: { environment: string; deviceToken: string; payload: string; headers: Record<string, string> }[] = [];
  const send: ApnsSend = async (environment, deviceToken, payload, headers) => {
    calls.push({ environment, deviceToken, payload, headers });
    return results[environment] ?? { status: 200 };
  };
  return { calls, send };
}

describe("normalizePem", () => {
  it("rebuilds a key pasted without line breaks", () => {
    const flat = pem.replace(/\n/g, "");
    expect(normalizePem(flat)).toBe(pem);
  });

  it("accepts the bare base64 body", () => {
    const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s/g, "");
    expect(normalizePem(body)).toBe(pem);
  });
});

describe("ProviderToken", () => {
  it("signs a verifiable ES256 JWT and caches it", () => {
    let now = 1_700_000_000_000;
    const provider = new ProviderToken(config, () => now);
    const jwt = provider.get();
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({ iss: "TEAM123", iat: 1_700_000_000 });
    const valid = verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" },
      Buffer.from(signature!, "base64url"),
    );
    expect(valid).toBe(true);
    now += 10 * 60_000;
    expect(provider.get()).toBe(jwt);
    now += 40 * 60_000;
    expect(provider.get()).not.toBe(jwt);
  });
});

describe("apnsPayload", () => {
  it("puts the alert in aps and keeps BB's data at the top level", () => {
    const payload = JSON.parse(
      apnsPayload({ to: "apns:x", title: "T", body: "B", data: { threadId: "thr_1", kind: "turn-finished" } }),
    );
    expect(payload).toEqual({
      aps: { alert: { title: "T", body: "B" }, sound: "default", "thread-id": "thr_1", category: "BB_REPLY" },
      threadId: "thr_1",
      kind: "turn-finished",
    });
  });
});

describe("notificationCategory", () => {
  const approval = { kind: "pending-interaction", interactionId: "pint_abcdefghij", interactionKind: "approval" };

  it("offers Approve and Deny only when both are allowed", () => {
    expect(notificationCategory({ ...approval, subjectKind: "command", decisions: ["allow_once", "deny"] })).toBe(
      "BB_APPROVAL",
    );
    expect(notificationCategory({ ...approval, subjectKind: "plan", decisions: ["allow_once", "deny"] })).toBe("BB_PLAN");
    expect(notificationCategory({ ...approval, decisions: ["allow_once"] })).toBeUndefined();
  });

  it("uses a reply box for questions, finished turns, and errors", () => {
    expect(notificationCategory({ ...approval, interactionKind: "user_question" })).toBe("BB_QUESTION");
    expect(notificationCategory({ kind: "turn-finished" })).toBe("BB_REPLY");
    expect(notificationCategory({ kind: "thread-error" })).toBe("BB_REPLY");
  });

  it("leaves unenriched or plugin interactions as plain alerts", () => {
    expect(notificationCategory({ kind: "pending-interaction" })).toBeUndefined();
    expect(notificationCategory({ ...approval, interactionKind: "plugin" })).toBeUndefined();
  });

  it("gives single-select questions option buttons through the notification extension", () => {
    const question = { kind: "pending-interaction", interactionId: "int_1", interactionKind: "user_question" };
    expect(notificationCategory({ ...question, choices: ["Red", "Green"] })).toBe("BB_CHOICE");
    expect(notificationCategory({ ...question, choices: [] })).toBe("BB_QUESTION");
    const payload = JSON.parse(apnsPayload({ to: "apns:x", data: { ...question, threadId: "thr_1", choices: ["Red"] } }));
    expect(payload.aps).toMatchObject({ category: "BB_CHOICE", "mutable-content": 1 });
    expect(payload.choices).toEqual(["Red"]);
  });

  it("lands in aps.category", () => {
    const payload = JSON.parse(apnsPayload({ to: "apns:x", data: { kind: "turn-finished", threadId: "thr_1" } }));
    expect(payload.aps.category).toBe("BB_REPLY");
  });
});

describe("deliverApns", () => {
  const provider = new ProviderToken(config);

  it("sends to production with the bundle topic", async () => {
    const { calls, send } = recordingSend({});
    const ticket = await deliverApns({ to: `apns:${token.toUpperCase()}`, title: "T" }, config, provider, send);
    expect(ticket).toEqual({ status: "ok" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.environment).toBe("production");
    expect(calls[0]!.deviceToken).toBe(token);
    expect(calls[0]!.headers["apns-topic"]).toBe("nyc.plee.bbgo");
  });

  it("falls back to the sandbox for development-build tokens", async () => {
    const { calls, send } = recordingSend({ production: { status: 400, reason: "BadDeviceToken" } });
    const ticket = await deliverApns({ to: `apns:${token}` }, config, provider, send);
    expect(ticket.status).toBe("ok");
    expect(calls.map((call) => call.environment)).toEqual(["production", "development"]);
  });

  it("reports dead tokens as DeviceNotRegistered so the sender prunes them", async () => {
    const { send } = recordingSend({ production: { status: 410, reason: "Unregistered" } });
    const ticket = await deliverApns({ to: `apns:${token}` }, config, provider, send);
    expect(ticket).toMatchObject({ status: "error", details: { error: "DeviceNotRegistered" } });
  });

  it("keeps other failures as retryable errors", async () => {
    const { send } = recordingSend({ production: { status: 403, reason: "InvalidProviderToken" } });
    const ticket = await deliverApns({ to: `apns:${token}` }, { ...config, environment: "production" }, provider, send);
    expect(ticket).toMatchObject({ status: "error", details: { error: "InvalidProviderToken" } });
  });

  it("rejects malformed tokens without calling Apple", async () => {
    const { calls, send } = recordingSend({});
    const ticket = await deliverApns({ to: "apns:not-hex" }, config, provider, send);
    expect(ticket.status).toBe("error");
    expect(calls).toHaveLength(0);
  });
});
