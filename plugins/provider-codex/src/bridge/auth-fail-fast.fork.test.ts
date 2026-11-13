import { describe, expect, it } from "vitest";
import type { ThreadDelta } from "@get-bb/plugin-sdk/provider-bridge";
import { failFastOnAuthError } from "./auth-fail-fast.fork.js";

function reconnect(turnId: string, attempt: number): ThreadDelta {
  return {
    kind: "provider.error",
    message: "Provider error",
    detail: `Reconnecting... ${attempt}/5\nunexpected status 401 Unauthorized: Missing bearer or basic authentication in header`,
    willRetry: true,
    errorInfo: {
      category: "connection-failed",
      providerCode: "responseStreamConnectionFailed",
      httpStatusCode: 401,
    },
    providerTurnId: turnId,
  };
}

describe("a Codex turn that is not signed in", () => {
  it("turns the first 401 reconnect into a final sign-in error and asks to stop the turn", () => {
    const session = {};
    const result = failFastOnAuthError(session, [reconnect("turn_1", 1)]);
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
    failFastOnAuthError(session, [reconnect("turn_1", 1)]);
    const later = failFastOnAuthError(session, [
      reconnect("turn_1", 2),
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

  it("leaves other reconnects alone so they are still retried", () => {
    const session = {};
    const delta: ThreadDelta = {
      kind: "provider.error",
      message: "Provider error",
      detail: "Reconnecting... 1/5\nstream disconnected before completion",
      willRetry: true,
      errorInfo: {
        category: "connection-failed",
        providerCode: null,
        httpStatusCode: null,
      },
      providerTurnId: "turn_1",
    };
    const result = failFastOnAuthError(session, [delta]);
    expect(result.interruptTurnId).toBeNull();
    expect(result.deltas).toEqual([delta]);
  });
});
