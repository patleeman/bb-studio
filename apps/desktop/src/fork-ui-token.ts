import { randomBytes } from "node:crypto";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { FORK_UI_TOKEN_GET_CHANNEL } from "./fork-ui-token-ipc.js";

let token: string | null = null;

export function forkUiToken(): string {
  token ??= randomBytes(32).toString("base64url");
  return token;
}

export function registerForkUiTokenIpc(
  ipcMain: Pick<IpcMain, "handle">,
  appWebContentsIds: ReadonlySet<number>,
): void {
  ipcMain.handle(FORK_UI_TOKEN_GET_CHANNEL, (event: IpcMainInvokeEvent) =>
    appWebContentsIds.has(event.sender.id) ? forkUiToken() : null,
  );
}

export async function registerForkUiToken(
  serverUrl: string,
  load: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await load(
      `${serverUrl.replace(/\/$/u, "")}/api/v1/fork/bring-over/ui-token`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: forkUiToken() }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export function resetForkUiTokenForTests(): void {
  token = null;
}
