import { describe, expect, it } from "vitest";
import { makeTurnFailedEvent } from "@get-bb/plugin-sdk/testing";
import type { PluginTurnFailedEvent } from "@get-bb/plugin-sdk";
import { decideRetry } from "./retry-policy.js";

const NOW_MS = Date.parse("2026-11-13T12:00:00.000Z");

function failed(
  errorInfo: PluginTurnFailedEvent["errorInfo"],
  attemptNumber = 1,
): PluginTurnFailedEvent {
  return makeTurnFailedEvent({
    threadId: "thread-signed-out",
    requestId: "creq_bbbbbbbbbb",
    errorInfo,
    attemptNumber,
  });
}

function decide(failure: PluginTurnFailedEvent) {
  return decideRetry({
    availability: { kind: "not-routed" },
    failure,
    maximumWaitMs: null,
    now: NOW_MS,
    random: 0,
  });
}

describe("sign-in failures are final", () => {
  it("does not retry a 401 the provider reports as a failed connection", () => {
    expect(
      decide(
        failed({
          category: "connection-failed",
          providerCode: "httpConnectionFailed",
          httpStatusCode: 401,
        }),
      ),
    ).toEqual({ kind: "decline", reason: "not-retryable" });
  });

  it("does not retry an unauthorized provider", () => {
    expect(
      decide(
        failed({
          category: "unauthorized",
          providerCode: "authentication_failed",
          httpStatusCode: null,
        }),
      ),
    ).toEqual({ kind: "decline", reason: "not-retryable" });
  });

  it("still retries a connection failure that is not about sign-in", () => {
    expect(
      decide(
        failed({
          category: "connection-failed",
          providerCode: "httpConnectionFailed",
          httpStatusCode: 502,
        }),
      ),
    ).toMatchObject({ kind: "retry", reason: "Provider unavailable" });
  });
});
