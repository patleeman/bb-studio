import type { IpcRenderer } from "electron";
import {
  FORK_DESKTOP_CONTROL_CHANNEL,
  FORK_DESKTOP_CONTROL_EVENT_CHANNEL,
  type DesktopControlRequest,
  type DesktopControlState,
} from "./fork-desktop-control-ipc.js";

export interface ForkDesktopControlBridge {
  request(request: DesktopControlRequest): Promise<DesktopControlState>;
  subscribe(listener: (state: DesktopControlState) => void): () => void;
}

export function forkDesktopControlApi(ipcRenderer: IpcRenderer): {
  experimental_desktopControl: ForkDesktopControlBridge;
} {
  return {
    experimental_desktopControl: {
      request: (request) =>
        ipcRenderer.invoke(
          FORK_DESKTOP_CONTROL_CHANNEL,
          request,
        ) as Promise<DesktopControlState>,
      subscribe(listener) {
        const handler = (_event: unknown, state: DesktopControlState) =>
          listener(state);
        ipcRenderer.on(FORK_DESKTOP_CONTROL_EVENT_CHANNEL, handler);
        return () => {
          ipcRenderer.removeListener(
            FORK_DESKTOP_CONTROL_EVENT_CHANNEL,
            handler,
          );
        };
      },
    },
  };
}
