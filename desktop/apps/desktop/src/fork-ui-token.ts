import { createHash, randomBytes } from "node:crypto";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { FORK_UI_TOKEN_GET_CHANNEL } from "./fork-ui-token-ipc.js";

export const FORK_UI_TOKEN_HASH_ENV = "BB_STUDIO_UI_TOKEN_SHA256";

let token: string | null = null;

export function forkUiToken(): string {
  token ??= randomBytes(32).toString("base64url");
  return token;
}

export function forkUiTokenEnv(): Record<string, string> {
  return {
    [FORK_UI_TOKEN_HASH_ENV]: createHash("sha256")
      .update(forkUiToken())
      .digest("hex"),
  };
}

export function registerForkUiTokenIpc(
  ipcMain: Pick<IpcMain, "handle">,
  appWebContentsIds: ReadonlySet<number>,
): void {
  ipcMain.handle(FORK_UI_TOKEN_GET_CHANNEL, (event: IpcMainInvokeEvent) =>
    appWebContentsIds.has(event.sender.id) ? forkUiToken() : null,
  );
}

export function resetForkUiTokenForTests(): void {
  token = null;
}
