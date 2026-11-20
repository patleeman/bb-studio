import type { IpcRenderer, IpcRendererEvent } from "electron";
import {
  FORK_ACTIVITY_CHANGED_CHANNEL,
  FORK_ACTIVITY_GET_CHANNEL,
  type ForkSystemActivity,
} from "./fork-activity-ipc.js";

export function forkActivityApi(ipcRenderer: IpcRenderer): {
  experimental_systemActivity(): Promise<ForkSystemActivity>;
  experimental_onSystemActivity(
    listener: (activity: ForkSystemActivity) => void,
  ): () => void;
} {
  return {
    experimental_systemActivity: async () => {
      const activity = (await ipcRenderer.invoke(
        FORK_ACTIVITY_GET_CHANNEL,
      )) as ForkSystemActivity | null;
      if (!activity) throw new Error("System activity is unavailable here.");
      return activity;
    },
    experimental_onSystemActivity: (listener) => {
      const handler = (_event: IpcRendererEvent, activity: ForkSystemActivity) =>
        listener(activity);
      ipcRenderer.on(FORK_ACTIVITY_CHANGED_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(FORK_ACTIVITY_CHANGED_CHANNEL, handler);
      };
    },
  };
}
