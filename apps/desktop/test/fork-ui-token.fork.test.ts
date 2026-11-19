import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FORK_UI_TOKEN_GET_CHANNEL } from "../src/fork-ui-token-ipc.js";
import { forkUiTokenApi } from "../src/fork-ui-token-preload.js";
import {
  FORK_UI_TOKEN_HASH_ENV,
  forkUiToken,
  forkUiTokenEnv,
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

  it("gives bb-app only the token's hash, the same one for every server start of this launch", () => {
    const env = forkUiTokenEnv();
    expect(env).toEqual({
      [FORK_UI_TOKEN_HASH_ENV]: createHash("sha256")
        .update(forkUiToken())
        .digest("hex"),
    });
    expect(Object.values(env)).not.toContain(forkUiToken());
    expect(forkUiTokenEnv()).toEqual(env);
    resetForkUiTokenForTests();
    expect(forkUiTokenEnv()).not.toEqual(env);
  });
});
