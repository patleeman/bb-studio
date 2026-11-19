import type { IpcRenderer } from "electron";
import { FORK_UI_TOKEN_GET_CHANNEL } from "./fork-ui-token-ipc.js";

export function forkUiTokenApi(ipcRenderer: Pick<IpcRenderer, "invoke">): {
  experimental_bringOverToken(): Promise<string | null>;
} {
  return {
    experimental_bringOverToken: async () =>
      ((await ipcRenderer.invoke(FORK_UI_TOKEN_GET_CHANNEL)) as
        | string
        | null) ?? null,
  };
}
