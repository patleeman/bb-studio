import { describe, expect, it } from "vitest";
import { buildTimelineErrorDisplay } from "../src/error-display.js";
import type { EventProjectionErrorMessage } from "../src/event-projection-types.js";

function errorMessage(
  overrides: Partial<EventProjectionErrorMessage>,
): EventProjectionErrorMessage {
  return {
    kind: "error",
    message: "Provider error",
    detail: null,
    rawType: "provider/error",
    systemErrorCode: null,
    ...overrides,
  } as EventProjectionErrorMessage;
}

describe("sign-in errors read plainly", () => {
  it("replaces a raw 401 with a sign-in message naming the provider", () => {
    const display = buildTimelineErrorDisplay(
      errorMessage({
        detail:
          "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: 9a1b2c3d4e5f6a7b-SJC",
        providerErrorInfo: {
          category: "connection-failed",
          providerCode: "httpConnectionFailed",
          httpStatusCode: 401,
        },
      }),
      "Codex",
    );
    expect(display).toEqual({
      title: "Codex isn't signed in",
      detail: "Sign in to Codex, or pick another model.",
    });
    expect(JSON.stringify(display)).not.toContain("cf-ray");
  });

  it("recognizes Claude Code's not-logged-in text without a status code", () => {
    expect(
      buildTimelineErrorDisplay(
        errorMessage({
          rawType: "system/error",
          message: "Not logged in · Please run /login",
        }),
        "Claude Code",
      ),
    ).toEqual({
      title: "Claude Code isn't signed in",
      detail: "Sign in to Claude Code, or pick another model.",
    });
  });

  it("keeps other provider errors as they were", () => {
    expect(
      buildTimelineErrorDisplay(
        errorMessage({
          detail: "upstream connect error",
          providerErrorInfo: {
            category: "connection-failed",
            providerCode: "httpConnectionFailed",
            httpStatusCode: 502,
          },
        }),
        "Codex",
      ),
    ).toEqual({
      title: "Provider connection failed",
      detail: "upstream connect error",
    });
  });
});
