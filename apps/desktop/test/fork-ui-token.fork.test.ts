import { afterEach, describe, expect, it, vi } from "vitest";
import { FORK_UI_TOKEN_GET_CHANNEL } from "../src/fork-ui-token-ipc.js";
import { forkUiTokenApi } from "../src/fork-ui-token-preload.js";
import {
  forkUiToken,
  registerForkUiToken,
  registerForkUiTokenIpc,
  resetForkUiTokenForTests,
} from "../src/fork-ui-token.js";

afterEach(() => resetForkUiTokenForTests());

describe("the bring-over token", () => {
  it("is one random secret per launch, given only to app windows", async () => {
    const handlers = new Map<
      string,
      (event: { sender: { id: number } }) => unknown
    >();
    registerForkUiTokenIpc(
      {
        handle: (channel: string, handler: never) => {
          handlers.set(channel, handler);
        },
      } as never,
      new Set([7]),
    );
    const handler = handlers.get(FORK_UI_TOKEN_GET_CHANNEL)!;
    const token = handler({ sender: { id: 7 } });
    expect(typeof token).toBe("string");
    expect((token as string).length).toBeGreaterThanOrEqual(40);
    expect(handler({ sender: { id: 7 } })).toBe(token);
    expect(handler({ sender: { id: 8 } })).toBeNull();
    const invoke = vi.fn(async () => token);
    expect(
      await forkUiTokenApi({ invoke } as never).experimental_bringOverToken(),
    ).toBe(token);
    expect(invoke).toHaveBeenCalledWith(FORK_UI_TOKEN_GET_CHANNEL);
  });

  it("hands the token to the server once it answers", async () => {
    const load = vi.fn(async () => new Response(null, { status: 204 }));
    expect(
      await registerForkUiToken("http://127.0.0.1:1234/", load as never),
    ).toBe(true);
    expect(load).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/api/v1/fork/bring-over/ui-token",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: forkUiToken() }),
      }),
    );
    expect(
      await registerForkUiToken("http://127.0.0.1:1234", (async () => {
        throw new Error("down");
      }) as never),
    ).toBe(false);
    expect(
      await registerForkUiToken(
        "http://127.0.0.1:1234",
        (async () => new Response(null, { status: 409 })) as never,
      ),
    ).toBe(false);
  });
});
