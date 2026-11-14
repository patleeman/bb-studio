import { describe, expect, it } from "vitest";
import type { ThreadDelta } from "@get-bb/plugin-sdk/provider-bridge";
import { failFastOnAuthError } from "./auth-fail-fast.fork.js";

function reconnect(
  turnId: string,
  attempt: number,
  cause: string,
  httpStatusCode: number | null = 401,
): ThreadDelta {
  return {
    kind: "provider.error",
    message: "Provider error",
    detail: `Reconnecting... ${attempt}/5\n${cause}`,
    willRetry: true,
    errorInfo: {
      category: "connection-failed",
      providerCode: "responseStreamConnectionFailed",
      httpStatusCode,
    },
    providerTurnId: turnId,
  };
}

const MISSING =
  "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header";
const EXPIRED = "unexpected status 401 Unauthorized: token expired";

describe("a Codex turn that is not signed in", () => {
  it("ends the turn on the first reconnect when the credentials are missing", () => {
    const session = {};
    const result = failFastOnAuthError(session, [reconnect("turn_1", 1, MISSING)]);
    expect(result.interruptTurnId).toBe("turn_1");
    expect(result.deltas).toEqual([
      expect.objectContaining({
        kind: "provider.error",
        willRetry: false,
        errorInfo: {
          category: "unauthorized",
          providerCode: "responseStreamConnectionFailed",
          httpStatusCode: 401,
        },
      }),
    ]);
  });

  it("drops the reconnects that follow and records the stopped turn as failed", () => {
    const session = {};
    failFastOnAuthError(session, [reconnect("turn_1", 1, MISSING)]);
    const later = failFastOnAuthError(session, [
      reconnect("turn_1", 2, MISSING),
      { kind: "turn.boundary", providerTurnId: "turn_1", status: "interrupted" },
    ]);
    expect(later.interruptTurnId).toBeNull();
    expect(later.deltas).toEqual([
      {
        kind: "turn.boundary",
        providerTurnId: "turn_1",
        status: "failed",
        error: { message: "Not signed in" },
      },
    ]);
    const next = failFastOnAuthError(session, [
      { kind: "turn.boundary", providerTurnId: "turn_2", status: "completed" },
    ]);
    expect(next.deltas[0]).toMatchObject({ status: "completed" });
  });
});

describe("a signed-in Codex turn whose token is refreshed", () => {
  it("lets a single 401 reconnect retry, so a refreshed token can recover", () => {
    const session = {};
    const first = reconnect("turn_1", 1, EXPIRED);
    const result = failFastOnAuthError(session, [first]);
    expect(result.interruptTurnId).toBeNull();
    expect(result.deltas).toEqual([first]);
    const done = failFastOnAuthError(session, [
      { kind: "turn.boundary", providerTurnId: "turn_1", status: "completed" },
    ]);
    expect(done.deltas[0]).toMatchObject({ status: "completed" });
  });

  it("ends the turn on the second 401 in a row", () => {
    const session = {};
    failFastOnAuthError(session, [reconnect("turn_1", 1, EXPIRED)]);
    const second = failFastOnAuthError(session, [reconnect("turn_1", 2, EXPIRED)]);
    expect(second.interruptTurnId).toBe("turn_1");
    expect(second.deltas[0]).toMatchObject({
      willRetry: false,
      errorInfo: { category: "unauthorized" },
    });
  });

  it("starts counting again after a reconnect that isn't a 401", () => {
    const session = {};
    failFastOnAuthError(session, [reconnect("turn_1", 1, EXPIRED)]);
    failFastOnAuthError(session, [
      reconnect("turn_1", 2, "stream disconnected before completion", null),
    ]);
    const third = failFastOnAuthError(session, [reconnect("turn_1", 3, EXPIRED)]);
    expect(third.interruptTurnId).toBeNull();
  });

  it("counts each turn on its own", () => {
    const session = {};
    failFastOnAuthError(session, [reconnect("turn_1", 1, EXPIRED)]);
    const other = failFastOnAuthError(session, [reconnect("turn_2", 1, EXPIRED)]);
    expect(other.interruptTurnId).toBeNull();
  });
});

describe("other reconnects", () => {
  it("are left alone, including text that only mentions 401", () => {
    const session = {};
    const plain: ThreadDelta = reconnect(
      "turn_1",
      1,
      "stream disconnected before completion",
      null,
    );
    const mention: ThreadDelta = reconnect(
      "turn_1",
      2,
      "retrying request 401 of 500 after a timeout",
      null,
    );
    const result = failFastOnAuthError(session, [plain, mention]);
    expect(result.interruptTurnId).toBeNull();
    expect(result.deltas).toEqual([plain, mention]);
    const again = failFastOnAuthError(session, [mention]);
    expect(again.interruptTurnId).toBeNull();
  });
});
