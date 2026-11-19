// The Mac's idle time and lock state for Studio's "at the desk" heartbeat
// (Hold phone notifications while I'm at my Mac). The renderer reads it about
// every 15 seconds; lock and unlock are pushed to app windows at once.
import {
  BrowserWindow,
  powerMonitor,
  type IpcMain,
  type IpcMainInvokeEvent,
} from "electron";
import {
  FORK_ACTIVITY_CHANGED_CHANNEL,
  FORK_ACTIVITY_GET_CHANNEL,
  type ForkSystemActivity,
} from "./fork-activity-ipc.js";
import { isAppWindowSender } from "./fork-finder.js";

/** Electron's powerMonitor, as far as this file uses it. */
export interface ActivityMonitor {
  getSystemIdleTime(): number;
  getSystemIdleState(idleThreshold: number): string;
  on(event: "lock-screen" | "unlock-screen", listener: () => void): unknown;
}

const IDLE_THRESHOLD_SECONDS = 120;

/** Tracks lock and unlock and answers the current reading. */
export function createActivityTracker(
  monitor: ActivityMonitor,
  onChange: (activity: ForkSystemActivity) => void,
): () => ForkSystemActivity {
  let lockedByEvent = false;
  const read = (): ForkSystemActivity => {
    const idleSeconds = Math.max(0, Math.floor(monitor.getSystemIdleTime()));
    const locked =
      lockedByEvent ||
      monitor.getSystemIdleState(IDLE_THRESHOLD_SECONDS) === "locked";
    return { idleSeconds, locked };
  };
  monitor.on("lock-screen", () => {
    lockedByEvent = true;
    onChange(read());
  });
  monitor.on("unlock-screen", () => {
    lockedByEvent = false;
    onChange(read());
  });
  return read;
}

export function registerForkActivityIpc(
  ipcMain: IpcMain,
  appWindowIds: ReadonlySet<number>,
  monitor: ActivityMonitor = powerMonitor,
): void {
  const read = createActivityTracker(monitor, (activity) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || !appWindowIds.has(window.webContents.id)) {
        continue;
      }
      window.webContents.send(FORK_ACTIVITY_CHANGED_CHANNEL, activity);
    }
  });
  ipcMain.handle(FORK_ACTIVITY_GET_CHANNEL, (event: IpcMainInvokeEvent) =>
    isAppWindowSender(event, appWindowIds) ? read() : null,
  );
}
